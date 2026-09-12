"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { MoneyFact } from "@/components/payments/RentAccount";
import { TenantPaymentsWorkspace } from "@/components/payments/TenantPayments";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  getOrganizationPortfolio,
  listOrganizationProperties,
  listOrganizations,
  listPropertyExpenses,
  recordPropertyExpense,
  type Organization,
  type OrganizationPortfolio,
  type Property,
  type PropertyExpense,
  type ProviderTenant,
} from "@/lib/console";
import { formatMoney } from "@/lib/money";
import {
  formatDate,
  recentPaymentStatus,
  rentPriority,
  rentStatus,
  type RecentPayment,
} from "@/lib/rentDisplay";
import { useSession } from "@/lib/session";

type PaymentsView = "balances" | "records" | "payouts" | "expenses";
type BalanceFilter = "all" | "overdue" | "outstanding" | "current";

const VIEWS: PaymentsView[] = ["balances", "records", "payouts", "expenses"];
const FILTERS: BalanceFilter[] = ["all", "overdue", "outstanding", "current"];

/**
 * Which tab, which filter and what was searched live in the address.
 *
 * They were React state, which was free when the rent account opened as a modal
 * over the top of this page \u2014 closing it put everything back exactly as it was.
 * Now that the account is a page of its own, coming back from it would remount
 * this one and land somebody on Balances/All having left from a filtered list
 * of payment records. The URL is what survives a navigation, so that is where
 * this belongs.
 */
export default function ProviderPaymentsPage() {
  return (
    <Suspense fallback={<><PageHeader title="Payments" /><LoadingRows rows={5} /></>}>
      <PaymentsWorkspace />
    </Suspense>
  );
}

function PaymentsWorkspace() {
  const { state } = useSession();
  if (state.status === "loading") return <><PageHeader title="Payments" /><LoadingRows rows={5} /></>;
  if (state.status !== "signed_in") return null;
  // A Team member is in the provider experience without having declared a
  // provider journey of their own, so access is the question, not `exists`.
  const inProvider = state.me.capabilities.active_workspace === "provider"
    && (state.me.capabilities.provider.workspace_access || state.me.capabilities.provider.exists);
  return inProvider ? <ProviderPaymentsContent /> : <TenantPaymentsWorkspace />;
}

