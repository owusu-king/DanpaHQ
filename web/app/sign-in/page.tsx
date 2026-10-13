"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AuthModal, AuthSide } from "@/components/auth/AuthModal";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { apiFetch, ApiFailure } from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import { isNotAProvider } from "@/lib/formErrors";
import { chooseWorkspace, useSession, type Me, type Workspace } from "@/lib/session";
import { resolveWebEntry } from "@/lib/navigation";
import { safeInternalPath } from "@/lib/safeRedirect";
import { getWebDeviceContext } from "@/lib/device";

/**
 * Sign in: a phone number and a password.
 *
 * The number says which account; the password says who is signing in. Those
 * used to be the same thing — an SMS code was the whole credential — which made
 * whoever held the SIM the owner of the account.
 *
 * A `workspace` query parameter carries the welcome screen's choice through.
 * Someone who arrived by tapping "I own or manage property" is asking for the
 * provider journey, and telling the backend that *before* reading the entry
 * route is what stops an existing tenant being dropped back into tenant space.
 *
 * It opens as a dialog over the front door (owner, 2026-09-29), and the side
 * can be changed in it: a quiet Tenant / Property manager switch, unset when
 * the visitor arrived without choosing, so an account that says nothing keeps
 * the side it already has.
 */
function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, activeContext, refresh, signOut } = useSession();

  const requested = searchParams.get("workspace");
  const [workspace, setWorkspace] = useState<Extract<Workspace, "tenant" | "provider"> | null>(
    requested === "tenant" || requested === "provider" ? requested : null,
  );
  const safeNext = safeInternalPath(searchParams.get("next"));
  const registrationQuery = new URLSearchParams();
  if (workspace) registrationQuery.set("workspace", workspace);
  if (safeNext) registrationQuery.set("next", safeNext);
  const registrationHref = registrationQuery.size
    ? `/register?${registrationQuery.toString()}`
    : "/register";

  // Prefilled when someone arrives from a sign-up that turned out to already
  // have an account. Retyping a number they just typed is pure friction.
  const [phone, setPhone] = useState(searchParams.get("phone") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Signed in fine, but this account is not a provider. Not a failure to fix —
  // a fact to state, with somewhere to go.
  const [notAProvider, setNotAProvider] = useState(false);
  useEffect(() => {
    if (state.status === "signed_in" && !busy && !notAProvider) {
      router.replace(resolveWebEntry(state.me, activeContext) as never);
    }
  }, [state, activeContext, busy, notAProvider, router]);

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
      if (workspace) {
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
      }
      await refresh();
      // Back to whatever they were trying to reach, when the portal sent them
      // here. Only same-origin paths are honoured — a `next` of "https://…"
      // would make this an open redirect, and the value comes from the URL.
      router.replace((safeNext ?? resolveWebEntry(me)) as never);
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
      >
        <Button className="auth-submit" onClick={() => router.replace("/rentals" as never)}>
          Go to your tenant space
        </Button>
        <Button variant="secondary" className="auth-submit" onClick={signOut}>
          Sign out
        </Button>
      </AuthModal>
    );
  }

  return (
    <AuthModal
      title="Sign in"
      description="Use the mobile number on your account and your password."
      footer={(
        <>
          New to Ghana Rental?
          <Link href={registrationHref as never}>Create an account</Link>
        </>
      )}
    >
      <AuthSide value={workspace} onChange={setWorkspace} />

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
          <Link href="/forgot-password" className="auth-field-link">Forgot password?</Link>
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

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  );
}
