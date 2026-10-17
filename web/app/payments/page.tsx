"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { Notice } from "@/components/Notice";
import { PaymentRecordModal } from "@/components/payments/PaymentRecordModal";
import { ReceiptModal } from "@/components/payments/ReceiptModal";
import { AttentionTile, Chevron, FinanceFigure, LedgerHead, PaymentTab, ghs, percent, share } from "@/components/payments/PaymentsParts";
import { RentDueModal } from "@/components/payments/RentDueModal";
import { RecordPaymentForm } from "@/components/payments/RentAccount";
import { TenantPaymentsWorkspace } from "@/components/payments/TenantPayments";
import { Icon, type IconName } from "@/components/portal/icons";
import { useToast } from "@/components/toast/Toaster";
import { PanelSearch, PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { useDeepLinkedModal } from "@/lib/deepLinkedModal";
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
import { getLeaseLedger, type LeaseLedger } from "@/lib/tenant";

type PaymentsView = "balances" | "records" | "payouts" | "expenses";
type BalanceFilter = "all" | "overdue" | "outstanding" | "current";

const VIEWS: PaymentsView[] = ["balances", "records", "payouts", "expenses"];
const FILTERS: BalanceFilter[] = ["all", "overdue", "outstanding", "current"];

const FILTER_LABEL: Record<BalanceFilter, string> = {
  all: "All",
  overdue: "Overdue",
  outstanding: "Due",
  current: "Current",
};


/**
 * Which tab, which filter and what was searched live in the address.
 *
 * They were React state, which was free when the rent account opened as a modal
 * over the top of this page — closing it put everything back exactly as it was.
 * Now that the account is a page of its own, coming back from it would remount
 * this one and land somebody on Balances/All having left from a filtered list
 * of payment records. The URL is what survives a navigation, so that is where
 * this belongs.
 */
export default function ProviderPaymentsPage() {
  return (
    <Suspense fallback={<PaymentsLoading />}>
      <PaymentsWorkspace />
    </Suspense>
  );
}

function PaymentsLoading() {
  return (
    <div className="ws-page rent-workspace payments-page">
      <WorkspaceHead icon="payments" title="Payments" />
      <section className="ws-panel" aria-busy="true" aria-label="Payments"><PanelSkeleton rows={5} round /></section>
    </div>
  );
}

function PaymentsWorkspace() {
  const { state } = useSession();
  // A receipt, from a link (the retired receipt page and the payment return
  // send `?receipt=`), read in its sheet over whichever side of Payments this is.
  const [receiptId, setReceiptId] = useDeepLinkedModal("receipt");
  if (state.status === "loading") return <PaymentsLoading />;
  if (state.status !== "signed_in") return null;
  // A Team member is in the provider experience without having declared a
  // provider journey of their own, so access is the question, not `exists`.
  const inProvider = state.me.capabilities.active_workspace === "provider"
    && (state.me.capabilities.provider.workspace_access || state.me.capabilities.provider.exists);
  return <>
    {inProvider ? <ProviderPaymentsContent /> : <TenantPaymentsWorkspace />}
    <ReceiptModal receiptId={receiptId || null} onClose={() => setReceiptId("")} />
  </>;
}

/**
 * The provider's finance workspace.
 *
 * Read top to bottom the way money is: what the Portfolio has taken and is
 * still owed (the four figures), what needs an answer now (the attention
 * tiles), then the ledger itself in four views — rent due, the payment records
 * behind it, what reached the settlement account, and the costs recorded
 * against it. Every row that has an account opens it at its own address.
 */
function ProviderPaymentsContent() {
  const { activeContext } = useSession();
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [summary, setSummary] = useState<OrganizationPortfolio | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [expenses, setExpenses] = useState<PropertyExpense[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);

  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const view: PaymentsView = VIEWS.find((value) => value === search.get("view")) ?? "balances";
  const balanceFilter: BalanceFilter = FILTERS.find((value) => value === search.get("show")) ?? "all";
  const query = search.get("q") ?? "";
  // A plain click reads a payment record in a sheet over the list; the row is
  // still a link to the tenant's rent account.
  const [openRecordId, setOpenRecordId] = useDeepLinkedModal("record");
  // The same for a tenant's payments, by lease: Rent due opens it, and so do
  // links from Tenants, Home and a tenancy's record (`?due=`, once).
  const [openDueId, setOpenDueId] = useDeepLinkedModal("due");
  // Arriving to record a payment for one tenant (`?payfor=`, from the Tenants sheet).
  const [payFor, setPayFor] = useDeepLinkedModal("payfor");
  // Record payment, opened on a tenant from their balance rather than from the pick.
  const [recordFor, setRecordFor] = useState<ProviderTenant | null>(null);

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
  const openedDue = openDueId ? summary?.tenants.find((tenant) => tenant.lease_id === openDueId) ?? null : null;
  useEffect(() => {
    if (!payFor || !summary) return;
    const tenant = summary.tenants.find((row) => row.lease_id === payFor);
    setPayFor("");
    if (!tenant) return;
    setRecordFor(tenant);
    setRecordingPayment(true);
  }, [payFor, summary, setPayFor]);
  const openedRecord = openRecordId ? summary?.recent_payments.find((payment) => payment.id === openRecordId) ?? null : null;
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

  const balanceCounts = useMemo(() => {
    const tenants = summary?.tenants ?? [];
    return {
      all: tenants.length,
      overdue: tenants.filter((tenant) => tenant.rent.status === "overdue").length,
      outstanding: tenants.filter((tenant) => tenant.rent.status === "outstanding").length,
      current: tenants.filter((tenant) => tenant.rent.status === "current").length,
    };
  }, [summary]);

  async function retry() {
    setRetrying(true);
    setError("");
    await load();
    setRetrying(false);
  }

  const loading = organizations === null || (Boolean(organizationId) && !summary && !error);
  const hasAttention = Boolean(summary && (summary.money.overdue_minor > 0 || summary.money.payment_records_awaiting_you > 0 || summary.money.settlement_attention_minor > 0));

  return <div className="ws-page rent-workspace payments-page">
    <WorkspaceHead
      icon="payments"
      title="Payments"
      summary={summary ? (
        <>
          <strong>{summary.tenants.length} {summary.tenants.length === 1 ? "tenancy" : "tenancies"}</strong>
          {summary.money.overdue_minor > 0 ? <><span className="ws-summary-sep" aria-hidden="true">·</span><span data-tone="critical">{ghs(summary.money.overdue_minor)} overdue</span></> : null}
          {summary.money.payment_records_awaiting_you > 0 ? <><span className="ws-summary-sep" aria-hidden="true">·</span><span data-tone="warning">{summary.money.payment_records_awaiting_you} to review</span></> : null}
          {!summary.money.overdue_minor && !summary.money.payment_records_awaiting_you ? <><span className="ws-summary-sep" aria-hidden="true">·</span>Nothing is waiting on you</> : null}
        </>
      ) : loading ? null : "See what is due, what tenants paid and what reached your settlement account."}
      actions={summary ? (
        <>
          <button type="button" className="ws-action" onClick={() => setRecording(true)}><PlusGlyph />Record expense</button>
          <button type="button" className="ws-action is-primary" onClick={() => setRecordingPayment(true)}><PlusGlyph />Record payment</button>
        </>
      ) : null}
    />

    {error && summary ? <div className="ws-inline-error payments-inline-error" role="alert"><Icon name="warning" /><span>{error}</span><button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? "Retrying…" : "Try again"}</button></div> : null}

    {loading ? <section className="ws-panel" aria-busy="true" aria-label="Payments"><PanelSkeleton rows={5} round /></section> : null}

    {!loading && error && !summary ? (
      <section className="ws-panel" aria-label="Payments">
        <PanelState tone="error" icon="warning" title="Payments didn’t load" body={error} action={<Button variant="secondary" size="sm" busy={retrying} busyLabel="Retrying…" onClick={() => void retry()}>Try again</Button>} />
      </section>
    ) : null}

    {organizations?.length === 0 ? (
      <section className="ws-panel" aria-label="Payments">
        <PanelState icon="properties" title="Add a Property first" body="Rent records belong to a tenancy in your Portfolio." action={<Link href="/properties" className="btn btn-quiet btn-sm">Open Properties</Link>} />
      </section>
    ) : null}

    {summary ? <>
      {/* The four figures a Portfolio is run by: what came in, what reached the
          owner, what is still owed and what is late. */}
      <dl className="payments-overview" aria-label="Portfolio money">
        <FinanceFigure
          trend="up"
          tone="received"
          label="Rent recorded"
          value={summary.money.confirmed_received_minor}
          ratio={share(summary.money.confirmed_received_minor, summary.money.confirmed_received_minor + summary.money.outstanding_minor)}
          note={`${percent(summary.money.confirmed_received_minor, summary.money.confirmed_received_minor + summary.money.outstanding_minor)} of rent due collected`}
        />
        <FinanceFigure
          trend="settled"
          tone="settled"
          label="Settled to you"
          value={summary.money.settled_net_minor}
          ratio={share(summary.money.settled_net_minor, summary.money.online_paid_minor)}
          note={summary.money.online_paid_minor ? `${percent(summary.money.settled_net_minor, summary.money.online_paid_minor)} of online rent settled` : "No online rent yet"}
        />
        <FinanceFigure
          trend="flat"
          tone="outstanding"
          label="Outstanding"
          value={summary.money.outstanding_minor}
          ratio={share(summary.money.outstanding_minor, summary.money.confirmed_received_minor + summary.money.outstanding_minor)}
          note={`${balanceCounts.outstanding + balanceCounts.overdue} ${balanceCounts.outstanding + balanceCounts.overdue === 1 ? "tenancy" : "tenancies"} with a balance`}
        />
        <FinanceFigure
          trend="down"
          tone="overdue"
          label="Overdue"
          value={summary.money.overdue_minor}
          ratio={share(summary.money.overdue_minor, summary.money.outstanding_minor)}
          note={balanceCounts.overdue ? `${percent(summary.money.overdue_minor, summary.money.outstanding_minor)} of the balance is late` : "Nothing late"}
        />
      </dl>

      {hasAttention ? <div className="rent-attention" aria-label="Payment work requiring attention">
        {summary.money.overdue_minor > 0 ? <AttentionTile tone="overdue" icon="warning" title={`${ghs(summary.money.overdue_minor)} overdue`} action="Open affected balances" onClick={() => { setView("balances"); setBalanceFilter("overdue"); }} /> : null}
        {summary.money.payment_records_awaiting_you > 0 ? <AttentionTile tone="review" icon="check" title={`${summary.money.payment_records_awaiting_you} record${summary.money.payment_records_awaiting_you === 1 ? "" : "s"} to review`} action="Confirm or dispute tenant claims" onClick={() => { setView("records"); setQuery(""); }} /> : null}
        {summary.money.settlement_attention_minor > 0 ? <AttentionTile tone="overdue" icon="warning" title="Payout needs attention" action="Review affected settlement" onClick={() => { setView("payouts"); setQuery(""); }} /> : null}
      </div> : null}

      <div className="payments-tabs" role="tablist" aria-label="Rent and payment views">
        <PaymentTab selected={view === "balances"} controls="rent-balances" icon="users" count={balanceCounts.overdue + balanceCounts.outstanding} alert={balanceCounts.overdue > 0} onClick={() => setView("balances")}>Rent due</PaymentTab>
        <PaymentTab selected={view === "records"} controls="payment-records" icon="details" count={summary.money.payment_records_awaiting_you} alert={summary.money.payment_records_awaiting_you > 0} onClick={() => setView("records")}>Payment records</PaymentTab>
        <PaymentTab selected={view === "payouts"} controls="settlement-history" icon="payments" count={summary.money.settlement_attention_minor > 0 ? 1 : 0} alert={summary.money.settlement_attention_minor > 0} onClick={() => setView("payouts")}>Payouts</PaymentTab>
        <PaymentTab selected={view === "expenses"} controls="expense-history" icon="reports" onClick={() => setView("expenses")}>Expenses</PaymentTab>
      </div>

      {view === "balances" ? <section id="rent-balances" role="tabpanel" aria-labelledby="rent-balances-tab" className="ws-panel payments-panel">
        <div className="ws-panel-head payments-panel-head">
          <div className="ws-panel-tools">
            <PanelSearch label="Search rent balances" placeholder="Search tenant, Property or Unit" value={query} onChange={setQuery} />
            <div className="rent-filters" aria-label="Balance status">{(["all", "overdue", "outstanding", "current"] as const).map((value) => <button key={value} type="button" data-tone={value} aria-pressed={balanceFilter === value} onClick={() => setBalanceFilter(value)}>{FILTER_LABEL[value]} <span>{balanceCounts[value]}</span></button>)}</div>
          </div>
          <p className="ws-range"><strong>{visibleTenants.length}</strong> of {summary.tenants.length}</p>
        </div>
        {visibleTenants.length ? <div className="payments-ledger">
          <LedgerHead columns={["Tenant", "Standing", "Next due", "Outstanding"]} />
          <ul className="rent-list">{visibleTenants.map((tenant) => <RentBalanceRow key={tenant.occupancy_id} tenant={tenant} onPeek={() => setOpenDueId(tenant.lease_id ?? "")} />)}</ul>
        </div> : <PanelState icon="users" title={query ? "No matching balances" : "No balances in this view"} body={query ? "Try another tenant, Property or Unit." : "Choose another balance status."} action={query || balanceFilter !== "all" ? <Button variant="quiet" size="sm" onClick={() => setParams({ q: "", show: "" })}>Show all balances</Button> : undefined} />}
      </section> : null}

      {view === "records" ? <section id="payment-records" role="tabpanel" aria-labelledby="payment-records-tab" className="ws-panel payments-panel">
        <div className="ws-panel-head payments-panel-head">
          <PanelSearch label="Search payment records" placeholder="Search payment records" value={query} onChange={setQuery} />
          <p className="ws-range"><strong>{visiblePayments.length}</strong> {visiblePayments.length === 1 ? "record" : "records"}</p>
        </div>
        <p className="rent-section-intro">{summary.money.payment_records_awaiting_you > 0 ? "Records waiting on you come first, followed by the most recent activity. " : "The most recent records are shown here. "}Open one to see it in full and respond.</p>
        {visiblePayments.length ? <div className="payments-ledger">
          <LedgerHead columns={["Tenant", "Status", "Method and date", "Amount"]} />
          <ul className="rent-list">{visiblePayments.map((payment) => <PaymentRecordRow key={payment.id} payment={payment} onPeek={() => setOpenRecordId(payment.id)} />)}</ul>
        </div> : <PanelState icon="details" title={query ? "No matching records" : "No payment records yet"} body={query ? "Try another tenant, Property or payment method." : "Confirmed and tenant-recorded payments appear here."} />}
        {summary.verification.payments_ready < summary.verification.properties_total ? <p className="rent-readiness-note"><Icon name="info" /><span>Online rent collection is not ready for every Property. It needs identity, Property authority and a Portfolio settlement account the payment provider has verified. Recording money you were paid directly is unaffected.</span></p> : null}
      </section> : null}

      {view === "payouts" ? <section id="settlement-history" role="tabpanel" aria-labelledby="settlement-history-tab" className="ws-panel payments-panel settlement-history">
        <dl className="settlement-overview"><SettlementFigure label="Paid online" value={summary.money.online_paid_minor} /><SettlementFigure label="Awaiting settlement" value={summary.money.awaiting_settlement_minor} tone="waiting" /><SettlementFigure label="Settled to you" value={summary.money.settled_net_minor} tone="settled" /><SettlementFigure label="Fees deducted" value={summary.money.settled_fee_minor} /></dl>
        {summary.money.awaiting_settlement_minor > 0 || summary.money.settlement_attention_minor > 0 ? <div className="settlement-notices">
          {summary.money.awaiting_settlement_minor > 0 ? <Notice tone="info" title="Payout in progress" body={`${ghs(summary.money.awaiting_settlement_minor)} has been paid by tenants and is waiting for Paystack's settlement batch. Final fee and net appear only after confirmation.`} /> : null}
          {summary.money.settlement_attention_minor > 0 ? <Notice tone="error" title="A payout needs review" body="Danpa HQ has not counted it as settled. The payment record remains intact while the settlement is reconciled." /> : null}
        </div> : null}
        <div className="ws-panel-head payments-panel-head is-inline">
          <PanelSearch label="Search payouts" placeholder="Search payouts" value={query} onChange={setQuery} />
          {canManagePayouts ? <div className="payout-manage"><Link className="ws-action" href={`/settings/settlement?organization=${organizationId}` as never}><Icon name="verification" />Manage settlement account</Link></div> : null}
        </div>
        <p className="rent-section-intro">Property owners bear Paystack’s transaction fee. Each completed payout shows the final amount after that fee and Danpa HQ’s configured platform charge.</p>
        {visibleSettlements.length ? <div className="payments-ledger">
          <LedgerHead columns={["Tenant", "Status", "Progress", "Amount"]} />
          <ul className="rent-list">{visibleSettlements.map((settlement) => <SettlementRow key={settlement.id} settlement={settlement} />)}</ul>
        </div> : <PanelState icon="payments" title={query ? "No matching payouts" : "No online payouts yet"} body={query ? "Try another tenant, Property or status." : "Paystack-confirmed rent and settlement progress will appear here."} />}
      </section> : null}

      {view === "expenses" ? <ExpensesSection expenses={expenses} onRecord={() => setRecording(true)} /> : null}

      {/* Refreshed through `load`, not `reloadKey`: that blanks the page, and
          the record would close under the person who just confirmed it. */}
      <RentDueModal
        tenant={openedDue}
        onClose={() => setOpenDueId("")}
      />
      <PaymentRecordModal record={openedRecord} onClose={() => setOpenRecordId("")} onChanged={load} />

      <RecordPaymentDialog
        open={recordingPayment}
        tenants={summary.tenants}
        initialTenant={recordFor}
        onClose={() => { setRecordingPayment(false); setRecordFor(null); }}
        onDone={async (tenant) => {
          setRecordingPayment(false);
          toast({ tone: "success", title: "Payment recorded", description: `Sent to ${tenant.name} to confirm. It changes the balance once they do.` });
          setReloadKey((current) => current + 1);
        }}
      />

      <ExpenseDialog
        open={recording}
        organizationId={organizationId}
        properties={properties}
        onClose={() => setRecording(false)}
        onDone={async () => { setRecording(false); setReloadKey((current) => current + 1); }}
      />
    </> : null}
  </div>;
}

