"use client";

import { useState } from "react";

import { AuthModal, AuthSide } from "@/components/auth/AuthModal";
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
 * Sign in: a phone number and a password.
 *
 * The number says which account; the password says who is signing in. Those
 * used to be the same thing — an SMS code was the whole credential — which made
 * whoever held the SIM the owner of the account.
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

      // Tell the backend which experience they asked for, then let it say where
      // that lands. The client never decides this.
      let me = result.user;
      try {
        me = await chooseWorkspace(workspace);
      } catch (cause) {
        if (isNotAProvider(cause)) {
          // The sign-in itself succeeded, so the session stands. Only the
          // requested experience is refused.
          await refresh();
          setNotAProvider(true);
          return;
        }
        throw cause;
      }
      await refresh();
      // Only same-origin paths are honoured — a `next` of "https://…" would
      // make this an open redirect, and the value can come from an address.
      land(safeNext ?? resolveWebEntry(me));
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not sign you in.",
      );
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
      description="Use the mobile number on your account and your password."
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
