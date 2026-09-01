"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

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
 */
function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh, signOut } = useSession();

  const requested = searchParams.get("workspace");
  const workspace: Workspace | null =
    requested === "tenant" || requested === "provider" ? requested : null;
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

  const heading = workspace === "provider"
    ? "Sign in to manage property"
    : workspace === "tenant"
      ? "Sign in to your tenant space"
      : "Sign in";

  if (notAProvider) {
    return (
      <main id="main" style={{ maxWidth: "28rem", margin: "0 auto", padding: "var(--space-12) var(--space-5)" }}>
        <h1 className="type-display-2">You are not a provider</h1>
        <Notice
          tone="info"
          title="This account is registered as a tenant"
          body="Provider accounts are created at sign-up. You are signed in — your tenant space is ready when you are."
        />
        <div style={{ display: "grid", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
          <Button onClick={() => router.replace("/rentals" as never)}>
            Go to your tenant space
          </Button>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main id="main" style={{ maxWidth: "28rem", margin: "0 auto", padding: "var(--space-12) var(--space-5)" }}>
      <h1 className="type-display-2">{heading}</h1>
      <p className="type-body" style={{ color: "var(--color-ink-700)" }}>
        Use the phone number on your account and your password.
      </p>

      {workspace === "provider" ? (
        <Notice
          tone="info"
          title="Provider access is reviewed"
          body="Signing in shows you where your provider verification stands. Approval is what opens property tools."
        />
      ) : null}

      <form onSubmit={submit} style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-6)" }}>
        <Field
          label="Mobile number"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder="024 123 4567"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
        {error ? <Notice tone="error" title={error} /> : null}
        <Button type="submit" busy={busy} disabled={!phone.trim() || !password}>
          Sign in
        </Button>
      </form>

      <p className="type-caption" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p className="type-caption">
        No account yet?{" "}
        <Link href={registrationHref as never}>
          Create one
        </Link>
      </p>
      <p className="type-caption" style={{ marginTop: "var(--space-6)" }}>
        <Link href="/rentals">Or keep browsing without an account →</Link>
      </p>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  );
}
