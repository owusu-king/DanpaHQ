"use client";

import { useEffect, useState } from "react";

import {
  DataTable,
  Empty,
  Fact,
  Facts,
  Feedback,
  FilterTabs,
  PageHeader,
  Panel,
  ResourceState,
  Section,
  Status,
  Toolbar,
  humanize,
  managementError,
  useNotice,
  useQueryState,
  useResource,
} from "@/components/management/ManagementUI";
import {
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
/** Rent names a tenant and a home; a Danpa HQ subscription names a Portfolio and a plan. */
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
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "accepted", label: "Accepted" },
];

export default function PaymentOperationsPage() {
  const { can } = useManagement();
  const notify = useNotice();
  const [storedFilter, setFilter] = useQueryState("status");
  const filter = (FILTERS.some((item) => item.value === storedFilter) ? storedFilter : "") as "" | ExceptionStatus;
  const [selectedId, setSelectedId] = useState("");
  const [decision, setDecision] = useState<"investigating" | "resolved" | "accepted" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resource = useResource<Snapshot>(`/payments/${filter ? `?status=${filter}` : ""}`);
  const selected = resource.data?.exceptions.find((row) => row.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !selected) setSelectedId("");
  }, [selected, selectedId]);

  async function decide() {
    if (!selected || !decision || !note.trim()) return;
    setBusy(true);
    setError("");
    try {
      await managementFetch(`/payments/reconciliation/${selected.id}/`, {
        method: "POST",
        body: JSON.stringify({ status: decision, note: note.trim() }),
        ...managementIdempotentMutation(),
      });
      notify("success", decision === "investigating" ? "Exception marked as being investigated." : "Reconciliation decision recorded.");
      setDecision(null);
      setNote("");
      await resource.reload();
    } catch (cause) {
      setError(managementError(cause, "Could not record the reconciliation decision."));
    } finally {
      setBusy(false);
    }
  }

  const counts = resource.data?.counts;
  return (
    <>
      <PageHeader
        title="Payments"
        description="Compare Danpa HQ’s immutable payment record with the provider’s evidence. Closing an exception records a decision; it never rewrites money."
      />
      {resource.loading || resource.error ? (
        <Panel><ResourceState loading={resource.loading} error={resource.error} onRetry={resource.reload} /></Panel>
      ) : null}

      {counts ? (
        <dl className="management-strip">
          <Metric label="Open exceptions" value={counts.open_exceptions} attention={counts.open_exceptions > 0} />
          <Metric label="Investigating" value={counts.investigating} />
          <Metric label="Confirmed payments" value={counts.payments_confirmed} />
          <Metric label="Awaiting settlement" value={counts.awaiting_settlement} />
          <Metric label="Settlement attention" value={counts.settlement_attention} attention={counts.settlement_attention > 0} />
        </dl>
      ) : null}

      {resource.data ? <div className="payment-operations-layout">
        <Panel title="Reconciliation queue" busy={resource.refreshing} meta={`${resource.data.exceptions.length} shown`}>
          <Toolbar>
            <FilterTabs
              label="Reconciliation status"
              value={filter}
              options={FILTERS}
              onChange={setFilter}
            />
          </Toolbar>
          {resource.data.exceptions.length ? (
            <div className="management-exception-list">
              {resource.data.exceptions.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={selectedId === item.id ? "is-selected" : ""}
                  aria-pressed={selectedId === item.id}
                  onClick={() => { setSelectedId(item.id); setDecision(null); setNote(""); setError(""); revealRecord(); }}
                >
                  <span><strong>{item.kind_display}</strong><small>{item.subject.property || item.subject.description || item.provider}{item.subject.unit ? ` · ${item.subject.unit}` : ""}</small></span>
                  <span><Status value={item.status} /><small>{formatDate(item.detected_at)}</small></span>
                </button>
              ))}
            </div>
          ) : (
            <Empty icon="payments" message="No reconciliation exceptions match this view." />
          )}
        </Panel>

        <Panel title="Exception record" id="exception-record">
          {selected ? (
            <div className="management-exception-detail">
              <div className="management-exception-heading">
                <div><span className="management-eyebrow">{humanize(selected.provider)}</span><h2>{selected.kind_display}</h2></div>
                <Status value={selected.status} />
              </div>
              <Facts>
                <Fact label="Paid by">{selected.subject.tenant || selected.subject.portfolio || "Not attached"}</Fact>
                <Fact label="Paid for">{[selected.subject.property, selected.subject.unit].filter(Boolean).join(" · ") || selected.subject.description || "Not attached"}</Fact>
                <Fact label="Amount">{selected.subject.amount_formatted || "Not attached"}</Fact>
                <Fact label="Provider reference" mono>{selected.provider_reference || "Not supplied"}</Fact>
              </Facts>
              <Section title="Compared evidence">
                <Facts>
                  {Object.entries(selected.detail).map(([key, value]) => (
                    <Fact key={key} label={humanize(key)} mono={key.includes("reference")}>{String(value ?? "—")}</Fact>
                  ))}
                </Facts>
              </Section>
              {selected.resolution_note ? <Section title="Resolution record"><blockquote className="management-quote">{selected.resolution_note}</blockquote></Section> : null}

              {can("reconcile_payments") && ["open", "investigating"].includes(selected.status) ? (
                <Section title="Decision">
                  {decision ? (
                    <div className="management-form" style={{ padding: 0 }}>
                      <label>
                        Investigation note
                        <textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} disabled={busy} placeholder="Record what you checked and why this state is correct." />
                        <small>Required. {note.length ? `${note.length} / 500` : "Kept with the exception and in the audit log."}</small>
                      </label>
                      <Feedback error={error} />
                      <div className="management-form-actions">
                        <button type="button" className="management-button primary" disabled={busy || !note.trim()} onClick={() => void decide()}>{busy ? "Recording…" : decision === "investigating" ? "Begin investigation" : decision === "resolved" ? "Record resolution" : "Accept as expected"}</button>
                        <button type="button" className="management-button" disabled={busy} onClick={() => { setDecision(null); setNote(""); }}>Go back</button>
                      </div>
                    </div>
                  ) : (
                    <div className="management-actions">
                      <button type="button" className="management-button primary" onClick={() => setDecision("resolved")}>Mark resolved</button>
                      {selected.status === "open" ? <button type="button" className="management-button" onClick={() => setDecision("investigating")}>Investigate</button> : null}
                      <button type="button" className="management-button" onClick={() => setDecision("accepted")}>Accept as expected</button>
                    </div>
                  )}
                </Section>
              ) : null}
            </div>
          ) : (
            <Empty icon="info" message="Choose an exception to see the provider comparison and its audit context." />
          )}
        </Panel>
      </div> : null}

      {resource.data ? <Panel title="Confirmed payment history" meta={`${resource.data.transactions.length} shown`}>
        {resource.data.transactions.length ? <DataTable label="Confirmed online payments">
          <thead><tr><th>Paid by</th><th>Paid for</th><th>Payment</th><th>Settlement</th><th>Refund record</th><th>Confirmed</th></tr></thead>
          <tbody>{resource.data?.transactions.map((item) => (
            <tr key={item.id}>
              <td><strong>{item.tenant || item.portfolio}</strong><span className="management-subtext">{item.provider_transaction_id}</span></td>
              <td>{item.property || item.description}<span className="management-subtext">{item.unit}</span></td>
              <td><strong>{item.amount_formatted}</strong><span className="management-subtext">{item.payment_method.replaceAll("_", " ")} · {item.provider}</span></td>
              {/* A subscription is Danpa HQ's own revenue: there is no beneficiary payout to settle. */}
              <td>{item.purpose === "subscription_invoice" ? <span className="management-subtext">Danpa HQ revenue · no payout</span> : <><Status value={item.settlement?.status ?? "missing"} />{item.settlement?.organization ? <span className="management-subtext">{item.settlement.organization}</span> : null}</>}</td>
              <td>{item.refunds.count ? `${item.refunds.count} recorded` : "None"}</td>
              <td className="is-date">{formatDate(item.occurred_at)}</td>
            </tr>
          ))}</tbody>
        </DataTable> : <Empty icon="payments" message="No confirmed online payments yet." />}
      </Panel> : null}
    </>
  );
}

/** Stacked under the queue on narrower screens, the record would otherwise open out of sight. */
function revealRecord() {
  if (!window.matchMedia("(max-width: 1100px)").matches) return;
  window.requestAnimationFrame(() => document.getElementById("exception-record")?.scrollIntoView({ block: "start" }));
}

function Metric({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return <div data-attention={attention || undefined}><dt>{label}</dt><dd>{value.toLocaleString("en-GH")}</dd></div>;
}
