import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type Me } from "@/auth";
import { Button, Notice, Type, space } from "@/components/ui";
import { hapticsPolicy, isIOS, otpInputProps } from "@/platform";
import { theme } from "@/theme";
import { resolveEntryRoute } from "@/navigation";
import {
  asOnboardingIntent,
  pendingOnboardingIntent,
  rememberOnboardingIntent,
} from "@/onboardingIntent";

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

        if (hapticsPolicy.onSuccess) {
          const Haptics = await import("expo-haptics").catch(() => null);
          await Haptics?.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }

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
        if (hapticsPolicy.onError) {
          const Haptics = await import("expo-haptics").catch(() => null);
          await Haptics?.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
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

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={isIOS ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: space[5], gap: space[6] }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space[3] }}>
          <Type variant="display2">Enter the code</Type>
          <Type variant="body" style={{ color: theme.color.ink["700"] }}>
            We sent six digits to {params.phoneDisplay}.
          </Type>
          <Pressable onPress={() => router.back()} accessibilityRole="link">
            <Type variant="caption" style={{ color: theme.color.kola["600"] }}>
              Wrong number? Change it
            </Type>
          </Pressable>
        </View>

        <Pressable
          onPress={() => inputRef.current?.focus()}
          accessibilityRole="none"
          accessible={false}
        >
          <View style={{ flexDirection: "row", gap: space[2], justifyContent: "space-between" }}>
            {Array.from({ length: 6 }).map((_, index) => {
              const filled = index < code.length;
              const active = index === code.length;
              return (
                <View
                  key={index}
                  style={{
                    flex: 1,
                    height: 56,
                    borderRadius: 8,
                    borderWidth: active ? 2 : 1,
                    borderColor: error
                      ? theme.color.laterite["600"]
                      : active
                        ? theme.color.kola["600"]
                        : theme.color.field["300"],
                    backgroundColor: theme.color.field["0"],
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Type variant="title1" style={{ fontFamily: "monospace" }}>
                    {filled ? code[index] : ""}
                  </Type>
                </View>
              );
            })}
          </View>

          {/* One real input behind the cells: keeps autofill, paste and
              backspace working the way the platform expects. */}
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={onChange}
            autoFocus
            maxLength={6}
            accessibilityLabel="Six digit code"
            accessibilityHint="Enter the code we sent by text message"
            style={{ position: "absolute", opacity: 0, height: 56, width: "100%" }}
            {...otpInputProps}
          />
        </Pressable>

        {error ? <Notice tone="error" title={error} /> : null}

        {expired ? (
          <Notice
            tone="warning"
            title="That code has expired"
            body="Ask for a new one to carry on."
          />
        ) : (
          <Type variant="caption">
            The code expires in {Math.floor(expiresIn / 60)}:
            {String(expiresIn % 60).padStart(2, "0")}.
          </Type>
        )}

        <Button
          label={resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
          variant="secondary"
          onPress={resend}
          disabled={resendIn > 0 || busy}
        />

        <Notice
          tone="info"
          title="Not arrived?"
          body="Delivery can take a minute on a busy network. Check you have signal, and that the number above is right."
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