function SettlementFigure({ label, value, tone }: { label: string; value: number; tone?: "waiting" | "settled" }) {
  return <div data-tone={value > 0 ? tone : undefined}><dt>{label}</dt><dd>{ghs(value)}</dd></div>;
}

/** How a balance stands, as a word with the icon that means it. */
const STANDING_ICON: Record<ProviderTenant["rent"]["status"], IconName> = { overdue: "warning", outstanding: "clock", current: "check" };

function RentBalanceRow({ tenant, onPeek }: { tenant: ProviderTenant; onPeek: () => void }) {
  const home = `${tenant.property_title} · ${tenant.unit_label}${tenant.bed_label ? ` · ${tenant.bed_label}` : ""}`;
  const inside = <>
    <span className="rent-row-person">
      <span className="rent-row-avatar" aria-hidden="true">{initials(tenant.name)}</span>
      <span><strong>{tenant.name}</strong><span>{home}</span></span>
    </span>
    <span className={`rent-row-state is-${tenant.rent.status}`}><Icon name={STANDING_ICON[tenant.rent.status]} />{rentStatus(tenant)}</span>
    <span className="rent-row-due">{tenant.rent.next_due_on ? <strong>{formatDate(tenant.rent.next_due_on)}</strong> : "Nothing due"}</span>
    <span className="rent-row-amount" data-zero={tenant.rent.outstanding_minor === 0 || undefined}>{formatMoney({ minor: tenant.rent.outstanding_minor, currency: tenant.lease_rent_currency ?? "GHS" })}<small>{tenant.rent.status === "overdue" ? `${formatMoney({ minor: tenant.rent.overdue_minor, currency: tenant.lease_rent_currency ?? "GHS" })} overdue` : tenant.rent.outstanding_minor === 0 ? "paid up" : "outstanding"}</small></span>
    <span className="rent-row-arrow" aria-hidden="true"><Chevron /></span>
  </>;
  // No lease means no rent account to open — the occupancy exists but nothing
  // has been scheduled against it yet.
  return <li data-tone={tenant.rent.status}>{tenant.lease_id
    ? <Link
      href={`/payments/${tenant.lease_id}` as never}
      className="rent-row"
      aria-haspopup="dialog"
      onClick={(event) => {
        // A new tab or window goes to the rent account, as a link should.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onPeek();
      }}
    >{inside}</Link>
    : <span className="rent-row is-inert" title="No agreement yet, so there is no rent account to open">{inside}</span>}</li>;
}