function ProviderPaymentsContent() {
  const { activeContext } = useSession();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [summary, setSummary] = useState<OrganizationPortfolio | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [expenses, setExpenses] = useState<PropertyExpense[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");

  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const view: PaymentsView = VIEWS.find((value) => value === search.get("view")) ?? "balances";
  const balanceFilter: BalanceFilter = FILTERS.find((value) => value === search.get("show")) ?? "all";
  const query = search.get("q") ?? "";

  // `replace`, so filtering does not build a history trail somebody has to walk
  // back through to leave the page.
  const setParams = useCallback((changes: Record<string, string>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const queryString = next.toString();
    // Typed routes cannot know a query string built at runtime; the path itself
    // is this page's own, so there is nothing here for them to check.
    router.replace((queryString ? `${pathname}?${queryString}` : pathname) as never, { scroll: false });
  }, [pathname, router, search]);

  const setView = useCallback((next: PaymentsView) => setParams({ view: next === "balances" ? "" : next }), [setParams]);
  const setBalanceFilter = useCallback((next: BalanceFilter) => setParams({ show: next === "all" ? "" : next }), [setParams]);
  const setQuery = useCallback((next: string) => setParams({ q: next }), [setParams]);

  useEffect(() => {
    let cancelled = false;
    listOrganizations().then((rows) => {
      if (cancelled) return;
      const preferred = activeContext?.startsWith("organization:") ? activeContext.slice("organization:".length) : "";
      setOrganizations(rows);
      setOrganizationId((current) => rows.find((row) => row.id === current)?.id ?? rows.find((row) => row.id === preferred)?.id ?? rows[0]?.id ?? "");
    }).catch((cause) => { if (!cancelled) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your Portfolios."); });
    return () => { cancelled = true; };
  }, [activeContext]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [portfolio, propertyRows, expenseRows] = await Promise.all([
        getOrganizationPortfolio(organizationId),
        listOrganizationProperties(organizationId),
        listPropertyExpenses(organizationId),
      ]);
      setSummary(portfolio); setProperties(propertyRows); setExpenses(expenseRows); setError("");
    } catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not load payments."); }
  }, [organizationId]);

  useEffect(() => { setSummary(null); void load(); }, [load, reloadKey]);

  const visibleTenants = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (summary?.tenants ?? []).filter((tenant) => balanceFilter === "all" || tenant.rent.status === balanceFilter).filter((tenant) =>
      !needle || `${tenant.name} ${tenant.property_title} ${tenant.unit_label} ${tenant.bed_label ?? ""}`.toLocaleLowerCase("en-GH").includes(needle),
    ).sort((a, b) => rentPriority(a) - rentPriority(b) || a.name.localeCompare(b.name, "en-GH"));
  }, [balanceFilter, query, summary]);
  const visiblePayments = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (summary?.recent_payments ?? []).filter((payment) => !needle || `${payment.tenant_name} ${payment.property_title} ${payment.unit_label} ${payment.method_display}`.toLocaleLowerCase("en-GH").includes(needle));
  }, [query, summary]);
  const visibleSettlements = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (summary?.recent_settlements ?? []).filter((settlement) => !needle || `${settlement.tenant_name} ${settlement.property_title} ${settlement.unit_label} ${settlement.status_display}`.toLocaleLowerCase("en-GH").includes(needle));
  }, [query, summary]);
  const activeOrganization = organizations?.find((row) => row.id === organizationId);
  const canManagePayouts = activeOrganization?.current_user_role === "owner" || activeOrganization?.current_user_role === "admin";

  return <div className="rent-workspace">
    <PageHeader title="Payments" description="See what is due, what tenants paid and what reached your settlement account." />
    {error ? <Notice tone="error" title={error} /> : null}
    {organizations === null ? <LoadingRows rows={3} /> : null}
    {organizations?.length === 0 ? <Empty title="Add a Property first" body="Rent records belong to a tenancy in your Portfolio." /> : null}
    {organizationId && !summary && !error ? <LoadingRows rows={5} /> : null}

    {summary ? <>
      {(summary.money.overdue_minor > 0 || summary.money.payment_records_awaiting_you > 0 || summary.money.awaiting_settlement_minor > 0 || summary.money.settlement_attention_minor > 0) ? <div className="rent-attention" aria-label="Payment work requiring attention">
        {summary.money.overdue_minor > 0 ? <button type="button" onClick={() => { setView("balances"); setBalanceFilter("overdue"); }}><strong>{formatMoney({ minor: summary.money.overdue_minor, currency: "GHS" })} overdue</strong><span>Open affected balances →</span></button> : null}
        {summary.money.payment_records_awaiting_you > 0 ? <button type="button" onClick={() => { setView("records"); setQuery(""); }}><strong>{summary.money.payment_records_awaiting_you} record{summary.money.payment_records_awaiting_you === 1 ? "" : "s"} to review</strong><span>Confirm or dispute tenant claims →</span></button> : null}
        {summary.money.awaiting_settlement_minor > 0 ? <button type="button" onClick={() => { setView("payouts"); setQuery(""); }}><strong>{formatMoney({ minor: summary.money.awaiting_settlement_minor, currency: "GHS" })} awaiting payout</strong><span>Track Paystack settlement →</span></button> : null}
        {summary.money.settlement_attention_minor > 0 ? <button type="button" onClick={() => { setView("payouts"); setQuery(""); }}><strong>Payout needs attention</strong><span>Review affected settlement →</span></button> : null}
      </div> : null}
      <dl className="payments-overview"><MoneyFact label="Rent recorded" value={summary.money.confirmed_received_minor} /><MoneyFact label="Settled to you" value={summary.money.settled_net_minor} /><MoneyFact label="Outstanding" value={summary.money.outstanding_minor} /><MoneyFact label="Overdue" value={summary.money.overdue_minor} overdue /></dl>
      <div className="payments-tabs" role="tablist" aria-label="Rent and payment views">
        <PaymentTab selected={view === "balances"} controls="rent-balances" onClick={() => setView("balances")}>Rent due</PaymentTab>
        <PaymentTab selected={view === "records"} controls="payment-records" onClick={() => setView("records")}>Payment records</PaymentTab>
        <PaymentTab selected={view === "payouts"} controls="settlement-history" onClick={() => setView("payouts")}>Payouts</PaymentTab>
        <PaymentTab selected={view === "expenses"} controls="expense-history" onClick={() => setView("expenses")}>Expenses</PaymentTab>
      </div>
      {view !== "expenses" ? <label className="rent-search"><span className="sr-only">Search {view === "balances" ? "rent balances" : "payment records"}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === "balances" ? "Search tenant, Property or Unit" : "Search payment records"} /></label> : null}

      {view === "balances" ? <section id="rent-balances" role="tabpanel" aria-labelledby="rent-balances-tab">
        <div className="rent-filters" aria-label="Balance status">{(["all", "overdue", "outstanding", "current"] as const).map((value) => <button key={value} type="button" aria-pressed={balanceFilter === value} onClick={() => setBalanceFilter(value)}>{value === "all" ? "All" : value.charAt(0).toUpperCase() + value.slice(1)} <span>{value === "all" ? summary.tenants.length : summary.tenants.filter((tenant) => tenant.rent.status === value).length}</span></button>)}</div>
        {visibleTenants.length ? <ul className="rent-list">{visibleTenants.map((tenant) => <RentBalanceRow key={tenant.occupancy_id} tenant={tenant} />)}</ul> : <Empty title={query ? "No matching balances" : "No balances in this view"} body={query ? "Try another tenant, Property or Unit." : "Choose another balance status."} />}
      </section> : null}

      {view === "records" ? <section id="payment-records" role="tabpanel" aria-labelledby="payment-records-tab">
        <p className="type-caption rent-section-intro">{summary.money.payment_records_awaiting_you > 0 ? "Records waiting on you come first, followed by the most recent activity. " : "The most recent records are shown here. "}Open one to inspect the full rent account and respond.</p>
        {visiblePayments.length ? <ul className="rent-list">{visiblePayments.map((payment) => <PaymentRecordRow key={payment.id} payment={payment} />)}</ul> : <Empty title={query ? "No matching records" : "No payment records yet"} body={query ? "Try another tenant, Property or payment method." : "Confirmed and tenant-recorded payments appear here."} />}
        {summary.verification.payments_ready < summary.verification.properties_total ? <p className="type-caption rent-readiness-note">Online rent collection is not ready for every Property. It needs identity, Property authority and a Portfolio settlement account the payment provider has verified. Recording money you were paid directly is unaffected.</p> : null}
      </section> : null}

      {view === "payouts" ? <section id="settlement-history" role="tabpanel" aria-labelledby="settlement-history-tab" className="settlement-history">
        <dl className="settlement-overview"><MoneyFact label="Paid online" value={summary.money.online_paid_minor} /><MoneyFact label="Awaiting settlement" value={summary.money.awaiting_settlement_minor} /><MoneyFact label="Settled to you" value={summary.money.settled_net_minor} /><MoneyFact label="Fees deducted" value={summary.money.settled_fee_minor} /></dl>
        {summary.money.awaiting_settlement_minor > 0 ? <Notice tone="info" title="Payout in progress" body={`${formatMoney({ minor: summary.money.awaiting_settlement_minor, currency: "GHS" })} has been paid by tenants and is waiting for Paystack's settlement batch. Final fee and net appear only after confirmation.`} /> : null}
        {summary.money.settlement_attention_minor > 0 ? <Notice tone="error" title="A payout needs review" body="Rooomly has not counted it as settled. The payment record remains intact while the settlement is reconciled." /> : null}
        <p className="type-caption rent-section-intro">Property owners bear Paystack’s transaction fee. Each completed payout shows the final amount after that fee and Rooomly’s configured platform charge.</p>
        {canManagePayouts ? <div className="payout-manage"><Link className="button-link secondary" href={`/payments/payout-account?organization=${organizationId}` as never}>Manage settlement account</Link></div> : null}
        {visibleSettlements.length ? <ul className="rent-list">{visibleSettlements.map((settlement) => <SettlementRow key={settlement.id} settlement={settlement} />)}</ul> : <Empty title={query ? "No matching payouts" : "No online payouts yet"} body={query ? "Try another tenant, Property or status." : "Paystack-confirmed rent and settlement progress will appear here."} />}
      </section> : null}

      {view === "expenses" ? <ExpensesSection organizationId={organizationId} properties={properties} expenses={expenses} onChanged={async () => setReloadKey((current) => current + 1)} /> : null}
    </> : null}
  </div>;
}

