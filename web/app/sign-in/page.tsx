"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { AuthLink, AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { useToast } from "@/components/toast/Toaster";
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
  const { toast } = useToast();

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
  // Signed in fine, but this account is not a provider. Not a failure to fix —
  // a fact to state, with somewhere to go.
  const [notAProvider, setNotAProvider] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
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
      // A toast rather than a panel under the fields. The failure here is
      // almost never about one field — it is "that pair is wrong", "we could
      // not reach the service", "wait thirty seconds" — and a block appearing
      // mid-form pushes the button the person is aiming at further down the
      // screen as they read it.
      toast({
        tone: "error",
        title: cause instanceof ApiFailure ? cause.error.message : "Could not sign you in.",
      });
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
      <AuthShell
        title="You are not a provider"
        footer={<span>Provider accounts are created at sign-up.</span>}
      >
        <div className="mt-6 grid gap-4">
          <Notice
            tone="info"
            title="This account is registered as a tenant"
            body="Provider accounts are created at sign-up. You are signed in — your tenant space is ready when you are."
          />
          <Button onClick={() => router.replace("/rentals" as never)}>
            Go to your tenant space
          </Button>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={heading}
      lede="Use the phone number on your account and your password."
      footer={
        <>
          <span>
            <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
          </span>
          <span>
            No account yet? <AuthLink href={registrationHref}>Create one</AuthLink>
          </span>
          <span>
            <AuthLink href="/rentals">Or keep browsing without an account →</AuthLink>
          </span>
        </>
      }
    >
      {workspace === "provider" ? (
        <div className="mt-6">
          <Notice
            tone="info"
            title="Provider access is reviewed"
            body="Signing in shows you where your provider verification stands. Approval is what opens property tools."
          />
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-6 grid gap-4">
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
        <Button type="submit" busy={busy} disabled={!phone.trim() || !password}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  );
}
