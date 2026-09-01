"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { ApiFailure } from "@/lib/api";
import { authedFetch } from "@/lib/auth";
import { resolveWebEntry } from "@/lib/navigation";
import { type Me, useSession } from "@/lib/session";

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, refresh } = useSession();
  const me = state.status === "signed_in" ? state.me : null;
  const [preferredName, setPreferredName] = useState(me?.preferred_name ?? "");
  const [firstName, setFirstName] = useState(me?.first_name ?? "");
  const [lastName, setLastName] = useState(me?.last_name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state.status === "signed_out") router.replace("/sign-in");
    if (state.status === "signed_in") {
      setPreferredName((value) => value || state.me.preferred_name);
      setFirstName((value) => value || state.me.first_name);
      setLastName((value) => value || state.me.last_name);
    }
  }, [router, state]);

  async function finish() {
    setBusy(true);
    setError("");
    try {
      const updated = await authedFetch<Me>("/me/onboarding/", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: preferredName,
          first_name: firstName,
          last_name: lastName,
        }),
      });
      await refresh();
      const next = searchParams.get("next");
      const destination = updated.entry_routes.web === "/choose-role" && next?.startsWith("/")
        ? `/choose-role?next=${encodeURIComponent(next)}`
        : resolveWebEntry(updated);
      router.replace(destination as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (state.status !== "signed_in") {
    return <p className="type-body" style={{ padding: "var(--space-8)" }}>Checking your session…</p>;
  }

  return (
    <div style={{ maxWidth: "38rem", margin: "0 auto", padding: "var(--space-12) var(--space-5)" }}>
      <p className="type-label">STEP 1 OF 2</p>
      <h1 className="type-display-2">What&apos;s your name?</h1>
      <p className="type-body" style={{ color: "var(--color-ink-700)" }}>
        This creates your basic profile. We will not ask for identity documents here.
      </p>
      <div style={{ display: "grid", gap: "var(--space-4)", margin: "var(--space-6) 0" }}>
        <Field label="First name" value={firstName} onChange={(event) => setFirstName(event.target.value)} autoFocus />
        <Field label="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} />
        <Field label="Preferred name (optional)" value={preferredName} onChange={(event) => setPreferredName(event.target.value)} />
      </div>
      {error ? <p role="alert" className="type-caption">{error}</p> : null}
      <Button onClick={finish} busy={busy} disabled={!firstName.trim() || !lastName.trim()}>
        Continue
      </Button>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<p className="type-body" style={{ padding: "var(--space-8)" }}>Loading profile…</p>}>
      <OnboardingContent />
    </Suspense>
  );
}
