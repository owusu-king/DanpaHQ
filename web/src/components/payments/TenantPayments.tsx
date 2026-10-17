"use client";

/**
 * Payments, for someone who pays rent — on the shared workspace, drawn from
 * the same parts as the landlord's side (PaymentsParts), so money reads the
 * same way from both ends of it.
 *
 * Top to bottom the way a tenant thinks about rent: what to pay next (lifted
 * above everything, with the way to pay it), what needs their answer, where
 * they stand overall (three figures), then the ledger in three views — what is
 * due, what they have paid, and each home's rent account. Paying never happens
 * on this page: a due row goes to checkout, which shows the amount and what
 * the home can accept before anything is charged.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ReceiptModal } from "@/components/payments/ReceiptModal";
import { AttentionTile, Chevron, FinanceFigure, LedgerHead, PaymentTab, ghs, percent, share } from "@/components/payments/PaymentsParts";
import { Icon } from "@/components/portal/icons";
import { NextUp, PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { listPaymentIntents, type PaymentIntent } from "@/lib/payments";
import { formatDate, paymentStatus } from "@/lib/rentDisplay";
import { getLeaseLedger, type LeaseLedger, type RentCharge, type RentPayment } from "@/lib/tenant";
import { listMyTenancies, tenancyLabel, type Tenancy } from "@/lib/tenancy";

type View = "due" | "history" | "accounts";
type Account = { tenancy: Tenancy; ledger: LeaseLedger };
type DueRow = { account: Account; charge: RentCharge; intent: PaymentIntent | null };
type HistoryRow = { account: Account; payment: RentPayment; receiptId: string | null };

const VIEWS: View[] = ["due", "history", "accounts"];
const OPEN_INTENT = new Set(["created", "pending", "processing"]);
const FAILED_INTENT = new Set(["failed", "expired", "cancelled"]);

/** Where a due row goes: checkout for it, or the attempt already under way. */
function payHref(row: DueRow) {
  return row.intent
    ? `/payments/return?intent=${encodeURIComponent(row.intent.id)}`
    : `/payments/checkout?lease=${encodeURIComponent(row.account.tenancy.lease!.id)}&obligation=${encodeURIComponent(row.charge.id)}`;
}

function accountHref(account: Account) {
  return `/payments/${account.tenancy.lease!.id}?mode=tenant`;
}

