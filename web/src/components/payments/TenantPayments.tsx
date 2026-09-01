"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Notice } from "@/components/Notice";
import { MoneyFact } from "@/components/payments/RentAccount";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { listPaymentIntents, type PaymentIntent } from "@/lib/payments";
import { formatDate, paymentStatus } from "@/lib/rentDisplay";
import { getLeaseLedger, type LeaseLedger, type RentCharge, type RentPayment } from "@/lib/tenant";
import { listMyTenancies, tenancyLabel, type Tenancy } from "@/lib/tenancy";

type View = "due" | "history";
type Account = { tenancy: Tenancy; ledger: LeaseLedger };
type DueRow = { account: Account; charge: RentCharge; intent: PaymentIntent | null };
type HistoryRow = { account: Account; payment: RentPayment; receiptId: string | null };

const OPEN_INTENT = new Set(["created", "pending", "processing"]);
const FAILED_INTENT = new Set(["failed", "expired", "cancelled"]);

export function TenantPaymentsWorkspace() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [view, setView] = useState<View>("due");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMyTenancies(true), listPaymentIntents()])
      .then(async ([tenancies, paymentIntents]) => {
        const withLease = tenancies.filter((tenancy) => tenancy.lease?.id);
        const ledgers = await Promise.all(
          withLease.map(async (tenancy) => ({
            tenancy,
            ledger: await getLeaseLedger(tenancy.lease!.id),
          })),
        );
        if (cancelled) return;
        setAccounts(ledgers);
        setIntents(paymentIntents);
        setError("");
      })
      .catch((cause) => {
        if (cancelled) return;
        setAccounts([]);
        setError(cause instanceof ApiFailure ? cause.error.message : "We could not load your payments.");
      });
    return () => { cancelled = true; };
  }, []);

  const dueRows = useMemo<DueRow[]>(() => (accounts ?? []).flatMap((account) =>
    account.ledger.charges
      .filter((charge) => charge.outstanding_minor > 0)
      .map((charge) => ({
        account,
        charge,
        intent: intents.find((intent) => intent.obligation_id === charge.id && OPEN_INTENT.has(intent.status)) ?? null,
      })))
    .sort((a, b) => Number(b.charge.is_overdue) - Number(a.charge.is_overdue)
      || a.charge.due_on.localeCompare(b.charge.due_on)), [accounts, intents]);

  const history = useMemo<HistoryRow[]>(() => (accounts ?? []).flatMap((account) =>
    account.ledger.payments.map((payment) => ({
      account,
      payment,
      receiptId: payment.receipt_id,
    }))).sort((a, b) => b.payment.paid_on.localeCompare(a.payment.paid_on)), [accounts]);
  const unsuccessful = useMemo(() => intents.filter((intent) => FAILED_INTENT.has(intent.status))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [intents]);
  const outstanding = dueRows.reduce((total, row) => total + row.charge.outstanding_minor, 0);
  const overdue = dueRows.filter((row) => row.charge.is_overdue)
    .reduce((total, row) => total + row.charge.outstanding_minor, 0);
  const inProgress = dueRows.filter((row) => row.intent).length;
  const confirmationRows = (accounts ?? []).flatMap((account) =>
    account.ledger.payments.filter((payment) => payment.awaiting_you).map((payment) => ({ account, payment })),
  );

  return <div className="rent-workspace tenant-payments-workspace">
    <PageHeader title="Payments" description="Rent due, secure payments and the records you keep." />
    {error ? <Notice tone="error" title={error} /> : null}
    {accounts === null ? <LoadingRows rows={5} /> : null}
    {accounts?.length === 0 && !error ? <Empty title="No rent account yet" body="Your payments will appear here when an agreement creates a rent schedule." /> : null}
    {accounts?.length ? <>
      {overdue > 0 || inProgress > 0 ? <div className="tenant-payment-attention">
        {overdue > 0 ? <div><span>Needs attention</span><strong>{formatMoney({ minor: overdue, currency: "GHS" })} overdue</strong><small>Open the affected rent item below.</small></div> : null}
        {inProgress > 0 ? <div><span>Being confirmed</span><strong>{inProgress} payment {inProgress === 1 ? "in progress" : "attempts in progress"}</strong><small>Continue or check status—do not pay the same item again.</small></div> : null}
      </div> : null}
      <dl className="tenant-payment-overview">
        <MoneyFact label="Outstanding" value={outstanding} />
        <MoneyFact label="Overdue" value={overdue} overdue />
        <div><dt className="type-caption">Homes with rent accounts</dt><dd>{accounts.length}</dd></div>
      </dl>
      <div className="payments-tabs" role="tablist" aria-label="Your payments">
        <TenantTab selected={view === "due"} controls="tenant-rent-due" onClick={() => setView("due")}>Due now <span>{dueRows.length}</span></TenantTab>
        <TenantTab selected={view === "history"} controls="tenant-payment-history" onClick={() => setView("history")}>History <span>{history.length + unsuccessful.length}</span></TenantTab>
      </div>
      {view === "due" ? <section id="tenant-rent-due" role="tabpanel" aria-labelledby="tenant-rent-due-tab">
        {confirmationRows.length ? <div className="external-payment-requests" aria-label="External payments awaiting confirmation">
          {confirmationRows.map(({ account, payment }) => <article key={payment.id}>
            <span className="type-label">CONFIRM AN EXTERNAL PAYMENT</span>
            <strong>{payment.recorded_by_name} recorded receiving {payment.amount_formatted} from you via {payment.method_display}.</strong>
            <small>{payment.obligation_label} · {account.tenancy.property.title}</small>
            <Link href={`/payments/${account.tenancy.lease!.id}?mode=tenant` as never}>Review payment →</Link>
          </article>)}
        </div> : null}
        {dueRows.length ? <ul className="tenant-due-list">{dueRows.map(({ account, charge, intent }) => {
          const leaseId = account.tenancy.lease!.id;
          const action = intent
            ? `/payments/return?intent=${encodeURIComponent(intent.id)}`
            : `/payments/checkout?lease=${encodeURIComponent(leaseId)}&obligation=${encodeURIComponent(charge.id)}`;
          return <li key={charge.id}>
            <div className="tenant-due-home"><strong>{account.tenancy.property.title}</strong><span>{tenancyLabel(account.tenancy)}</span></div>
            <div className="tenant-due-purpose"><strong>{charge.kind_display}</strong><span>{charge.is_overdue ? `${charge.days_overdue} days overdue` : `Due ${formatDate(charge.due_on)}`}</span></div>
            <div className="tenant-due-amount"><strong>{charge.outstanding_formatted}</strong><span>{intent ? "Confirming payment" : charge.status_display}</span></div>
            <Link className="rent-pay-action" href={action as never}>{intent ? "Check status" : "Pay rent"}</Link>
          </li>;
        })}</ul> : <Empty title="Nothing due" body="New rent items will appear here with their purpose and due date." />}
        {dueRows.some((row) => !row.account.ledger.digital_payment.available && !row.intent) ? <p className="type-caption tenant-payment-footnote">Choose Pay rent to review the amount and current payment availability. Rooomly will explain anything this home still needs before checkout can begin.</p> : null}
      </section> : null}
      {view === "history" ? <section id="tenant-payment-history" role="tabpanel" aria-labelledby="tenant-payment-history-tab">
        {history.length ? <ul className="tenant-history-list">{history.map(({ account, payment, receiptId }) => <li key={payment.id}>
          <div><strong>{account.tenancy.property.title}</strong><span>{tenancyLabel(account.tenancy)} · {payment.method_display} · {formatDate(payment.paid_on)}</span><small>{payment.source === "EXTERNAL" ? "Paid externally · recorded through Rooomly" : "Processed through Rooomly"}</small></div>
          <div><strong>{payment.amount_formatted}</strong><span>{paymentStatus(payment)}</span></div>
          {receiptId ? <Link href={`/payments/receipts/${receiptId}` as never}>Receipt →</Link> : <Link href={`/payments/${account.tenancy.lease!.id}?mode=tenant` as never}>Details →</Link>}
        </li>)}</ul> : <Empty title="No completed payment records" body="Processor-confirmed and mutually confirmed payments will remain here." />}
        {unsuccessful.length ? <div className="tenant-attempt-history"><h2>Unsuccessful attempts</h2><p className="type-caption">These attempts did not mark rent as paid.</p><ul>{unsuccessful.map((intent) => <li key={intent.id}><span><strong>{intent.property_title}</strong><small>{intent.payment_method.replaceAll("_", " ")} · {formatDate(intent.updated_at)}</small></span><span><strong>{intent.amount_formatted}</strong><small>{intent.status === "failed" ? "Not completed" : intent.status.charAt(0).toUpperCase() + intent.status.slice(1)}</small></span></li>)}</ul></div> : null}
      </section> : null}
    </> : null}
  </div>;
}

function TenantTab({ selected, controls, onClick, children }: { selected: boolean; controls: string; onClick: () => void; children: React.ReactNode }) {
  return <button id={`${controls}-tab`} type="button" role="tab" aria-selected={selected} aria-controls={controls} tabIndex={selected ? 0 : -1} className="payments-tab type-body-strong" onClick={onClick}>{children}</button>;
}
