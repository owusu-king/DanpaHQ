import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type Me } from "@/auth";
import { DIAL_CODE, TextLink } from "@/components/auth/AuthFields";
import {
  AuthAction,
  AuthBack,
  AuthField,
  AuthFields,
  AuthFoot,
  AuthHeading,
  AuthScene,
  CodeCells,
  RevealToggle,
} from "@/components/auth/AuthScene";
import { Notice } from "@/components/ui";
import { fieldErrorsFrom, isNoAccount, summaryErrorFrom } from "@/formErrors";
import { resolveEntryRoute } from "@/navigation";
import { phoneInputProps } from "@/platform";

/**
 * Recovering a forgotten password.
 *
 * The middle step deliberately does not sign anyone in: proving the number
 * returns a token that authorises exactly one password change and nothing else.
 * If a swapped SIM gets this far it reaches a password change the real owner is
 * told about by SMS, rather than a silent read of the account.
 *
 * Three steps on one screen, and now they are counted. A person who has
 * forgotten their password does not know whether they are one screen from being
 * back in or five; the marks are the cheapest possible answer, and they are the
 * same marks sign-up uses two screens away.
 */
const MIN_PASSWORD_LENGTH = 8;

type Step = "phone" | "code" | "password";

const STEPS: Record<Step, { at: number; line: string }> = {
  phone: { at: 1, line: "Enter the number on your account and we'll text you a code." },
  code: { at: 2, line: "" },
  password: { at: 3, line: "Choose a new password." },
};

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { signIn, deviceFingerprint } = useAuth();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
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

  const here = STEPS[step];

  return (
    <AuthScene
      progress={{ step: here.at, of: 3 }}
      header={<AuthBack label="Back to sign in" onPress={() => router.replace("/(auth)/sign-in")} />}
    >
      <AuthHeading
        title="Reset your password"
        line={step === "code" ? `Enter the code we sent to ${phoneDisplay}.` : here.line}
      />

      {step === "phone" ? (
        <>
          <AuthFields>
            <AuthField
              label="Mobile number"
              icon="call-outline"
              prefix={DIAL_CODE}
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
          </AuthFields>
          {error ? <Notice tone="error" title={error} /> : null}
          {noAccount ? (
            <>
              <Notice
                tone="info"
                title="No account for that number"
                body="Nothing to reset here yet. Create an account to get started, or check the number above."
              />
              <AuthAction
                label="Create an account"
                onPress={() => router.replace("/(auth)/phone")}
              />
            </>
          ) : (
            <AuthAction
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
          {/* The same six boxes the sign-up code screen uses. This asked for the
              same six digits in a plain labelled field, so one task looked like
              two depending on which door you came in by. */}
          <CodeCells
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
            error={Boolean(error)}
            autoFocus
          />
          {error ? <Notice tone="error" title={error} /> : null}
          <AuthAction
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
          <AuthFields>
            <AuthField
              label="New password"
              icon="lock-closed-outline"
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                if (error) setError("");
                if (fieldError) setFieldError("");
              }}
              error={fieldError}
              secureTextEntry={!reveal}
              autoComplete="new-password"
              textContentType="newPassword"
              autoFocus
              action={<RevealToggle shown={reveal} onPress={() => setReveal((shown) => !shown)} />}
            />
          </AuthFields>
          {error ? <Notice tone="error" title={error} /> : null}
          <AuthAction
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

      <AuthFoot>
        <TextLink
          label="Back to sign in"
          muted
          onPress={() => router.replace("/(auth)/sign-in")}
        />
      </AuthFoot>
    </AuthScene>
  );
}
