"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { AuthModal } from "@/components/auth/AuthModal";
import { GoogleIdentityButton } from "@/components/auth/GoogleIdentityButton";
import { MFAStep } from "@/components/auth/MFAStep";
import { isMFAChallenge, type MFAChallenge } from "@/lib/mfa";
import { authHref, type AuthFlowProps } from "@/components/auth/authTypes";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { apiFetch, ApiFailure } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import { getWebDeviceContext } from "@/lib/device";
import { fieldErrorsFrom, type FieldErrors } from "@/lib/formErrors";
import { resolveWebEntry } from "@/lib/navigation";
import { safeInternalPath } from "@/lib/safeRedirect";
import { useSession, type Me } from "@/lib/session";

/**
 * Sign in with either a linked Google subject or the existing phone/password
 * credential. Both paths enter the same server-owned session pipeline.
 *
 * On the phone path, the number says which account and the password says who
 * is signing in. On the Google path, the browser forwards Google's opaque ID
 * token and only the API verifies it and resolves the stored subject.
 *
 * Account type is chosen at registration. Login uses the existing account.
 *
 * Signed in, the person goes to their dashboard — `/home`, the backend's entry
 * route — unless they were in the middle of something (`next`), such as
 * applying for a home.
 */
export function SignInFlow({ params, go, close, land }: AuthFlowProps) {
  const { refresh } = useSession();
  const safeNext = safeInternalPath(params.next ?? null);

  const [identifier, setIdentifier] = useState(params.phone ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfa, setMfa] = useState<MFAChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  async function enterWorkspace(me: Me) {
    await refresh();
    land(safeNext ?? resolveWebEntry(me));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setShowPassword(false);
    setBusy(true);
    setError("");
    setFieldErrors({});
    try {
      const result = await apiFetch<MFAChallenge | {
        access_token: string;
        expires_in: number;
        user: Me;
      }>("/auth/sign-in/", {
        method: "POST",
        body: JSON.stringify({
          identifier: identifier.trim(),
          password,
          ...getWebDeviceContext(),
        }),
      });
      if (isMFAChallenge(result)) { setMfa(result); setPassword(""); return; }
      setAccessToken(result.access_token, result.expires_in);
      await enterWorkspace(result.user);
    } catch (cause) {
      const fields = fieldErrorsFrom(cause);
      setFieldErrors(fields);
      setError(
        Object.keys(fields).length ? "" : cause instanceof ApiFailure ? cause.error.message : "Could not sign you in.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitGoogle(credential: string) {
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<MFAChallenge | {
        registration_required?: boolean;
        google_registration_ticket?: string;
        profile?: { first_name: string; last_name: string; email: string };
        access_token?: string;
        expires_in?: number;
        user?: Me;
      }>("/auth/google/", {
        method: "POST",
        body: JSON.stringify({ credential, ...getWebDeviceContext() }),
      });

      if (isMFAChallenge(result)) { setMfa(result); setPassword(""); return; }

      if (result.registration_required) {
        go("register", {
          next: safeNext,
          googleRegistration: result.google_registration_ticket && result.profile ? {
            ticket: result.google_registration_ticket,
            profile: result.profile,
          } : undefined,
        });
        return;
      }
      if (!result.access_token || !result.user) throw new Error("Incomplete Google response");
      setAccessToken(result.access_token, result.expires_in ?? 0);
      await enterWorkspace(result.user);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not sign you in with Google.");
    } finally {
      setBusy(false);
    }
  }

  if (mfa) return <AuthModal title={mfa.stage === "enroll" ? "Set up two-factor authentication" : "Two-factor authentication"} onClose={close}>
    <MFAStep<{ access_token: string; expires_in: number; user: Me }> initial={mfa}
      request={(body) => apiFetch("/auth/mfa/", { method: "POST", body: JSON.stringify(body) })}
      onComplete={async (result) => { setAccessToken(result.access_token, result.expires_in); await enterWorkspace(result.user); setMfa(null); }}
      onCancel={() => setMfa(null)} />
  </AuthModal>;

  return (
    <AuthModal
      title="Sign in"
      description="Continue with Google or your email or phone number."
      onClose={close}
      footer={(
        <>
          New to Danpa HQ?
          <a
            href={authHref("register", { next: safeNext })}
            onClick={(event) => {
              event.preventDefault();
              go("register", { next: safeNext });
            }}
          >
            Create an account
          </a>
        </>
      )}
    >
      <GoogleIdentityButton onCredential={submitGoogle} text="signin_with" busy={busy} />
      <div className="auth-divider"><span>or use your password</span></div>

      <form onSubmit={submit} className="auth-form">
        <Field
          label="Email or Phone"
          value={identifier}
          onChange={(event) => { setIdentifier(event.target.value); setError(""); setFieldErrors({}); }}
          error={fieldErrors.identifier}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          placeholder="Email or Phone"
          required
        />
        <div className="auth-field-with-link">
          <Field
            label="Password"
            type={showPassword ? "text" : "password"}
            value={password}
          onChange={(event) => { setPassword(event.target.value); setError(""); setFieldErrors({}); }}
          error={fieldErrors.password}
            autoComplete="current-password"
            action={
              <button
                type="button"
                className="field-visibility"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            }
            required
          />
          <a
            href={authHref("forgot-password")}
            className="auth-field-link"
            onClick={(event) => {
              event.preventDefault();
              go("forgot-password", { next: safeNext });
            }}
          >
            Forgot password?
          </a>
        </div>
        {error ? <Notice tone="error" title={error} /> : null}
        <Button type="submit" className="auth-submit" busy={busy} busyLabel="Signing in…" disabled={!identifier.trim() || !password}>
          Sign in
        </Button>
      </form>
    </AuthModal>
  );
}