function PaymentTab({ selected, controls, onClick, children }: { selected: boolean; controls: string; onClick: () => void; children: React.ReactNode }) { return <button id={`${controls}-tab`} type="button" role="tab" aria-selected={selected} aria-controls={controls} tabIndex={selected ? 0 : -1} className="payments-tab type-body-strong" onClick={onClick} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? []); const current = tabs.indexOf(event.currentTarget); const next = tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]; event.preventDefault(); next?.focus(); next?.click(); }}>{children}</button>; }

function RentBalanceRow({ tenant }: { tenant: ProviderTenant }) {
  const inside = <><span className="rent-row-person"><strong>{tenant.name}</strong><span>{tenant.property_title} · {tenant.unit_label}{tenant.bed_label ? ` · ${tenant.bed_label}` : ""}</span></span><span className={`rent-row-state is-${tenant.rent.status}`}><i />{rentStatus(tenant)}</span><span className="rent-row-due">{tenant.rent.next_due_on ? `Due ${formatDate(tenant.rent.next_due_on)}` : "Nothing due"}</span><span className="rent-row-amount">{formatMoney({ minor: tenant.rent.outstanding_minor, currency: tenant.lease_rent_currency ?? "GHS" })}<small>outstanding</small></span><span className="rent-row-arrow" aria-hidden="true">›</span></>;
  // No lease means no rent account to open — the occupancy exists but nothing
  // has been scheduled against it yet.
  return <li>{tenant.lease_id
    ? <Link href={`/payments/${tenant.lease_id}` as never} className="rent-row">{inside}</Link>
    : <span className="rent-row is-inert">{inside}</span>}</li>;
}