export function TenantPaymentsWorkspace() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [intents, setIntents] = useState<PaymentIntent[]>([]);
  const [receiptOpen, setReceiptOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // The view lives in the address, so coming back from checkout or a rent
  // account lands on the one that was left.
  const view: View = VIEWS.find((value) => value === search.get("view")) ?? "due";
  const setView = useCallback((next: View) => {
    const params = new URLSearchParams(search.toString());
    if (next === "due") params.delete("view");
    else params.set("view", next);
    const query = params.toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as never, { scroll: false });
  }, [pathname, router, search]);

  const load = useCallback(async () => {
    try {
      // Ended tenancies too: a closed rent account is still somebody's record.
      const [tenancies, paymentIntents] = await Promise.all([listMyTenancies(true), listPaymentIntents()]);
      const withLease = tenancies.filter((tenancy) => tenancy.lease?.id);
      const ledgers = await Promise.all(
        withLease.map(async (tenancy) => ({ tenancy, ledger: await getLeaseLedger(tenancy.lease!.id) })),
      );
      setAccounts(ledgers);
      setIntents(paymentIntents);
      setError("");
    } catch (cause) {
      setAccounts((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load your payments.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function retry() {
    setRetrying(true);
    await load();
    setRetrying(false);
  }

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
  const overdue = dueRows.filter((row) => row.charge.is_overdue).reduce((total, row) => total + row.charge.outstanding_minor, 0);
  const paid = history.filter((row) => row.payment.is_confirmed).reduce((total, row) => total + row.payment.amount_minor, 0);
  const overdueCount = dueRows.filter((row) => row.charge.is_overdue).length;
  const confirmationRows = (accounts ?? []).flatMap((account) =>
    account.ledger.payments.filter((payment) => payment.awaiting_you).map((payment) => ({ account, payment })),
  );
  // The next thing to pay: the most overdue item, else the soonest due — never
  // one already being paid, which would invite paying it twice.
  const next = dueRows.find((row) => !row.intent) ?? null;

  const loading = accounts === null;
  const none = !loading && !accounts.length;
  const single = accounts?.length === 1 ? accounts[0]! : null;

  return <div className="ws-page rent-workspace tenant-payments-workspace">
    <WorkspaceHead
      icon="payments"
      title="Payments"
      summary={loading || (error && none) ? null : none ? "Rent due, secure payments and the records you keep." : (
        <>
          {overdue > 0 ? <span data-tone="critical">{ghs(overdue)} overdue</span> : outstanding > 0 ? <span data-tone="warning">{ghs(outstanding)} to pay</span> : <strong>You’re paid up</strong>}
          <span className="ws-summary-sep" aria-hidden="true">·</span>
          {accounts!.length} {accounts!.length === 1 ? "home" : "homes"}
        </>
      )}
      actions={single ? <Link className="ws-action" href={accountHref(single) as never}><Icon name="details" />Rent account</Link> : null}
    />

    {error && accounts?.length ? <div className="ws-inline-error payments-inline-error" role="alert"><Icon name="warning" /><span>{error}</span><button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? "Retrying…" : "Try again"}</button></div> : null}

    {loading ? <section className="ws-panel" aria-busy="true" aria-label="Payments"><PanelSkeleton rows={4} /></section> : null}

    {none ? (
      <section className="ws-panel" aria-label="Payments">
        {error ? (
          <PanelState tone="error" icon="warning" title="Payments didn’t load" body={`${error} Check your connection and try again.`}
            action={<button type="button" className="ws-action" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button>} />
        ) : (
          <PanelState icon="payments" title="No rent account yet" body="Once you accept an agreement, its rent schedule appears here — what is due, when, and every payment you make."
            action={<Link href="/leases" className="ws-action is-primary"><Icon name="leases" />See your agreements</Link>} />
        )}
      </section>
    ) : null}

    {accounts?.length ? <>
      {next ? (
        <NextUp
          tone={next.charge.is_overdue ? "overdue" : undefined}
          eyebrow={next.charge.is_overdue ? `Overdue · ${next.charge.days_overdue} day${next.charge.days_overdue === 1 ? "" : "s"}` : `Next due · ${formatDate(next.charge.due_on)}`}
          title={next.charge.kind_display}
          detail={[next.account.tenancy.property.title, tenancyLabel(next.account.tenancy)].filter(Boolean).join(" · ")}
          hint={next.account.ledger.digital_payment.available
            ? "You review the amount and choose how to pay before anything is charged."
            : "Open it to see the amount and anything this home still needs before you can pay online."}
          icon="payments"
          more={{ count: dueRows.filter((row) => !row.intent).length - 1, onShow: () => setView("due") }}
          onOpen={() => router.push(payHref(next) as never)}
          action={{ label: `Pay ${next.charge.outstanding_formatted ?? ghs(next.charge.outstanding_minor)}`, href: payHref(next) }}
        />
      ) : null}

      {confirmationRows.length ? <div className="rent-attention" aria-label="External payments awaiting confirmation">
        {confirmationRows.map(({ account, payment }) => (
          <AttentionTile
            key={payment.id}
            tone="review"
            icon="check"
            title={`${payment.recorded_by_name} recorded ${payment.amount_formatted} from you`}
            action={`Confirm an external payment · ${payment.method_display} · ${account.tenancy.property.title}`}
            onClick={() => router.push(accountHref(account) as never)}
          />
        ))}
      </div> : null}

      {/* Where they stand: what they have paid, what is left, and what is late. */}
      <dl className="payments-overview is-tenant" aria-label="Your rent">
        <FinanceFigure
          trend="settled"
          tone="received"
          label="Paid so far"
          value={paid}
          ratio={share(paid, paid + outstanding)}
          note={paid + outstanding ? `${percent(paid, paid + outstanding)} of rent billed so far` : "Nothing billed yet"}
        />
        <FinanceFigure
          trend="flat"
          tone="outstanding"
          label="To pay"
          value={outstanding}
          ratio={share(outstanding, paid + outstanding)}
          note={dueRows.length ? `${dueRows.length} item${dueRows.length === 1 ? "" : "s"} open` : "Nothing open"}
        />
        <FinanceFigure
          trend="down"
          tone="overdue"
          label="Overdue"
          value={overdue}
          ratio={share(overdue, outstanding)}
          note={overdueCount ? `${overdueCount} item${overdueCount === 1 ? " is" : "s are"} late` : "Nothing late"}
        />
      </dl>

      <div className="payments-tabs" role="tablist" aria-label="Your payments">
        <PaymentTab selected={view === "due"} controls="tenant-rent-due" icon="clock" count={dueRows.length} alert={overdueCount > 0} onClick={() => setView("due")}>Due now</PaymentTab>
        <PaymentTab selected={view === "history"} controls="tenant-payment-history" icon="check" onClick={() => setView("history")}>History</PaymentTab>
        <PaymentTab selected={view === "accounts"} controls="tenant-rent-accounts" icon="properties" onClick={() => setView("accounts")}>Rent accounts</PaymentTab>
      </div>

      {view === "due" ? <section id="tenant-rent-due" role="tabpanel" aria-labelledby="tenant-rent-due-tab" className="ws-panel payments-panel">
        {dueRows.length ? <div className="payments-ledger">
          <LedgerHead columns={["Rent item", "Standing", "Due", "Amount"]} />
          <ul className="rent-list">{dueRows.map((row, index) => <DueRowItem key={row.charge.id} row={row} order={index} />)}</ul>
        </div> : <PanelState icon="check" title="You’re paid up" body="New rent items appear here with what they are for and when they are due." />}
        {dueRows.some((row) => !row.account.ledger.digital_payment.available && !row.intent) ? <p className="rent-readiness-note"><Icon name="info" /><span>Choose Pay rent to review the amount and current payment availability. Danpa HQ will explain anything this home still needs before checkout can begin.</span></p> : null}
      </section> : null}

      {view === "history" ? <section id="tenant-payment-history" role="tabpanel" aria-labelledby="tenant-payment-history-tab" className="ws-panel payments-panel">
        {history.length ? <div className="payments-ledger">
          <LedgerHead columns={["Payment", "Status", "Method and date", "Amount"]} />
          <ul className="rent-list">{history.map((row, index) => <HistoryRowItem key={row.payment.id} row={row} order={index} onReceipt={setReceiptOpen} />)}</ul>
        </div> : <PanelState icon="details" title="No payments yet" body="Processor-confirmed and mutually confirmed payments stay here, each with its receipt." />}
        {unsuccessful.length ? <section className="ws-group tenant-attempts" aria-labelledby="tenant-attempts-heading">
          <h2 className="ws-group-heading" id="tenant-attempts-heading">Unsuccessful attempts<span>{unsuccessful.length}</span></h2>
          <p className="tenant-attempts-note">These attempts did not mark rent as paid.</p>
          <ul className="rent-list">{unsuccessful.map((intent) => <li key={intent.id} data-tone="failed">
            <span className="rent-row is-inert">
              <span className="rent-row-person">
                <span className="rent-row-avatar" data-kind="attempt" aria-hidden="true"><Icon name="close" /></span>
                <span><strong>{intent.property_title}</strong><span>{intent.unit_label}</span></span>
              </span>
              <span className="rent-row-state is-failed"><i />{intent.status === "failed" ? "Not completed" : intent.status.charAt(0).toUpperCase() + intent.status.slice(1)}</span>
              <span className="rent-row-due is-inline">{intent.payment_method.replaceAll("_", " ")}<small>{formatDate(intent.updated_at)}</small></span>
              <span className="rent-row-amount" data-zero>{intent.amount_formatted}</span>
              <span />
            </span>
          </li>)}</ul>
        </section> : null}
      </section> : null}

      {view === "accounts" ? <section id="tenant-rent-accounts" role="tabpanel" aria-labelledby="tenant-rent-accounts-tab" className="ws-panel payments-panel">
        <div className="payments-ledger">
          <LedgerHead columns={["Home", "Tenancy", "Next due", "Outstanding"]} />
          <ul className="rent-list">{accounts.map((account, index) => <AccountRowItem key={account.tenancy.id} account={account} order={index} />)}</ul>
        </div>
      </section> : null}
    </> : null}
    <ReceiptModal receiptId={receiptOpen} onClose={() => setReceiptOpen(null)} />
  </div>;
}

/** One unpaid item. The row is the way to pay it — or to the attempt already under way. */
function DueRowItem({ row, order }: { row: DueRow; order: number }) {
  const { account, charge, intent } = row;
  const tone = intent ? "waiting" : charge.is_overdue ? "overdue" : "outstanding";
  return <li data-tone={tone} style={{ "--rent-order": Math.min(order, 12) } as React.CSSProperties}>
    <Link className="rent-row is-payable" href={payHref(row) as never} aria-label={`${intent ? "Check status of" : "Pay"} ${charge.kind_display} for ${account.tenancy.property.title}, ${charge.outstanding_formatted ?? ghs(charge.outstanding_minor)}`}>
      <span className="rent-row-person">
        <span className="rent-row-avatar" data-kind="charge" aria-hidden="true"><Icon name={charge.kind === "rent" ? "payments" : "leases"} /></span>
        <span><strong>{charge.kind_display}</strong><span>{account.tenancy.property.title} · {tenancyLabel(account.tenancy)}</span></span>
      </span>
      <span className={`rent-row-state is-${tone}`}><Icon name={intent ? "clock" : charge.is_overdue ? "warning" : "clock"} />{intent ? "Being confirmed" : charge.is_overdue ? `${charge.days_overdue} days overdue` : charge.status_display}</span>
      <span className="rent-row-due"><strong>{formatDate(charge.due_on)}</strong></span>
      <span className="rent-row-amount">{charge.outstanding_formatted ?? ghs(charge.outstanding_minor)}{charge.outstanding_minor < charge.amount_minor ? <small>of {charge.amount_formatted}</small> : null}</span>
      <span className="rent-row-pay">{intent ? "Check status" : "Pay rent"}<Chevron /></span>
    </Link>
  </li>;
}

/** One payment: its receipt when it has one, else the account it belongs to. */
function HistoryRowItem({ row, order, onReceipt }: { row: HistoryRow; order: number; onReceipt: (id: string) => void }) {
  const { account, payment, receiptId } = row;
  const tone = payment.evidence === "PSP_CONFIRMED" || payment.status === "confirmed"
    ? "confirmed"
    : payment.status === "disputed" ? "disputed" : payment.awaiting_you ? "review" : "waiting";
  const inside = <>
    <span className="rent-row-person">
      <span className="rent-row-avatar" data-kind="record" aria-hidden="true"><Icon name="payments" /></span>
      <span><strong>{payment.obligation_label || account.tenancy.property.title}</strong><span>{account.tenancy.property.title} · {tenancyLabel(account.tenancy)}</span></span>
    </span>
    <span className={`rent-row-state is-${tone}`}><Icon name={tone === "confirmed" ? "check" : tone === "disputed" || tone === "review" ? "warning" : "clock"} />{paymentStatus(payment)}</span>
    <span className="rent-row-due is-inline">{payment.method_display}<small>{formatDate(payment.paid_on)}</small></span>
    <span className="rent-row-amount">{payment.amount_formatted}<small>{payment.source === "EXTERNAL" ? "Paid externally" : "Through Danpa HQ"}</small></span>
    <span className="rent-row-arrow" aria-hidden="true"><Chevron /></span>
  </>;
  return <li data-tone={tone} style={{ "--rent-order": Math.min(order, 12) } as React.CSSProperties}>
    {receiptId
      ? <button type="button" className="rent-row" aria-haspopup="dialog" aria-label={`Open the receipt for ${payment.amount_formatted}, ${formatDate(payment.paid_on)}`} onClick={() => onReceipt(receiptId)}>{inside}</button>
      : <Link className="rent-row" href={accountHref(account) as never}>{inside}</Link>}
  </li>;
}

/** One home's rent account: every charge and payment on that tenancy. */
function AccountRowItem({ account, order }: { account: Account; order: number }) {
  const { tenancy, ledger } = account;
  const open = ledger.charges.filter((charge) => charge.outstanding_minor > 0);
  const owed = open.reduce((total, charge) => total + charge.outstanding_minor, 0);
  const late = open.some((charge) => charge.is_overdue);
  const nextDue = [...open].sort((a, b) => a.due_on.localeCompare(b.due_on))[0] ?? null;
  const tone = tenancy.status === "ended" ? "ended" : late ? "overdue" : owed ? "outstanding" : "current";
  return <li data-tone={tone} style={{ "--rent-order": Math.min(order, 12) } as React.CSSProperties}>
    <Link className="rent-row" href={accountHref(account) as never}>
      <span className="rent-row-person">
        <span className="rent-row-avatar" data-kind="home" aria-hidden="true"><Icon name="properties" /></span>
        <span><strong>{tenancy.property.title}</strong><span>{[tenancyLabel(tenancy), tenancy.property.locality].filter(Boolean).join(" · ")}</span></span>
      </span>
      <span className={`rent-row-state is-${tone === "ended" ? "ended" : tone}`}><Icon name={tone === "overdue" ? "warning" : tone === "outstanding" ? "clock" : "check"} />{tenancy.status === "ended" ? "Ended" : late ? "Overdue" : owed ? "To pay" : "Paid up"}</span>
      <span className="rent-row-due">{nextDue ? <strong>{formatDate(nextDue.due_on)}</strong> : "Nothing due"}</span>
      <span className="rent-row-amount" data-zero={owed === 0 || undefined}>{ghs(owed)}<small>{ledger.payments.length} payment{ledger.payments.length === 1 ? "" : "s"}</small></span>
      <span className="rent-row-arrow" aria-hidden="true"><Chevron /></span>
    </Link>
  </li>;
}
