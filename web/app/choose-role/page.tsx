"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { ApiFailure } from "@/lib/api";
import { authedFetch } from "@/lib/auth";
import { resolveWebEntry } from "@/lib/navigation";
import { type Me, useSession } from "@/lib/session";

const OPTIONS = [
  ["find_property", "Find a property", "Browse freely and sign in only when you save, view or apply."],
  ["current_tenant", "I'm a tenant", "Use a verified Unit access code to request your current home."],
  ["manage_property", "I own/manage property", "Manage residential, commercial or hostel property."],
] as const;

function ChooseRoleContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, refresh } = useSession();
  const requested = searchParams.get("next");
  const [intent, setIntent] = useState(
    requested === "/properties/new"
      ? "manage_property"
      : requested === "/tenant/setup"
        ? "current_tenant"
        : "find_property",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state.status === "signed_out") router.replace("/sign-in");
  }, [router, state.status]);

  async function continueToOnboarding() {
    setBusy(true);
    setError("");
    try {
      const me = await authedFetch<Me>("/me/onboarding/intent/", {
        method: "POST",
        body: JSON.stringify({ intent }),
      });
      await refresh();
      router.replace(resolveWebEntry(me) as never);
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
      <p className="type-label">STEP 2 OF 2</p>
      <h1 className="type-display-2">What are you here to do?</h1>
      <p className="type-body" style={{ color: "var(--color-ink-700)" }}>
        This opens the experience you need now. It does not permanently define your account.
      </p>
      <div style={{ display: "grid", gap: "var(--space-3)", margin: "var(--space-6) 0" }}>
        {OPTIONS.map(([value, title, body]) => (
          <button
            key={value}
            type="button"
            onClick={() => setIntent(value)}
            aria-pressed={intent === value}
            style={{
              textAlign: "left",
              padding: "var(--space-4)",
              cursor: "pointer",
              borderRadius: "var(--radius-md)",
              background: "var(--color-field-0)",
              border: `${intent === value ? 2 : 1}px solid var(--color-kola-600)`,
            }}
          >
            <span className="type-body-strong">{title}</span><br />
            <span className="type-caption">{body}</span>
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="type-caption">{error}</p> : null}
      <Button onClick={continueToOnboarding} busy={busy}>Continue</Button>
    </div>
  );
}

export default function ChooseRolePage() {
  return (
    <Suspense fallback={<p className="type-body" style={{ padding: "var(--space-8)" }}>Loading choices…</p>}>
      <ChooseRoleContent />
    </Suspense>
  );
}
