"use client";

import { useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
import { createListing, listingAction } from "@/lib/console";

export function ListingComposer({
  unitId,
  onCreated,
}: {
  unitId: string;
  onCreated: () => Promise<void>;
}) {
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [rent, setRent] = useState("");
  const [advance, setAdvance] = useState("6");
  const [caution, setCaution] = useState("0");
  const [agencyFee, setAgencyFee] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rentMinor = Math.round(Number(rent || 0) * 100);
  const months = Number(advance || 0) + Number(caution || 0) + Number(agencyFee || 0);
  const moveIn = rentMinor * months;

  return (
    <form
      style={{ display: "grid", gap: "var(--space-5)", maxWidth: "48rem" }}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          const created = await createListing({
            unit_id: unitId,
            rent_minor: rentMinor,
            headline: headline.trim(),
            description: description.trim(),
            advance_months: Number(advance || 0),
            caution_months: Number(caution || 0),
            agency_fee_months: Number(agencyFee || 0),
          });
          await listingAction(created.id, "publish");
          await onCreated();
        } catch (cause) {
          setError(cause instanceof ApiFailure ? cause.error.message : "Could not publish this listing.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <section>
        <h2 className="type-title-2" style={{ margin: "0 0 var(--space-4)" }}>What tenants will see</h2>
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <Field
            label="Headline"
            hint="Lead with the detail that helps someone recognize the home."
            placeholder="Chamber and hall in East Legon, prepaid meter"
            value={headline}
            maxLength={160}
            onChange={(event) => setHeadline(event.target.value)}
          />
          <label style={{ display: "grid", gap: "var(--space-2)" }}>
            <span className="type-caption" style={{ color: "var(--color-ink-700)" }}>Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              maxLength={3000}
              className="type-body"
              style={TEXTAREA}
            />
          </label>
        </div>
      </section>

      <section style={{ paddingTop: "var(--space-5)", borderTop: "var(--border-hairline) solid var(--color-field-200)" }}>
        <h2 className="type-title-2" style={{ margin: "0 0 var(--space-4)" }}>Rent and move-in amount</h2>
        <div style={GRID}>
          <Field label="Monthly rent (GH₵)" inputMode="decimal" value={rent} onChange={(event) => setRent(event.target.value.replace(/[^0-9.]/g, ""))} />
          <Field label="Advance (months)" inputMode="numeric" value={advance} onChange={(event) => setAdvance(event.target.value.replace(/\D/g, ""))} />
          <Field label="Deposit (months)" inputMode="numeric" value={caution} onChange={(event) => setCaution(event.target.value.replace(/\D/g, ""))} />
          <Field label="Agency fee (months)" inputMode="numeric" value={agencyFee} onChange={(event) => setAgencyFee(event.target.value.replace(/\D/g, ""))} />
        </div>
        {rentMinor > 0 ? (
          <Notice
            tone="info"
            title={`Move-in amount: GH₵${(moveIn / 100).toLocaleString("en-GH", { minimumFractionDigits: 2 })}`}
            body={`${advance || 0} months advance + ${caution || 0} deposit + ${agencyFee || 0} agency fee.`}
          />
        ) : null}
      </section>

      {error ? <Notice tone="error" title={error} body="Your listing details are still here. Review them and try again." /> : null}
      <div><Button type="submit" busy={busy} busyLabel="Publishing…" disabled={!headline.trim() || !description.trim() || rentMinor <= 0}>Publish to Explore</Button></div>
    </form>
  );
}

const GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))",
  gap: "var(--space-4)",
};

const TEXTAREA: React.CSSProperties = {
  padding: "var(--space-3)",
  background: "var(--color-field-0)",
  border: "var(--border-hairline) solid var(--color-field-300)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-ink-900)",
  resize: "vertical",
};