function PaymentRecordRow({ payment }: { payment: RecentPayment }) { return <li><Link href={`/payments/${payment.lease_id}` as never} className="rent-row payment-record-row"><span className="rent-row-person"><strong>{payment.tenant_name}</strong><span>{payment.property_title} · {payment.unit_label}</span></span><span className={`rent-row-state is-${payment.awaiting_you ? "overdue" : payment.status === "confirmed" ? "current" : "outstanding"}`}><i />{recentPaymentStatus(payment)}</span><span className="rent-row-due">{payment.method_display} · {formatDate(payment.paid_on)}</span><span className="rent-row-amount">{formatMoney({ minor: payment.amount_minor, currency: payment.currency })}<small>{payment.source === "EXTERNAL" ? "External · recorded through Rooomly" : "Processed through Rooomly"}</small></span><span className="rent-row-arrow" aria-hidden="true">›</span></Link></li>; }

type Settlement = OrganizationPortfolio["recent_settlements"][number];
function SettlementRow({ settlement }: { settlement: Settlement }) {
  const settled = settlement.status === "settled" && settlement.net_minor !== null;
  const tone = settlement.status === "settled" ? "current" : settlement.status === "failed" || settlement.status === "reversed" ? "overdue" : "outstanding";
  const status = settlement.status === "settled" ? "Settled" : settlement.status === "failed" || settlement.status === "reversed" ? "Needs review" : "Payout processing";
  return <li><div className="rent-row settlement-row is-inert"><span className="rent-row-person"><strong>{settlement.tenant_name}</strong><span>{settlement.property_title} · {settlement.unit_label}</span></span><span className={`rent-row-state is-${tone}`}><i />{status}</span><span className="settlement-progress" aria-label={settled ? "Tenant paid, processor settled" : "Tenant paid, settlement pending"}><span className="is-complete">Paid</span><i /><span className={settled ? "is-complete" : ""}>Settled</span></span><span className="rent-row-amount">{formatMoney({ minor: settled ? settlement.net_minor! : settlement.gross_minor, currency: settlement.currency })}<small>{settled ? `${formatMoney({ minor: settlement.fee_minor ?? 0, currency: settlement.currency })} deducted · ${settlement.settled_at ? formatDate(settlement.settled_at) : "settled"}` : "gross paid · final payout pending"}</small></span><span /></div></li>;
}