/** A record's standing, as a tone and an icon: waiting on you, settled, or in doubt. */
function recordTone(payment: RecentPayment): { tone: "review" | "confirmed" | "waiting" | "disputed"; icon: IconName } {
  if (payment.evidence === "PSP_CONFIRMED") return { tone: "confirmed", icon: "verification" };
  if (payment.awaiting_you) return { tone: "review", icon: "warning" };
  if (payment.status === "confirmed") return { tone: "confirmed", icon: "check" };
  if (payment.status === "disputed") return { tone: "disputed", icon: "warning" };
  return { tone: "waiting", icon: "clock" };
}

function PaymentRecordRow({ payment, onPeek }: { payment: RecentPayment; onPeek: () => void }) {
  const { tone, icon } = recordTone(payment);
  return <li data-tone={tone}><Link
    href={`/payments/${payment.lease_id}` as never}
    className="rent-row payment-record-row"
    aria-haspopup="dialog"
    onClick={(event) => {
      // A new tab or window goes to the rent account, as a link should.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      onPeek();
    }}
  >
    <span className="rent-row-person">
      <span className="rent-row-avatar" data-kind="record" aria-hidden="true"><Icon name={payment.source === "EXTERNAL" ? "details" : "payments"} /></span>
      <span><strong>{payment.tenant_name}</strong><span>{payment.property_title} · {payment.unit_label}</span></span>
    </span>
    <span className={`rent-row-state is-${tone}`}><Icon name={icon} />{recentPaymentStatus(payment)}</span>
    <span className="rent-row-due is-inline">{payment.method_display}<small>{formatDate(payment.paid_on)}</small></span>
    <span className="rent-row-amount">{formatMoney({ minor: payment.amount_minor, currency: payment.currency })}<small>{payment.source === "EXTERNAL" ? "External · recorded through Danpa HQ" : "Processed through Danpa HQ"}</small></span>
    <span className="rent-row-arrow" aria-hidden="true"><Chevron /></span>
  </Link></li>;
}

