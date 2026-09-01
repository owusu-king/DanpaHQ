import { useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type Me } from "@/auth";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { fieldErrorsFrom, isNoAccount, summaryErrorFrom } from "@/formErrors";
import { resolveEntryRoute } from "@/navigation";
import { otpInputProps, phoneInputProps } from "@/platform";
import { theme } from "@/theme";

/**
 * Recovering a forgotten password.
 *
 * The middle step deliberately does not sign anyone in: proving the number
 * returns a token that authorises exactly one password change and nothing else.
 * If a swapped SIM gets this far it reaches a password change the real owner is
 * told about by SMS, rather than a silent read of the account.
 */
const MIN_PASSWORD_LENGTH = 8;

type Step = "phone" | "code" | "password";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn, deviceFingerprint } = useAuth();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  // Not an error: the number is fine, it simply has no account behind it.
  const [noAccount, setNoAccount] = useState(false);

  async function requestCode() {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ challenge_id: string; phone_display: string }>(
        "/auth/password-reset/",
        {
          method: "POST",
          anonymous: true,
          body: { phone, device_fingerprint: deviceFingerprint },
        },
      );
      setChallengeId(result.challenge_id);
      setPhoneDisplay(result.phone_display);
      setStep("code");
    } catch (cause) {
      // Answered before any code is sent, so this arrives without the wait it
      // used to take to find out there was nothing here to reset.
      if (isNoAccount(cause)) {
        setNoAccount(true);
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ reset_token: string }>(
        "/auth/password-reset/verify/",
        {
          method: "POST",
          anonymous: true,
          body: { challenge_id: challengeId, code },
        },
      );
      setResetToken(result.reset_token);
      setStep("password");
    } catch (cause) {
      setCode("");
      setError(cause instanceof ApiFailure ? cause.error.message : "That code did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function setNewPassword() {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setError("");
    setFieldError("");
    try {
      const result = await apiFetch<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
        user: Me;
      }>("/auth/password-reset/complete/", {
        method: "POST",
        anonymous: true,
        body: {
          reset_token: resetToken,
          new_password: password,
          platform: Platform.OS === "ios" ? "ios" : "android",
          device_fingerprint: deviceFingerprint,
        },
      });
      const context = await signIn(result);
      router.replace(resolveEntryRoute(result.user, context) as never);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setFieldError(fields.new_password ?? fields.password ?? "");
      setError(summaryErrorFrom(cause, fields));
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
        <View style={{ gap: space[3] }}>
          <Type variant="display2">Reset your password</Type>
          <Type variant="body" style={{ color: theme.color.ink["700"] }}>
            {step === "phone"
              ? "Enter the number on your account and we'll text you a code."
              : step === "code"
                ? `Enter the code we sent to ${phoneDisplay}.`
                : "Choose a new password."}
          </Type>
        </View>

        {step === "phone" ? (
          <>
            <Field
              label="Mobile number"
              prefix="+233"
              placeholder="24 123 4567"
              value={phone}
              onChangeText={(value) => {
                setPhone(value);
                setNoAccount(false);
                if (error) setError("");
              }}
              maxLength={15}
              autoFocus
              {...phoneInputProps}
            />
            {error ? <Notice tone="error" title={error} /> : null}
            {noAccount ? (
              <>
                <Notice
                  tone="info"
                  title="No account for that number"
                  body="Nothing to reset here yet. Create an account to get started, or check the number above."
                />
                <Button
                  label="Create an account"
                  onPress={() => router.replace("/(auth)/phone")}
                />
              </>
            ) : (
              <Button
                label="Send code"
                busyLabel="Sending…"
                onPress={requestCode}
                busy={busy}
                disabled={phone.replace(/\D/g, "").length < 9}
              />
            )}
          </>
        ) : null}

        {step === "code" ? (
          <>
            <Field
              label="Six-digit code"
              value={code}
              onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              autoFocus
              {...otpInputProps}
            />
            {error ? <Notice tone="error" title={error} /> : null}
            <Button
              label="Confirm code"
              busyLabel="Checking…"
              onPress={confirmCode}
              busy={busy}
              disabled={code.length < 4}
            />
          </>
        ) : null}

        {step === "password" ? (
          <>
            <Field
              label="New password"
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                if (error) setError("");
                if (fieldError) setFieldError("");
              }}
              error={fieldError}
              hint={`At least ${MIN_PASSWORD_LENGTH} characters. Not all digits, and not your own number.`}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              autoFocus
            />
            {error ? <Notice tone="error" title={error} /> : null}
            <Button
              label="Set password and sign in"
              busyLabel="Saving…"
              onPress={setNewPassword}
              busy={busy}
            />
            <Notice
              tone="info"
              title="Your other devices will be signed out"
              body="Setting a new password ends every other session, so anyone who had access loses it."
            />
          </>
        ) : null}

        <View style={{ flex: 1 }} />
        <Button label="Back to sign in" variant="quiet" onPress={() => router.replace("/(auth)/sign-in")} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
