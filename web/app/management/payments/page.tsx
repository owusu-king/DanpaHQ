"use client";

import { useEffect, useState } from "react";

import {
  DataTable,
  Feedback,
  PageHeader,
  Panel,
  ResourceState,
  Status,
  useResource,
} from "@/components/management/ManagementUI";
import {
  ManagementFailure,
  formatDate,
  managementFetch,
  managementIdempotentMutation,
  useManagement,
} from "@/lib/management";

type ExceptionStatus = "open" | "investigating" | "resolved" | "accepted";
type ReconciliationException = {
  id: string;
  kind: string;
  kind_display: string;
  status: ExceptionStatus;
  status_display: string;
  provider: string;
  provider_reference: string;
  detail: Record<string, unknown>;
  detected_at: string;
  resolved_at: string | null;
  resolved_by_management_id: string;
  resolution_note: string;
  subject: PaymentSubject & {
    intent_id: string;
    transaction_id: string;
    settlement_id: string;
    amount_formatted: string;
  };
};
/** Rent names a tenant and a home; a Rooomly subscription names a Portfolio and a plan. */
type PaymentSubject = {
  purpose: "" | "rent_obligation" | "subscription_invoice";
  tenant: string;
  property: string;
  unit: string;
  portfolio: string;
  description: string;
};
type Transaction = PaymentSubject & {
  id: string;
  provider_transaction_id: string;
  provider: string;
  status: string;
  amount_formatted: string;
  payment_method: string;
  occurred_at: string;
  settlement: null | {
    status: string;
    gross_formatted: string;
    net_formatted: string;
    organization: string;
    settled_at: string | null;
  };
  refunds: { count: number; statuses: Record<string, number> };
};
type Snapshot = {
  counts: {
    open_exceptions: number;
    investigating: number;
    payments_confirmed: number;
    awaiting_settlement: number;
    settlement_attention: number;
  };
  exceptions: ReconciliationException[];
  transactions: Transaction[];
};

const FILTERS: Array<{ value: "" | ExceptionStatus; label: string }> = [
  { value: "", label: "All exceptions" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "accepted", label: "Accepted" },
];

