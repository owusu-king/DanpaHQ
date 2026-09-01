import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/api";
import { useAuth, type Me } from "@/auth";
import { Button, Field, Notice, Surface, Type, space } from "@/components/ui";
import { fieldErrorsFrom, summaryErrorFrom, type FieldErrors } from "@/formErrors";
import { resolveEntryRoute } from "@/navigation";
import { clearPendingOnboardingIntent, pendingOnboardingIntent } from "@/onboardingIntent";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";
import { chooseWorkspace } from "@/workspace";

/**
 * The last step of creating an account: what you came here to be, who you are,
 * and a credential you can sign back in with.
 *
 * Reached with a proved number and no account. Submitting this form is what
 * creates one — before that there is only a signed ticket saying the number was
 * confirmed, so leaving here writes nothing at all and the person was never a
 * member. That used to be an inert row created at the OTP step.
 *
 * **The button is never disabled for a validation reason.** It used to be gated
 * on a `ready` expression requiring an exact `YYYY-MM-DD` and ten characters of
 * password, so someone who had filled every box in could be left holding a dead
 * button with nothing on screen explaining why. Pressing now always does
 * something: it submits, or it says which field to fix.
 */
const MIN_PASSWORD_LENGTH = 8;

export default function RegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshMe, signIn, deviceFingerprint } = useAuth();
  const params = useLocalSearchParams<{ workspace?: string; ticket?: string }>();
  //: Proof that the number was confirmed, cut by /auth/verify minutes ago. Empty
  //: for an unfinished account from before tickets, which arrives signed in.
  const ticket = params.ticket ?? "";

  const [accountType, setAccountType] = useState<"tenant" | "provider">(
    params.workspace === "provider" ? "provider" : "tenant",
  );

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState("");

  // The route gate can send someone here on its own, without our parameters, so
  // the journey they chose on the welcome screen is read back from storage as
  // well. Whichever arrives, the person can still change it below.
  useEffect(() => {
    if (params.workspace) return;
    let cancelled = false;
    void pendingOnboardingIntent().then((intent) => {
      if (!cancelled && intent === "manage_property") setAccountType("provider");
    });
    return () => {
      cancelled = true;
    };
  }, [params.workspace]);

  /** Clear a field's error the moment the person starts fixing it. */
  function edit(field: string, set: (value: string) => void) {
    return (value: string) => {
      set(value);
      setSummary("");
      setErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    };
  }

  /**
   * What this screen can judge without asking the server. Deliberately the
   * minimum — anything subtler, like a common password or an email already in
   * use, is the backend's call, and duplicating those rules here is how the two
   * drift and start contradicting each other in front of the user.
   */
  function localProblems(): FieldErrors {
    const found: FieldErrors = {};
    if (!firstName.trim()) found.first_name = "Enter your first name.";
    if (!lastName.trim()) found.last_name = "Enter your last name.";
    if (!dateOfBirth.trim()) {
      found.date_of_birth = "Enter your date of birth.";
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      found.date_of_birth = "Enter all eight digits, for example 02 03 1994.";
    }
    if (!password) {
      found.password = "Choose a password.";
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      found.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return found;
  }

  async function submit() {
    const problems = localProblems();
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      setSummary("");
      return;
    }

    setBusy(true);
    setErrors({});
    setSummary("");
    try {
      // This call is what creates the account, so it is also what opens the
      // first session — there was nobody to open one for until now. A ticket
      // means a brand-new number; its absence means an unfinished row from
      // before tickets, already carrying a session of its own.
      const created = await apiFetch<{
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        user?: Me;
      }>("/me/registration/", {
        method: "POST",
        anonymous: Boolean(ticket),
        body: {
          registration_ticket: ticket || undefined,
          account_type: accountType,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          date_of_birth: dateOfBirth,
          email: email.trim() || null,
          password,
          platform: Platform.OS,
          device_fingerprint: deviceFingerprint,
        },
      });
      if (created.access_token && created.user) {
        await signIn(created as Parameters<typeof signIn>[0]);
      }
      const me = await chooseWorkspace(accountType === "provider" ? "provider" : "tenant");
      await clearPendingOnboardingIntent();
      await refreshMe();
      router.replace(resolveEntryRoute(me) as never);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setErrors(fields);
      setSummary(summaryErrorFrom(cause, fields));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: space[5],
          paddingTop: insets.top + space[10],
          paddingBottom: insets.bottom + space[6],
          gap: space[5],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space[2] }}>
          <Type variant="label">STEP 3 OF 3</Type>
          <Type variant="display2">Set up your account</Type>
        </View>

        <View style={{ gap: space[3] }}>
          <Type variant="title2">What brings you here?</Type>
          <AccountTypeCard
            selected={accountType === "tenant"}
            title="I'm looking for a place"
            body="Save listings, ask to view, and apply."
            onPress={() => setAccountType("tenant")}
          />
          <AccountTypeCard
            selected={accountType === "provider"}
            title="I own or manage property"
            body="Set up buildings and units privately. Advertising needs verification."
            onPress={() => setAccountType("provider")}
          />
        </View>

        {accountType === "provider" ? (
          <Notice
            tone="info"
            title="Provider access is reviewed separately"
            body="You can add your buildings and units straight away. Advertising and collecting rent wait until your provider verification is approved."
          />
        ) : null}

        <Field
          label="First name"
          value={firstName}
          onChangeText={edit("first_name", setFirstName)}
          error={errors.first_name}
          autoComplete="given-name"
        />
        <Field
          label="Last name"
          value={lastName}
          onChangeText={edit("last_name", setLastName)}
          error={errors.last_name}
          autoComplete="family-name"
        />
        <Field
          label="Date of birth"
          placeholder="YYYY-MM-DD"
          hint="Type the digits — the dashes are added for you."
          value={dateOfBirth}
          // "19940302" becomes "1994-03-02". Expecting people to type the dashes
          // was the commonest way to fill this in correctly and still be refused.
          onChangeText={edit("date_of_birth", (value) => setDateOfBirth(formatDate(value)))}
          error={errors.date_of_birth}
          keyboardType="number-pad"
          maxLength={10}
        />
        <Field
          label="Email (optional)"
          value={email}
          onChangeText={edit("email", setEmail)}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={edit("password", setPassword)}
          error={errors.password}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Not all digits, and not your own number.`}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />

        {summary ? <Notice tone="error" title={summary} /> : null}

        <Button
          label="Create account"
          busyLabel="Setting up…"
          onPress={submit}
          busy={busy}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Digits in, `YYYY-MM-DD` out, as far as the person has typed. */
function formatDate(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)]
    .filter((part) => part.length > 0)
    .join("-");
}

function AccountTypeCard({
  selected,
  title,
  body,
  onPress,
}: {
  selected: boolean;
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      {...pressableFeedback(theme.color.kola["50"])}
    >
      <Surface
        style={{
          gap: space[1],
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? theme.color.kola["600"] : theme.color.field["300"],
        }}
      >
        <Type variant="bodyStrong">{selected ? "✓ " : ""}{title}</Type>
        <Type variant="caption">{body}</Type>
      </Surface>
    </Pressable>
  );
}
