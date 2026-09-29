"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthModal } from "@/components/auth/AuthModal";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { apiFetch, ApiFailure } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import { fieldErrorsFrom, isNoAccount, summaryErrorFrom } from "@/lib/formErrors";
import { useSession, type Me } from "@/lib/session";
import { resolveWebEntry } from "@/lib/navigation";
import { getWebDeviceContext } from "@/lib/device";

/**
 * Recovering a forgotten password.
 *
 * Three steps, and the middle one deliberately does not sign anyone in: proving
 * the number returns a token that authorises exactly one password change and
 * nothing else. If a swapped SIM gets this far, it reaches a password change
 * the real owner is told about by SMS — not a silent read of the account.
 */
const MIN_PASSWORD_LENGTH = 8;

type Step = "phone" | "code" | "password";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { refresh } = useSession();

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

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ challenge_id: string; phone_display: string }>(
        "/auth/password-reset/",
        {
          method: "POST",
          body: JSON.stringify({ phone: phone.trim(), ...getWebDeviceContext() }),
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

  async function confirmCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ reset_token: string }>(
        "/auth/password-reset/verify/",
        {
          method: "POST",
          body: JSON.stringify({ challenge_id: challengeId, code: code.trim() }),
        },
      );
      setResetToken(result.reset_token);
      setStep("password");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That code did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function setNewPassword(event: React.FormEvent) {
    event.preventDefault();
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
        expires_in: number;
        user: Me;
      }>("/auth/password-reset/complete/", {
        method: "POST",
        body: JSON.stringify({
          reset_token: resetToken,
          new_password: password,
          ...getWebDeviceContext(),
        }),
      });
      setAccessToken(result.access_token, result.expires_in);
      await refresh();
      router.replace(resolveWebEntry(result.user) as never);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setFieldError(fields.new_password ?? fields.password ?? "");
      setError(summaryErrorFrom(cause, fields));
    } finally {
      setBusy(false);
    }
  }

  const stepNumber = step === "phone" ? 1 : step === "code" ? 2 : 3;

  // A dialog over the front door, one step at a time (owner, 2026-09-29).
  return (
    <AuthModal
      eyebrow={`Step ${stepNumber} of 3`}
      progress={stepNumber / 3}
      title={step === "password" ? "Choose a new password" : "Reset your password"}
      description={step === "phone"
        ? "Enter the number on your account and we'll text you a code."
        : step === "code"
          ? <>Enter the code we sent to {phoneDisplay}.</>
          : "Setting it signs you in here, and out everywhere else."}
      footer={<Link href="/sign-in">Back to sign in</Link>}
    >
      {step === "phone" ? (
        <form onSubmit={requestCode} className="auth-form">
          <Field
            label="Mobile number"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setNoAccount(false);
              if (error) setError("");
            }}
            inputMode="tel"
            autoComplete="tel"
            placeholder="024 123 4567"
            required
          />
          {error ? <Notice tone="error" title={error} /> : null}
          {noAccount ? (
            <>
              <p className="auth-note">
                <strong>No account for that number.</strong> Check the number above, or create an account to get started.
              </p>
              <Link
                href={`/register?phone=${encodeURIComponent(phone.trim())}` as never}
                className="btn btn-primary auth-submit"
              >
                Create an account
              </Link>
            </>
          ) : (
            <Button type="submit" className="auth-submit" busy={busy} busyLabel="Sending…" disabled={!phone.trim()}>
              Send code
            </Button>
          )}
        </form>
      ) : null}

      {step === "code" ? (
        <form onSubmit={confirmCode} className="auth-form">
          <Field
            label="Six-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
          />
          {error ? <Notice tone="error" title={error} /> : null}
          <Button type="submit" className="auth-submit" busy={busy} busyLabel="Checking…" disabled={code.trim().length < 4}>
            Confirm code
          </Button>
        </form>
      ) : null}

      {step === "password" ? (
        <form onSubmit={setNewPassword} className="auth-form">
          <Field
            label="New password"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (fieldError) setFieldError("");
            }}
            error={fieldError}
            autoComplete="new-password"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. Not all digits, and not your own number.`}
          />
          {error ? <Notice tone="error" title={error} /> : null}
          <Button type="submit" className="auth-submit" busy={busy} busyLabel="Saving…">
            Set password and sign in
          </Button>
          <p className="auth-note">
            <strong>Your other devices will be signed out.</strong> Anyone who had access loses it.
          </p>
        </form>
      ) : null}
    </AuthModal>
  );
}

