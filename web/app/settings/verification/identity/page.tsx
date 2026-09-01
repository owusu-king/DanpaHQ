"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { IdentitySection } from "@/components/account/AccountSections";
import { Notice } from "@/components/Notice";
import { LoadingRows } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import { authedFetch } from "@/lib/auth";
import { useSession } from "@/lib/session";
import type { TrustEntry } from "@/lib/trust";

type TrustPayload = { trust: Record<string, TrustEntry> };

export default function IdentityVerificationPage() {
  const { refresh } = useSession();
  const [payload, setPayload] = useState<TrustPayload | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setPayload(await authedFetch<TrustPayload>("/me/"));
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "Could not load identity verification.",
      );
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="verification-task" aria-labelledby="identity-verification-title">
      <Link href="/settings/verification" className="verification-back">← Verification</Link>
      <header className="verification-heading">
        <p className="type-label">IDENTITY</p>
        <h2 id="identity-verification-title">Identity verification</h2>
        <p>Submit one clear document. This check carries across every Rooomly experience.</p>
      </header>
      {error ? <Notice tone="error" title={error} /> : null}
      {!payload && !error ? <LoadingRows rows={3} /> : null}
      {payload ? (
        <IdentitySection
          state={payload.trust.identity?.state ?? "unverified"}
          onSubmitted={async () => { await load(); await refresh(); }}
        />
      ) : null}
    </section>
  );
}