type Settlement = OrganizationPortfolio["recent_settlements"][number];
function SettlementRow({ settlement }: { settlement: Settlement }) {
  const settled = settlement.status === "settled" && settlement.net_minor !== null;
  const tone = settlement.status === "settled" ? "confirmed" : settlement.status === "failed" || settlement.status === "reversed" ? "disputed" : "waiting";
  const status = settlement.status === "settled" ? "Settled" : settlement.status === "failed" || settlement.status === "reversed" ? "Needs review" : "Payout processing";
  const icon: IconName = tone === "confirmed" ? "check" : tone === "disputed" ? "warning" : "clock";
  return <li data-tone={tone}><div className="rent-row settlement-row is-inert">
    <span className="rent-row-person">
      <span className="rent-row-avatar" data-kind="record" aria-hidden="true"><Icon name="payments" /></span>
      <span><strong>{settlement.tenant_name}</strong><span>{settlement.property_title} · {settlement.unit_label}</span></span>
    </span>
    <span className={`rent-row-state is-${tone}`}><Icon name={icon} />{status}</span>
    <span className="settlement-progress" aria-label={settled ? "Tenant paid, processor settled" : "Tenant paid, settlement pending"}><span className="is-complete"><i />Paid</span><b /><span className={settled ? "is-complete" : ""}><i />Settled</span></span>
    <span className="rent-row-amount">{formatMoney({ minor: settled ? settlement.net_minor! : settlement.gross_minor, currency: settlement.currency })}<small>{settled ? `${formatMoney({ minor: settlement.fee_minor ?? 0, currency: settlement.currency })} deducted · ${settlement.settled_at ? formatDate(settlement.settled_at) : "settled"}` : "gross paid · final payout pending"}</small></span>
    <span />
  </div></li>;
}

