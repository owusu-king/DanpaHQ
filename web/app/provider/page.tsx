"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { PageHeader } from "@/components/portal/PageHeader";
import { Select } from "@/components/Select";
import { ApiFailure } from "@/lib/api";
import {
  getProviderReadiness,
  getProviderStanding,
  submitProviderVerification,
  uploadFile,
  type ProviderReadiness,
  type ProviderStanding,
} from "@/lib/console";
import { chooseWorkspace, useSession } from "@/lib/session";

/**
 * Provider standing: may this person operate as a provider at all.
 *
 * Deliberately not the same screen as claiming a property. This answers a
 * question about the person and is decided once; whether they control any
 * particular address is a separate review against separate evidence, and now
 * happens inside property creation — the Documents step records the claim
 * against a property that already exists (ADR 0024).
 *
 * Every state here is read from the backend. A client that decided for itself
 * whether the workspace was open is the thing this architecture removed.
 */
const DOCUMENT_TYPES = [
  ["ghana_card_front", "Ghana Card — front"],
  ["ghana_card_back", "Ghana Card — back"],
  ["passport", "Passport"],
  ["drivers_licence", "Driver's licence"],
  ["business_certificate", "Business certificate"],
  ["agency_licence", "Agency licence"],
] as const;

export default function ProviderStandingPage() {
  const router = useRouter();
  const { state, refresh } = useSession();

  const [standing, setStanding] = useState<ProviderStanding | null>(null);
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [documentType, setDocumentType] = useState<string>("ghana_card_front");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [next, ready] = await Promise.all([
        getProviderStanding(),
        getProviderReadiness().catch(() => null),
      ]);
      setStanding(next);
      setReadiness(ready);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your status.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const stored = await uploadFile(file, "identity_document");
      await submitProviderVerification([
        { file_id: stored.id, evidence_type: documentType },
      ]);
      setFile(null);
      await load();
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : cause instanceof Error
            ? cause.message
            : "Could not submit that document.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function switchToTenant() {
    await chooseWorkspace("tenant");
    await refresh();
    router.replace("/rentals");
  }

  const capabilities = state.status === "signed_in" ? state.me.capabilities : null;
  const status = standing?.verification_status ?? "not_started";
  const canSwitchToTenant = capabilities?.available_workspaces.includes("tenant") ?? false;

  return (
    <div style={{ maxWidth: "44rem" }}>
      <PageHeader
        title="Approval to operate"
        description="A check on you, not on any building. It is asked once and carries to every property you manage; authority over a particular address is reviewed separately each time you claim one."
      />

      {error ? <Notice tone="error" title={error} /> : null}

      <section style={{ marginTop: "var(--space-8)", display: "grid", gap: "var(--space-4)" }}>
        {status === "approved" ? (
          <>
            <Notice
              tone="success"
              title="Approved"
              body="You can operate as a provider. Each property you add still needs its own authority review before it can be advertised or collect rent."
            />
            <Link href="/properties" className="type-body-strong">Go to your properties →</Link>
          </>
        ) : null}

        {status === "pending" ? (
          <>
            {/*
              Submitted is a finished step, not a holding pen. This reads as the
              success it is: they have done everything asked of them, nothing is
              outstanding on their side, and there is somewhere to go while the
              review happens.
            */}
            <Notice
              tone="success"
              title="Documents submitted"
              body="Thank you — your provider verification is with our review team. There is nothing further to send. We will let you know the outcome, and you can check back here any time."
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
              <Link href="/rentals" className="type-body-strong">Explore rentals →</Link>
              <Link href="/" className="type-body-strong">Back to home →</Link>
            </div>
          </>
        ) : null}

        {status === "needs_more_info" ? (
          <Notice
            tone="warning"
            title="We need something else"
            body={readiness?.identity_decision_note || "Send another document so the review can continue."}
          />
        ) : null}

        {status === "rejected" || status === "revoked" ? (
          <Notice
            tone="error"
            title={status === "rejected" ? "Not approved" : "Approval withdrawn"}
            body={readiness?.identity_decision_note || "Read the note above, put it right, and send it again."}
          />
        ) : null}

        {status === "not_started" ? (
          <Notice
            tone="info"
            title="Not started"
            body="Send one government-issued identity document. The same review confirms who you are and whether you may operate here, so this is the only document we need to start."
          />
        ) : null}
      </section>

      {status !== "approved" && status !== "pending" ? (
        <section style={{ marginTop: "var(--space-8)", display: "grid", gap: "var(--space-4)" }}>
          <h2 className="type-title-2" style={{ margin: 0 }}>Send a document</h2>

          <Select
            label="Document type"
            value={documentType}
            onChange={setDocumentType}
            options={DOCUMENT_TYPES}
          />
          <label className="type-caption" style={{ display: "grid", gap: "var(--space-2)" }}>
            <span style={{ color: "var(--color-ink-700)" }}>Photo or scan</span>
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <Button onClick={submit} busy={busy} disabled={!file}>
            Submit for review
          </Button>
        </section>
      ) : null}

      {canSwitchToTenant ? (
        <section style={{ marginTop: "var(--space-10)", paddingTop: "var(--space-6)", borderTop: "var(--border-hairline) solid var(--color-field-200)" }}>
          <p className="type-caption" style={{ maxWidth: "60ch" }}>
            You also rent as a tenant. Switching is only a change of view — it does not cancel this
            review, remove anything, or sign you out.
          </p>
          <Button variant="secondary" onClick={switchToTenant}>
            Switch to tenant experience
          </Button>
        </section>
      ) : null}
    </div>
  );
}
