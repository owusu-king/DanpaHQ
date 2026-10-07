import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type Me } from "@/auth";
import { TextLink } from "@/components/auth/AuthFields";
import {
  AuthBack,
  AuthFoot,
  AuthHeading,
  AuthScene,
  CodeCells,
} from "@/components/auth/AuthScene";
import { Notice, Type, space } from "@/components/ui";
import { hapticsPolicy } from "@/platform";
import { theme } from "@/theme";
import { resolveEntryRoute } from "@/navigation";
import {
  asOnboardingIntent,
  pendingOnboardingIntent,
  rememberOnboardingIntent,
} from "@/onboardingIntent";

/**
 * A buzz, which must never decide whether a sign-up completes.
 *
 * This screen used to reach for haptics inline:
 *
 * ```
 * const Haptics = await import("expo-haptics").catch(() => null);
 * await Haptics?.notificationAsync(Haptics.NotificationFeedbackType.Success);
 * ```
 *
 * The `catch` covers the *import* and nothing after it. On a handset where the
 * module resolves but `NotificationFeedbackType` does not — a build without the
 * native module linked — that second line throws
 * `Cannot read property 'Success' of undefined`, and the two places it is
 * called are the worst two places in the flow for a throw:
 *
 * - On success it is inside the `try`, so a correct six-digit code was verified,
 *   the account was proved, and then the screen reported "That did not work"
 *   and stayed put. The session was never established, so somebody mid-sign-up
 *   was dropped back to the start as though they had been signed out.
 * - In the `catch` it is inside nothing at all, so it escaped `submit` as an
 *   unhandled rejection.
 *
 * So it is fire-and-forget, with one `catch` around the whole chain — the shape
 * `MainTabBar`, `FilterFields` and the provider dashboard already use — and the
 * enum is read inside the `then`, where a failure is caught rather than thrown.
 * Nothing is awaited: a garnish must not sit between a proved number and the
 * next screen.
 */
function buzz(kind: "success" | "error") {
  if (!(kind === "success" ? hapticsPolicy.onSuccess : hapticsPolicy.onError)) return;
  void import("expo-haptics")
    .then((haptics) =>
      haptics.notificationAsync(
        kind === "success"
          ? haptics.NotificationFeedbackType.Success
          : haptics.NotificationFeedbackType.Error,
      ),
    )
    .catch(() => null);
}

/**
 * The code screen. This is where sign-ups are won or lost.
 *
 * What it does differently from a default OTP screen:
 *
 * - **Autofill is wired per platform.** iOS surfaces the code above the keyboard
 *   from `textContentType="oneTimeCode"`; Android uses the `sms-otp` hint. See
 *   src/platform.ts for why these are not interchangeable.
 * - **One hidden input, six drawn cells.** Six separate inputs break autofill,
 *   break paste, and fight the backspace key. The cells are presentation.
 * - **It submits itself** the moment six digits are present. Asking someone to
 *   tap "Continue" after typing the last digit is a step for nothing.
 * - **The resend timer is visible and honest**, and it escalates the way the
 *   server actually enforces, so the button never lies about being available.
 * - **The number is shown with a way back.** Mistyping the number is the
 *   commonest reason a code never arrives, and the fix must be one tap away.
 *
 * The six cells stand on the page. They were briefly framed inside a frosted
 * panel, together with the clock and the resend, on the reasoning that they are
 * one thing — but a white box on a white surface has no edges, so what it
 * actually produced was six faint outlines where there should be six obvious
 * places to put a digit. The clock and the resend still sit under them as one
 * line, which is the part of that idea worth keeping.
 */