const EXPENSE_ICON: Record<string, IconName> = { maintenance: "amenities", utilities: "details", staff: "users", tax: "landmark", supplies: "shop", other: "reports" };

function ExpensesSection({ expenses, onRecord }: { expenses: PropertyExpense[]; onRecord: () => void }) {
  const total = expenses.reduce((sum, item) => sum + item.amount_minor, 0);
  return <section id="expense-history" role="tabpanel" aria-labelledby="expense-history-tab" className="ws-panel payments-panel">
    <div className="ws-panel-head payments-panel-head">
      <p className="expense-total"><span>Recorded in this Portfolio</span><strong>{ghs(total)}</strong></p>
      <Button variant="secondary" size="sm" onClick={onRecord}>Record expense</Button>
    </div>
    {expenses.length ? <ul className="rent-list expense-list">{expenses.map((expense) => <li className="expense-row" key={expense.id}>
      <span className="rent-row-avatar" data-kind="expense" aria-hidden="true"><Icon name={EXPENSE_ICON[expense.category] ?? "reports"} /></span>
      <div><strong>{expense.category_display}</strong><span>{expense.property_title}</span></div>
      <span>{formatDate(expense.incurred_on)}{expense.note ? ` · ${expense.note}` : ""}</span>
      <strong className="expense-amount">{expense.amount_formatted}</strong>
    </li>)}</ul> : <PanelState icon="reports" title="No expenses recorded" body="Property expenses you record appear here." action={<Button variant="quiet" size="sm" onClick={onRecord}>Record the first expense</Button>} />}
  </section>;
}