function ExpensesSection({ organizationId, properties, expenses, onChanged }: { organizationId: string; properties: Property[]; expenses: PropertyExpense[]; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const dialogRef = useRef<HTMLDialogElement>(null); useEffect(() => { const dialog = dialogRef.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); if (!open && dialog.open) dialog.close(); }, [open]);
  return <section id="expense-history" role="tabpanel" aria-labelledby="expense-history-tab"><div className="rent-section-head"><p className="type-caption">{formatMoney({ minor: expenses.reduce((total, item) => total + item.amount_minor, 0), currency: "GHS" })} recorded in this Portfolio.</p><Button variant="secondary" onClick={() => setOpen(true)}>Record expense</Button></div>{expenses.length ? <ul className="rent-list">{expenses.map((expense) => <li className="expense-row" key={expense.id}><div><strong>{expense.category_display}</strong><span>{expense.property_title}</span></div><span>{formatDate(expense.incurred_on)}{expense.note ? ` · ${expense.note}` : ""}</span><strong>{expense.amount_formatted}</strong></li>)}</ul> : <Empty title="No expenses recorded" body="Property expenses you record appear here." />}<dialog ref={dialogRef} className="payment-dialog" aria-labelledby="expense-dialog-title" onClose={() => setOpen(false)}><h2 id="expense-dialog-title" className="type-title-1">Record Property expense</h2><p className="type-caption">This records an expense. It does not move money.</p><ExpenseForm organizationId={organizationId} properties={properties} onCancel={() => setOpen(false)} onDone={async () => { setOpen(false); await onChanged(); }} /></dialog></section>;
}

const EXPENSE_CATEGORIES = [["maintenance", "Maintenance"], ["utilities", "Utilities"], ["staff", "Staff"], ["tax", "Tax or levy"], ["supplies", "Supplies"], ["other", "Other"]] as const;
function ExpenseForm({ organizationId, properties, onCancel, onDone }: { organizationId: string; properties: Property[]; onCancel: () => void; onDone: () => Promise<void> }) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? ""); const [category, setCategory] = useState("maintenance"); const [amount, setAmount] = useState(""); const [incurredOn, setIncurredOn] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <div className="payment-dialog-fields"><label className="rent-field type-caption">Property<select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>{properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}</select></label><label className="rent-field type-caption">Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{EXPENSE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Field label="Amount (GH₵)" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /><Field label="Date" value={incurredOn} onChange={(event) => setIncurredOn(event.target.value)} type="date" /><Field label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} />{error ? <Notice tone="error" title={error} /> : null}<div className="rent-actions"><Button busy={busy} disabled={!propertyId || !amount} onClick={async () => { const amountMinor = Math.round(Number(amount) * 100); if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError("Enter a valid amount."); setBusy(true); setError(""); try { await recordPropertyExpense(organizationId, { property_id: propertyId, amount_minor: amountMinor, category, incurred_on: incurredOn, note }); await onDone(); } catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not record the expense."); } finally { setBusy(false); } }}>Save expense</Button><Button variant="quiet" disabled={busy} onClick={onCancel}>Cancel</Button></div></div>;
}