export default function PaymentOperationsPage() {
  const { can } = useManagement();
  const [filter, setFilter] = useState<"" | ExceptionStatus>("");
  const [selectedId, setSelectedId] = useState("");
  const [decision, setDecision] = useState<"investigating" | "resolved" | "accepted" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState({ error: "", success: "" });
  const resource = useResource<Snapshot>(`/payments/${filter ? `?status=${filter}` : ""}`);
  const selected = resource.data?.exceptions.find((row) => row.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !selected) setSelectedId("");
  }, [selected, selectedId]);

  async function decide() {
    if (!selected || !decision || !note.trim()) return;
    setBusy(true);
    setFeedback({ error: "", success: "" });
    try {
      await managementFetch(`/payments/reconciliation/${selected.id}/`, {
        method: "POST",
        body: JSON.stringify({ status: decision, note: note.trim() }),
        ...managementIdempotentMutation(),
      });
      setFeedback({
        error: "",
        success: decision === "investigating" ? "Exception marked as being investigated." : "Reconciliation decision recorded.",
      });
      setDecision(null);
      setNote("");
      await resource.reload();
    } catch (cause) {
      setFeedback({
        error: cause instanceof ManagementFailure ? cause.message : "Could not record the reconciliation decision.",
        success: "",
      });
    } finally {
      setBusy(false);
    }
  }

  const counts = resource.data?.counts;
  return (
    <>
      <PageHeader
        eyebrow="Financial integrity"
        title="Payment operations"
        description="Compare Rooomly’s immutable payment record with provider evidence. Closing an exception records a decision; it never rewrites money."
      />
      <ResourceState loading={resource.loading} error={resource.error} />
      <Feedback error={feedback.error} success={feedback.success} />

      {counts ? (
        <div className="management-grid payment-operations-metrics">
          <Metric label="Open exceptions" value={counts.open_exceptions} attention={counts.open_exceptions > 0} />
          <Metric label="Investigating" value={counts.investigating} />
          <Metric label="Confirmed payments" value={counts.payments_confirmed} />
          <Metric label="Awaiting settlement" value={counts.awaiting_settlement} />
          <Metric label="Settlement attention" value={counts.settlement_attention} attention={counts.settlement_attention > 0} />
        </div>
      ) : null}

      <div className="payment-operations-layout">
        <Panel title="Reconciliation queue" meta={`${resource.data?.exceptions.length ?? 0} shown`}>
          <div className="management-filter-strip" role="tablist" aria-label="Reconciliation status">
            {FILTERS.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={filter === item.value}
                key={item.value || "all"}
                onClick={() => { setFilter(item.value); setSelectedId(""); }}
              >
                {item.label}
              </button>
            ))}
          </div>
          {resource.data?.exceptions.length ? (
            <div className="management-exception-list">
              {resource.data.exceptions.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={selectedId === item.id ? "is-selected" : ""}
                  aria-pressed={selectedId === item.id}
                  onClick={() => { setSelectedId(item.id); setDecision(null); setNote(""); }}
                >
                  <span><strong>{item.kind_display}</strong><small>{item.subject.property || item.subject.description || item.provider} {item.subject.unit ? `· ${item.subject.unit}` : ""}</small></span>
                  <span><Status value={item.status} /><small>{formatDate(item.detected_at)}</small></span>
                </button>
              ))}
            </div>
          ) : (
            <div className="management-empty">No reconciliation exceptions match this view.</div>
          )}
        </Panel>

        <Panel title={selected ? "Exception record" : "Select an exception"}>
          {selected ? (
            <div className="management-exception-detail">
              <div className="management-exception-heading">
                <div><span className="management-eyebrow">{selected.provider}</span><h2>{selected.kind_display}</h2></div>
                <Status value={selected.status} />
              </div>
              <dl>
                <Fact label="Paid by" value={selected.subject.tenant || selected.subject.portfolio || "Not attached"} />
                <Fact label="Paid for" value={[selected.subject.property, selected.subject.unit].filter(Boolean).join(" · ") || selected.subject.description || "Not attached"} />
                <Fact label="Amount" value={selected.subject.amount_formatted || "Not attached"} />
                <Fact label="Provider reference" value={selected.provider_reference || "Not supplied"} mono />
              </dl>
              <section>
                <h3>Compared evidence</h3>
                <dl className="management-evidence-list">
                  {Object.entries(selected.detail).map(([key, value]) => (
                    <Fact key={key} label={key.replaceAll("_", " ")} value={String(value ?? "—")} mono={key.includes("reference")} />
                  ))}
                </dl>
              </section>
              {selected.resolution_note ? <section><h3>Resolution record</h3><p>{selected.resolution_note}</p></section> : null}

              {can("reconcile_payments") && ["open", "investigating"].includes(selected.status) ? (
                decision ? (
                  <div className="management-reconciliation-form">
                    <label>
                      Investigation note
                      <textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Record what you checked and why this state is correct." />
                    </label>
                    <div className="management-form-actions">
                      <button type="button" className="management-button primary" disabled={busy || !note.trim()} onClick={() => void decide()}>{busy ? "Recording…" : decision === "investigating" ? "Begin investigation" : decision === "resolved" ? "Record resolution" : "Accept as expected"}</button>
                      <button type="button" className="management-button" disabled={busy} onClick={() => { setDecision(null); setNote(""); }}>Go back</button>
                    </div>
                  </div>
                ) : (
                  <div className="management-actions">
                    {selected.status === "open" ? <button type="button" className="management-button" onClick={() => setDecision("investigating")}>Investigate</button> : null}
                    <button type="button" className="management-button primary" onClick={() => setDecision("resolved")}>Mark resolved</button>
                    <button type="button" className="management-button" onClick={() => setDecision("accepted")}>Accept as expected</button>
                  </div>
                )
              ) : null}
            </div>
          ) : (
            <div className="management-empty">Choose a queue item to inspect its provider comparison and audit context.</div>
          )}
        </Panel>
      </div>

      <Panel title="Confirmed payment history" meta={`${resource.data?.transactions.length ?? 0} shown`}>
        <DataTable label="Confirmed online payments">
          <thead><tr><th>Paid by</th><th>Paid for</th><th>Payment</th><th>Settlement</th><th>Refund record</th><th>Confirmed</th></tr></thead>
          <tbody>{resource.data?.transactions.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.tenant || item.portfolio}</strong><span className="management-subtext">{item.provider_transaction_id}</span></td>
              <td>{item.property || item.description}<span className="management-subtext">{item.unit}</span></td>
              <td><strong>{item.amount_formatted}</strong><span className="management-subtext">{item.payment_method.replaceAll("_", " ")} · {item.provider}</span></td>
              {/* A subscription is Rooomly's own revenue: there is no beneficiary payout to settle. */}
              <td>{item.purpose === "subscription_invoice" ? <span className="management-subtext">Rooomly revenue · no payout</span> : <><Status value={item.settlement?.status ?? "missing"} />{item.settlement?.organization ? <span className="management-subtext">{item.settlement.organization}</span> : null}</>}</td>
              <td>{item.refunds.count ? `${item.refunds.count} recorded` : "None"}</td>
              <td>{formatDate(item.occurred_at)}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      </Panel>
    </>
  );
}

function Metric({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return <div className="management-metric" data-attention={attention || undefined}><span>{label}</span><strong>{value}</strong></div>;
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><dt>{label}</dt><dd className={mono ? "management-mono" : undefined}>{value}</dd></div>;
}