/**
 * Recording money a tenant paid outside Danpa HQ, from anywhere on this page.
 *
 * Choose the tenant, then the same form and the same gate their rent account
 * uses: the ledger is read for that lease and its `record_payment` permission
 * decides, so this is a quicker way in, never a second rule. Nothing here
 * moves money; the tenant confirms the record before it changes the balance.
 */
function RecordPaymentDialog({ open, tenants, initialTenant = null, onClose, onDone }: { open: boolean; tenants: ProviderTenant[]; initialTenant?: ProviderTenant | null; onClose: () => void; onDone: (tenant: ProviderTenant) => Promise<void> }) {
  const [chosen, setChosen] = useState<ProviderTenant | null>(null);
  const [needle, setNeedle] = useState("");
  const [ledger, setLedger] = useState<LeaseLedger | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  // Every opening starts at the choice of tenant — or on the tenant it was
  // opened for, from their balance.
  useEffect(() => { if (!open) { setChosen(null); setNeedle(""); setLedger(null); setError(""); } }, [open]);
  useEffect(() => { if (open && initialTenant?.lease_id) setChosen(initialTenant); }, [open, initialTenant]);

  useEffect(() => {
    if (!chosen?.lease_id) return;
    let cancelled = false;
    setLedger(null);
    setError("");
    getLeaseLedger(chosen.lease_id)
      .then((result) => { if (!cancelled) setLedger(result); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof ApiFailure ? cause.error.message : "Could not open this rent account."); });
    return () => { cancelled = true; };
  }, [chosen, attempt]);

  const candidates = useMemo(() => {
    const term = needle.trim().toLocaleLowerCase("en-GH");
    return [...tenants]
      .filter((tenant) => !term || `${tenant.name} ${tenant.property_title} ${tenant.unit_label} ${tenant.bed_label ?? ""}`.toLocaleLowerCase("en-GH").includes(term))
      .sort((a, b) => Number(Boolean(b.lease_id)) - Number(Boolean(a.lease_id)) || rentPriority(a) - rentPriority(b) || a.name.localeCompare(b.name, "en-GH"));
  }, [needle, tenants]);

  return <ModalSheet
    open={open}
    onClose={onClose}
    size="sm"
    icon="payments"
    title="Record payment"
    meta={chosen ? "Money received outside Danpa HQ" : "Choose who paid you"}
    className="payment-sheet record-payment-sheet"
    titleId="record-payment-title"
  >{(close) => <>
    {!chosen ? <div className="record-payment-pick">
      <PanelSearch label="Find a tenant" placeholder="Tenant, Property or Unit" value={needle} onChange={setNeedle} />
      {candidates.length ? <ul className="record-payment-tenants">{candidates.map((tenant) => (
        <li key={tenant.occupancy_id} data-tone={tenant.rent.status}>
          <button type="button" className="record-payment-tenant" disabled={!tenant.lease_id} onClick={() => setChosen(tenant)}>
            <span className="rent-row-avatar" aria-hidden="true">{initials(tenant.name)}</span>
            <span className="record-payment-who"><strong>{tenant.name}</strong><span>{tenant.property_title} · {tenant.unit_label}{tenant.bed_label ? ` · ${tenant.bed_label}` : ""}</span></span>
            <span className="record-payment-balance">
              {tenant.lease_id
                ? <>{formatMoney({ minor: tenant.rent.outstanding_minor, currency: tenant.lease_rent_currency ?? "GHS" })}<small>{tenant.rent.outstanding_minor ? rentStatus(tenant) : "Paid up"}</small></>
                : <small>No agreement yet</small>}
            </span>
          </button>
        </li>
      ))}</ul> : <p className="record-payment-empty">{needle ? "No tenant matches that search." : "No tenancies in this Portfolio yet."}</p>}
    </div> : <div className="record-payment-step">
      <div className="record-payment-chosen" data-tone={chosen.rent.status}>
        <span className="rent-row-avatar" aria-hidden="true">{initials(chosen.name)}</span>
        <span className="record-payment-who"><strong>{chosen.name}</strong><span>{chosen.property_title} · {chosen.unit_label}</span></span>
        <button type="button" className="record-payment-change" onClick={() => setChosen(null)}>Change</button>
      </div>
      {error ? <div className="record-payment-error"><Notice tone="error" title={error} /><Button variant="quiet" size="sm" onClick={() => setAttempt((value) => value + 1)}>Try again</Button></div> : null}
      {!ledger && !error ? <PanelSkeleton rows={3} /> : null}
      {ledger && !ledger.permissions.record_payment ? <Notice tone="info" title="Receiving actions are locked" body="Current identity and approved Property authority are required before a provider can record external money received. Paystack setup is not required." /> : null}
      {ledger && ledger.permissions.record_payment && !ledger.charges.some((charge) => charge.outstanding_minor > 0) ? <Notice tone="info" title="Nothing is due on this account" body="Every scheduled charge is paid. A payment can be recorded once a charge is open." /> : null}
      {ledger && ledger.permissions.record_payment && ledger.charges.some((charge) => charge.outstanding_minor > 0) && chosen.lease_id ? (
        <RecordPaymentForm leaseId={chosen.lease_id} charges={ledger.charges} onCancel={close} onDone={() => onDone(chosen)} />
      ) : null}
    </div>}
  </>}</ModalSheet>;
}