export default function CodeScreen() {
  const router = useRouter();
  const { signIn, deviceFingerprint } = useAuth();
  const params = useLocalSearchParams<{
    challengeId: string;
    phoneDisplay: string;
    expiresIn: string;
    resendIn: string;
    purpose: "sign_up";
    next?: string;
    intent?: string;
    workspace?: string;
  }>();

  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendIn, setResendIn] = useState(Number(params.resendIn ?? 60));
  const [expiresIn, setExpiresIn] = useState(Number(params.expiresIn ?? 300));
  const [challengeId, setChallengeId] = useState(params.challengeId);

  useEffect(() => {
    const timer = setInterval(() => {
      setResendIn((value) => Math.max(value - 1, 0));
      setExpiresIn((value) => Math.max(value - 1, 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      setError("");
      try {
        const result = await apiFetch<{
          // A number nobody has an account for: a ticket, and nothing else.
          registration_required?: boolean;
          registration_ticket?: string;
          // An account that exists — either finished, or left unfinished before
          // tickets replaced half-made rows.
          access_token?: string;
          refresh_token?: string;
          is_new_account?: boolean;
          user?: Me;
        }>("/auth/verify/", {
          method: "POST",
          anonymous: true,
          body: {
            challenge_id: challengeId,
            code: value,
            device_fingerprint: deviceFingerprint,
            platform: Platform.OS,
            device_label: `${Platform.OS === "ios" ? "iPhone" : "Android device"}`,
            os_version: String(Platform.Version),
          },
        });

        buzz("success");

        const requestedIntent = asOnboardingIntent(params.intent)
          ?? await pendingOnboardingIntent();
        const workspace = params.workspace
          ?? (requestedIntent === "manage_property" ? "provider" : "tenant");

        // The number is proved and nothing has been created. The ticket is the
        // proof, and it is spent on the next screen — where the person says who
        // they are, which is the point they actually join.
        if (result.registration_required) {
          // Remember the journey before leaving: the register screen can also
          // be reached by the route gate, which arrives without our parameters.
          if (requestedIntent) await rememberOnboardingIntent(requestedIntent);
          router.replace({
            pathname: "/(auth)/register",
            params: { workspace, ticket: result.registration_ticket ?? "" },
          });
          return;
        }

        // An account already exists on this number. Unfinished ones predate
        // tickets and still come back with a session to finish themselves in.
        //
        // Anything else is a response this build does not understand, which in
        // practice means the app is older than the API. Say that, because the
        // alternative is a screen that swallows the tap and explains nothing.
        if (!result.user || !result.access_token) {
          setCode("");
          setError("This version of the app is out of date. Update it to continue.");
          return;
        }
        const account = result.user;

        if (account.registration_state !== "complete") {
          if (requestedIntent) await rememberOnboardingIntent(requestedIntent);
          await signIn(result as Parameters<typeof signIn>[0]);
          router.replace({ pathname: "/(auth)/register", params: { workspace } });
          return;
        }

        const context = await signIn(result as Parameters<typeof signIn>[0]);
        router.replace(resolveEntryRoute(account, context) as never);
      } catch (cause) {
        setCode("");
        buzz("error");
        setError(
          cause instanceof ApiFailure ? cause.error.message : "That did not work. Try again.",
        );
        inputRef.current?.focus();
      } finally {
        setBusy(false);
      }
    },
    [challengeId, deviceFingerprint, params.intent, params.workspace, router, signIn],
  );

  function onChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (error) setError("");
    if (digits.length === 6 && !busy) void submit(digits);
  }

  async function resend() {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ challenge_id: string; resend_in: number }>(
        "/auth/challenge/",
        {
          method: "POST",
          anonymous: true,
          body: {
            phone: params.phoneDisplay,
            purpose: params.purpose,
            device_fingerprint: deviceFingerprint,
          },
        },
      );
      setChallengeId(result.challenge_id);
      setResendIn(result.resend_in);
      setExpiresIn(300);
      setCode("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not resend.");
    } finally {
      setBusy(false);
    }
  }

  const expired = expiresIn <= 0;
  const clock = `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}`;

  return (
    <AuthScene
      progress={{ step: 2, of: 3 }}
      header={<AuthBack label="Back to your number" onPress={() => router.back()} />}
    >
      <AuthHeading
        title="Enter the code"
        line={params.phoneDisplay ? `We sent six digits to ${params.phoneDisplay}.` : "We sent six digits to your number."}
      />

      {/* The six cells stand on the page, not inside a panel. Framed by one,
          they were white boxes on a white surface and their edges disappeared —
          six faint outlines where there should be six places to put a digit.
          On the ground they lift the way they always did. */}
      <View style={styles.codeBlock}>
        <CodeCells
          value={code}
          onChangeText={onChange}
          error={Boolean(error)}
          autoFocus
          inputRef={inputRef}
        />

        {/* How long this code lives, and how to get another — on one line,
            because they are the same question asked twice. */}
        <View style={styles.clockRow}>
          {expired ? (
            <Type variant="caption" style={styles.expired}>
              This code has expired
            </Type>
          ) : (
            <Type variant="caption">Expires in {clock}</Type>
          )}
          {resendIn > 0 ? (
            <Type variant="caption" style={styles.waiting}>
              New code in {resendIn}s
            </Type>
          ) : (
            <TextLink label="Send a new code" strong onPress={resend} />
          )}
        </View>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}

      <AuthFoot>
        <TextLink label="Wrong number? Change it" onPress={() => router.back()} />
        <Type variant="caption" style={styles.footnote}>
          Delivery can take a minute. We will never ask you for this code.
        </Type>
      </AuthFoot>
    </AuthScene>
  );
}

const styles = StyleSheet.create({
  codeBlock: {
    gap: space[3],
  },
  cells: {
    flexDirection: "row",
    gap: space[2],
    justifyContent: "space-between",
  },
  // Six white boxes, as they were: one grey hairline each, the one you are
  // filling in taking a second point of kola, and the whole row turning
  // laterite when a code is refused. A pale kola fill for landed digits was
  // tried and is gone — it made three of the six look like a different control.
  cell: {
    flex: 1,
    height: 56,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.color.field["300"],
    backgroundColor: theme.color.field["0"],
    alignItems: "center",
    justifyContent: "center",
  },
  cellActive: {
    borderWidth: 2,
    borderColor: theme.color.kola["600"],
  },
  cellWrong: {
    borderColor: theme.color.laterite["600"],
  },
  digit: {
    fontFamily: "monospace",
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    height: 56,
    width: "100%",
  },
  clockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
  },
  expired: {
    color: theme.color.laterite["600"],
  },
  waiting: {
    color: theme.color.ink["300"],
  },
  footnote: {
    textAlign: "center",
    color: theme.color.ink["500"],
  },
});
