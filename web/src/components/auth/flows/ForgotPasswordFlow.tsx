"use client";

import { useState } from "react";

import { AuthModal } from "@/components/auth/AuthModal";
import { MFAStep } from "@/components/auth/MFAStep";
import { isMFAChallenge, type MFAChallenge } from "@/lib/mfa";
import { authHref, type AuthFlowProps } from "@/components/auth/authTypes";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { apiFetch, ApiFailure } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import { fieldErrorsFrom, summaryErrorFrom } from "@/lib/formErrors";
import { useSession, type Me } from "@/lib/session";
import { resolveWebEntry } from "@/lib/navigation";
import { safeInternalPath } from "@/lib/safeRedirect";
import { getWebDeviceContext } from "@/lib/device";

const MIN_PASSWORD_LENGTH = 8;

type Step = "identifier" | "code" | "password";

export function ForgotPasswordFlow({ params, go, close, land }: AuthFlowProps) {
  const { refresh } = useSession();
  const safeNext = safeInternalPath(params.next ?? null);

  const [step, setStep] = useState<Step>("identifier");
  const [identifier, setIdentifier] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState<MFAChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ challenge_id: string }>(
        "/auth/password-reset/",
        {
          method: "POST",
          body: JSON.stringify({ identifier: identifier.trim(), ...getWebDeviceContext() }),
        },
      );
      setChallengeId(result.challenge_id);
      setCode("");
      setStep("code");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStep("identifier");
    setCode("");
    setResetToken("");
    setPassword("");
    setError("");
    setFieldError("");
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
      const result = await apiFetch<MFAChallenge | {
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
      if (isMFAChallenge(result)) { setMfa(result); setPassword(""); return; }
      setAccessToken(result.access_token, result.expires_in);
      await refresh();
      land(safeNext ?? resolveWebEntry(result.user));
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setFieldError(fields.new_password ?? fields.password ?? "");
      setError(summaryErrorFrom(cause, fields));
    } finally {
      setBusy(false);
    }
  }

  const stepNumber = step === "identifier" ? 1 : step === "code" ? 2 : 3;

  if (mfa) return <AuthModal title="Two-factor authentication" onClose={close}>
    <MFAStep<{ access_token: string; expires_in: number; user: Me }> initial={mfa}
      request={(body) => apiFetch("/auth/mfa/", { method: "POST", body: JSON.stringify(body) })}
      onComplete={async (result) => { setAccessToken(result.access_token, result.expires_in); await refresh(); land(safeNext ?? resolveWebEntry(result.user)); }}
      onCancel={() => go("sign-in", { next: safeNext })} />
  </AuthModal>;

  // A dialog over the front door, one step at a time (owner, 2026-09-29).
  return (
    <AuthModal
      eyebrow={`Step ${stepNumber} of 3`}
      progress={stepNumber / 3}
      title={step === "password" ? "Choose a new password" : "Reset your password"}
      description={step === "identifier"
        ? "Enter a verified email address or mobile number on your account."
        : step === "code"
          ? <>If that contact is verified on your account, we sent a code to {identifier.trim()}.</>
          : "Setting it signs you in here, and out everywhere else."}
      onClose={close}
      footer={(
        <a
          href={authHref("sign-in", { next: safeNext })}
          onClick={(event) => {
            event.preventDefault();
            go("sign-in", { next: safeNext });
          }}
        >
          Back to sign in
        </a>
      )}
    >
      {step === "identifier" ? (
        <form onSubmit={requestCode} className="auth-form">
          <Field
            label="Email or mobile number"
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value);
              if (error) setError("");
            }}
            autoComplete="username"
            maxLength={254}
            required
          />
          {error ? <Notice tone="error" title={error} /> : null}
          <Button type="submit" className="auth-submit" busy={busy} busyLabel="Sending…" disabled={!identifier.trim()}>
            Send code
          </Button>
        </form>
      ) : null}

      {step === "code" ? (
        <form onSubmit={confirmCode} className="auth-form">
          <Field
            label="Six-digit code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
          />
          {error ? <Notice tone="error" title={error} /> : null}
          <Button type="submit" className="auth-submit" busy={busy} busyLabel="Checking…" disabled={code.length !== 6}>
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
            hint={`Use at least ${MIN_PASSWORD_LENGTH} characters. Avoid an all-digit password or your phone number.`}
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
      {step !== "identifier" ? <Button type="button" variant="quiet" disabled={busy} onClick={restart}>Start over or resend code</Button> : null}
    </AuthModal>
  );
}