/** Recording an expense is one short form, so it stays a sheet over the page. */
function ExpenseDialog({ open, organizationId, properties, onClose, onDone }: { open: boolean; organizationId: string; properties: Property[]; onClose: () => void; onDone: () => Promise<void> }) {
  return <ModalSheet
    open={open}
    onClose={onClose}
    size="sm"
    icon="reports"
    title="Record Property expense"
    meta="For your books only. It does not move money."
    className="payment-sheet expense-sheet"
    titleId="expense-dialog-title"
  >{(close) => open ? <ExpenseForm organizationId={organizationId} properties={properties} onCancel={close} onDone={onDone} /> : null}</ModalSheet>;
}

const EXPENSE_CATEGORIES = [["maintenance", "Maintenance"], ["utilities", "Utilities"], ["staff", "Staff"], ["tax", "Tax or levy"], ["supplies", "Supplies"], ["other", "Other"]] as const;
function ExpenseForm({ organizationId, properties, onCancel, onDone }: { organizationId: string; properties: Property[]; onCancel: () => void; onDone: () => Promise<void> }) {
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? ""); const [category, setCategory] = useState("maintenance"); const [amount, setAmount] = useState(""); const [incurredOn, setIncurredOn] = useState(new Date().toISOString().slice(0, 10)); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <div className="payment-sheet-form">
    <label className="rent-field type-caption">Property<select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>{properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}</select></label>
    <fieldset className="payment-chips">
      <legend className="type-caption">Category</legend>
      {EXPENSE_CATEGORIES.map(([value, label]) => (
        <label key={value} className="payment-chip">
          <input type="radio" name="expense-category" value={value} checked={category === value} onChange={() => setCategory(value)} className="control-input" />
          <Icon name={EXPENSE_ICON[value] ?? "reports"} />{label}
        </label>
      ))}
    </fieldset>
    <div className="rent-form-grid">
      <Field label="Amount" prefix="GH₵" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.00" />
      <Field label="Date" value={incurredOn} onChange={(event) => setIncurredOn(event.target.value)} type="date" />
    </div>
    <Field label="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What it was for" />
    {error ? <Notice tone="error" title={error} /> : null}
    <div className="rent-actions"><Button busy={busy} disabled={!propertyId || !amount} onClick={async () => { const amountMinor = Math.round(Number(amount) * 100); if (!Number.isFinite(amountMinor) || amountMinor <= 0) return setError("Enter a valid amount."); setBusy(true); setError(""); try { await recordPropertyExpense(organizationId, { property_id: propertyId, amount_minor: amountMinor, category, incurred_on: incurredOn, note }); await onDone(); } catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not record the expense."); } finally { setBusy(false); } }}>Save expense</Button><Button variant="quiet" disabled={busy} onClick={onCancel}>Cancel</Button></div>
  </div>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function PlusGlyph() {
  return <svg className="portal-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><path d="M10 4.5v11M4.5 10h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}
