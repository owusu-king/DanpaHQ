"use client";

import { useState } from "react";

import { AuthModal, AuthSide } from "@/components/auth/AuthModal";
import { GoogleIdentityButton } from "@/components/auth/GoogleIdentityButton";
import { authHref, type AuthFlowProps } from "@/components/auth/authTypes";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { apiFetch, ApiFailure } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import { getWebDeviceContext } from "@/lib/device";
import { isNotAProvider } from "@/lib/formErrors";
import { resolveWebEntry } from "@/lib/navigation";
import { safeInternalPath } from "@/lib/safeRedirect";
import { chooseWorkspace, useSession, type Me } from "@/lib/session";

/**
 * Sign in with either a linked Google subject or the existing phone/password
 * credential. Both paths enter the same server-owned session pipeline.
 *
 * On the phone path, the number says which account and the password says who
 * is signing in. On the Google path, the browser forwards Google's opaque ID
 * token and only the API verifies it and resolves the stored subject.
 *
 * The side starts on Tenant (owner, 2026-10-16); "I own or manage property"
 * arrives as provider, and the switch changes it. Telling the backend the side
 * *before* reading the entry route is what stops an existing tenant being
 * dropped back into tenant space, or a provider into it.
 *
 * Signed in, the person goes to their dashboard — `/home`, the backend's entry
 * route — unless they were in the middle of something (`next`), such as
 * applying for a home.
 */
export function SignInFlow({ params, go, close, land }: AuthFlowProps) {
  const { state, refresh, signOut } = useSession();
  const [workspace, setWorkspace] = useState<"tenant" | "provider">(params.workspace ?? "tenant");
  // Tenant is only the starting point. Sign-up asks the role first, so it is
  // handed a side only when one was asked for or picked here.
  const [sideChosen, setSideChosen] = useState(Boolean(params.workspace));
  const chosenSide = sideChosen ? workspace : undefined;
  const safeNext = safeInternalPath(params.next ?? null);

  const [phone, setPhone] = useState(params.phone ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Signed in fine, but this account is not a provider. Not a failure to fix —
  // a fact to state, with somewhere to go.
  const [notAProvider, setNotAProvider] = useState(false);

  async function enterWorkspace(initial: Me) {
    let me = initial;
    try {
      me = await chooseWorkspace(workspace);
    } catch (cause) {
      if (isNotAProvider(cause)) {
        await refresh();
        setNotAProvider(true);
        return;
      }
      throw cause;
    }
    await refresh();
    land(safeNext ?? resolveWebEntry(me));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{
        access_token: string;
        expires_in: number;
        user: Me;
      }>("/auth/sign-in/", {
        method: "POST",
        body: JSON.stringify({
          phone: phone.trim(),
          password,
          ...getWebDeviceContext(),
        }),
      });
      setAccessToken(result.access_token, result.expires_in);
      await enterWorkspace(result.user);
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not sign you in.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitGoogle(credential: string) {
    setSideChosen(true);
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{
        registration_required?: boolean;
        google_registration_ticket?: string;
        profile?: { first_name: string; last_name: string; email: string };
        access_token?: string;
        expires_in?: number;
        user?: Me;
      }>("/auth/google/", {
        method: "POST",
        body: JSON.stringify({ credential, account_type: workspace, ...getWebDeviceContext() }),
      });

      if (result.registration_required && result.google_registration_ticket && result.profile) {
        go("register", {
          workspace,
          next: safeNext,
          googleRegistration: {
            ticket: result.google_registration_ticket,
            profile: result.profile,
          },
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

  if (notAProvider) {
    return (
      <AuthModal
        title="This account is a tenant account"
        description="Provider accounts are created at sign-up. You are signed in, and your tenant space is ready."
        onClose={() => land(state.status === "signed_in" ? resolveWebEntry(state.me) : "/home")}
      >
        <Button
          className="auth-submit"
          onClick={() => land(state.status === "signed_in" ? resolveWebEntry(state.me) : "/home")}
        >
          Go to your tenant space
        </Button>
        <Button
          variant="secondary"
          className="auth-submit"
          onClick={() => {
            close();
            void signOut();
          }}
        >
          Sign out
        </Button>
      </AuthModal>
    );
  }

  return (
    <AuthModal
      title="Sign in"
      description="Choose the side you want, then continue with Google or your phone."
      onClose={close}
      footer={(
        <>
          New to Danpa HQ?
          <a
            href={authHref("register", { workspace: chosenSide, next: safeNext })}
            onClick={(event) => {
              event.preventDefault();
              go("register", { workspace: chosenSide, next: safeNext });
            }}
          >
            Create an account
          </a>
        </>
      )}
    >
      <AuthSide
        value={workspace}
        onChange={(side) => {
          setWorkspace(side);
          setSideChosen(true);
        }}
      />

      <GoogleIdentityButton onCredential={submitGoogle} text="signin_with" busy={busy} />
      <div className="auth-divider"><span>or use your phone</span></div>

      <form onSubmit={submit} className="auth-form">
        <Field
          label="Mobile number"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder="024 123 4567"
          required
        />
        <div className="auth-field-with-link">
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
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
        {workspace === "provider" ? (
          <p className="auth-note">
            Property tools open once your provider verification is approved. Signing in shows where it stands.
          </p>
        ) : null}
        {error ? <Notice tone="error" title={error} /> : null}
        <Button type="submit" className="auth-submit" busy={busy} busyLabel="Signing in…" disabled={!phone.trim() || !password}>
          Sign in
        </Button>
      </form>
    </AuthModal>
  );
}
