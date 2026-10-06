"use client";

/**
 * One tenant's payments, over whatever page opened it: Rent due, the tenancy
 * sheet on Tenants, a tenancy's record, Home.
 *
 * The row says how much and how late; this is what makes up that figure — each
 * open charge with its due date, how much of it is paid, and how late it is —
 * with the last payment that came in and, where one was issued, its receipt.
 * Below that, their payment history, each with its standing and receipt.
 * Recording money is the page's own action, so it is not repeated here; the
 * foot holds the latest receipt and the tenant's full account.
 *
 * The charges are the lease's ledger, the same one the rent account reads; the
 * sheet derives nothing the server did not return.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { ReceiptView } from "@/components/payments/ReceiptModal";
import { ModalViews, useModalViews } from "@/components/workspace/ModalViews";
import { Icon } from "@/components/portal/icons";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { ApiFailure } from "@/lib/api";
import type { ProviderTenant } from "@/lib/console";
import { formatMoney } from "@/lib/money";
import { formatDate, paymentStatus, rentStatus } from "@/lib/rentDisplay";
import { getLeaseLedger, type LeaseLedger, type RentCharge, type RentPayment } from "@/lib/tenant";

export function RentDueModal({
  tenant,
  onClose,
}: {
  tenant: ProviderTenant | null;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<ProviderTenant | null>(tenant);
  // A receipt opens in this sheet, with Back, not as a dialog over it.
  const nav = useModalViews<{ kind: "receipt"; id: string }>(Boolean(tenant), tenant?.occupancy_id);
  // Held while closing, so the sheet plays its exit with what it showed.
  if (tenant && tenant !== shown) setShown(tenant);
  const current = tenant ?? shown;
  if (!current) return null;
  const home = paymentsHome(current);
  const receipt = nav.top;

  return (
    <ModalSheet
      open={Boolean(tenant)}
      onClose={onClose}
      size="sm"
      icon="payments"
      title={receipt ? "Receipt" : "Payments"}
      meta={receipt ? `${current.name} · ${current.property_title}` : home}
      className={receipt ? "receipt-sheet" : "due-sheet"}
      closeLabel="Close payments"
      onBack={nav.depth ? nav.back : undefined}
      backLabel="Back to payments"
      viewKey={receipt ? `receipt-${receipt.id}` : "payments"}
    >
      <ModalViews depth={nav.depth} direction={nav.direction}>
        <PaymentsView key={current.occupancy_id} tenant={current} home={home} onViewReceipt={(id) => nav.push({ kind: "receipt", id })} />
        {nav.views.map((view) => <ReceiptView key={view.id} receiptId={view.id} />)}
      </ModalViews>
    </ModalSheet>
  );
}

/** "Property · Unit · bed", as the sheet's header and the tenant line say it. */
export function paymentsHome(tenant: ProviderTenant) {
  return `${tenant.property_title} · ${tenant.unit_label}${tenant.bed_label ? ` · ${tenant.bed_label}` : ""}`;
}

export function PaymentsView({
  tenant,
  home,
  onViewReceipt,
}: {
  tenant: ProviderTenant;
  home: string;
  onViewReceipt: (receiptId: string) => void;
}) {
  const [ledger, setLedger] = useState<LeaseLedger | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const currency = tenant.lease_rent_currency ?? "GHS";
  const money = (minor: number) => formatMoney({ minor, currency });

  useEffect(() => {
    if (!tenant.lease_id) return;
    let live = true;
    getLeaseLedger(tenant.lease_id)
      .then((result) => { if (live) { setLedger(result); setError(""); } })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load what is owed."); });
    return () => { live = false; };
  }, [tenant.lease_id, attempt]);

  const open = (ledger?.charges ?? [])
    .filter((charge) => charge.outstanding_minor > 0)
    .sort((a, b) => a.due_on.localeCompare(b.due_on));
  const history = [...(ledger?.payments ?? [])].sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  // The newest payment that was issued a receipt; history is newest first.
  const latestReceipt = history.find((payment) => payment.receipt_id)?.receipt_id ?? null;

  return (
    <div className="dm">
      <section className="dm-who" aria-label="Tenant">
        <span className="dm-avatar" aria-hidden="true">{initialsOf(tenant.name)}</span>
        <span className="dm-who-copy"><strong>{tenant.name}</strong><small>{home}</small></span>
        <span className={`rent-row-state is-${tenant.rent.status}`}>{rentStatus(tenant)}</span>
      </section>

      <section className="dm-balance" data-tone={tenant.rent.status} aria-label="Balance">
        <small>Outstanding</small>
        <strong>{money(tenant.rent.outstanding_minor)}</strong>
        <span>
          {tenant.rent.overdue_minor > 0 ? <em>{money(tenant.rent.overdue_minor)} overdue</em> : null}
          {tenant.rent.overdue_minor > 0 && tenant.rent.next_due_on ? <i aria-hidden="true">·</i> : null}
          {tenant.rent.next_due_on ? `Next due ${formatDate(tenant.rent.next_due_on)}` : tenant.rent.outstanding_minor === 0 ? "Nothing due" : null}
        </span>
      </section>

      {!tenant.lease_id ? (
        <p className="dm-quiet">No agreement yet, so nothing has been scheduled.</p>
      ) : error ? (
        <div className="dm-error">
          <Notice tone="error" title={error} />
          <Button variant="quiet" size="sm" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Try again</Button>
        </div>
      ) : !ledger ? (
        <div className="dm-loading" aria-busy="true"><span /><span /></div>
      ) : (
        <section className="dm-charges" aria-label="What is owed">
          <header><strong>What is owed</strong><span>{open.length ? `${open.length} open` : "All settled"}</span></header>
          {open.length ? (
            <ul>
              {open.map((charge) => <ChargeLine key={charge.id} charge={charge} money={money} />)}
            </ul>
          ) : (
            <p className="dm-quiet">Every scheduled charge is paid.</p>
          )}
        </section>
      )}

      {ledger && history.length ? (
        <section className="dm-history" aria-label="Payment history">
          <header><strong>Payment history</strong><span>{history.length}</span></header>
          <ul>
            {history.map((payment) => (
              <li key={payment.id} className="dm-pay" data-tone={toneOf(payment)}>
                <span className="dm-pay-mark" aria-hidden="true"><Icon name={payment.source === "PLATFORM_PSP" ? "payments" : "details"} /></span>
                <span className="dm-pay-copy">
                  <strong>{money(payment.amount_minor)}</strong>
                  <small>{formatDate(payment.paid_on)} · {payment.obligation_label} · {payment.method_display}</small>
                </span>
                <span className="dm-pay-side">
                  <span className="dm-pay-state">{paymentStatus(payment)}</span>
                  {payment.receipt_id ? (
                    <button type="button" className="dm-receipt" onClick={() => onViewReceipt(payment.receipt_id!)}>Receipt</button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tenant.lease_id ? (
        <div className="dm-actions">
          {latestReceipt ? (
            <Button variant="secondary" onClick={() => onViewReceipt(latestReceipt)}><Icon name="details" />Receipt</Button>
          ) : null}
          <span className="dm-actions-spacer" />
          {/* The full account keeps what a sheet does not: adjustments, waivers
              and a closed tenancy's summary. No close first: leaving the page
              takes the sheet with it. */}
          <Link className="btn btn-primary" href={`/payments/${tenant.lease_id}` as never}><Icon name="payments" />Full account</Link>
        </div>
      ) : null}
    </div>
  );
}

function ChargeLine({ charge, money }: { charge: RentCharge; money: (minor: number) => string }) {
  const paid = charge.amount_paid_minor ?? 0;
  const share = charge.amount_minor > 0 ? Math.min(1, paid / charge.amount_minor) : 0;
  const tone = charge.is_overdue ? "overdue" : charge.status === "part_paid" ? "part" : "due";
  return (
    <li className="dm-charge" data-tone={tone}>
      <span className="dm-charge-copy">
        <strong>{charge.kind_display}</strong>
        <small>
          Due {formatDate(charge.due_on)}
          {charge.is_overdue ? <em>{charge.days_overdue} day{charge.days_overdue === 1 ? "" : "s"} late</em> : null}
        </small>
      </span>
      <span className="dm-charge-amount">
        <strong>{money(charge.outstanding_minor)}</strong>
        {paid > 0 ? <small>{money(paid)} of {money(charge.amount_minor)} paid</small> : null}
      </span>
      {paid > 0 ? <span className="dm-charge-bar" aria-hidden="true"><i style={{ width: `${Math.round(share * 100)}%` }} /></span> : null}
    </li>
  );
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function toneOf(payment: RentPayment) {
  if (payment.evidence === "PSP_CONFIRMED" || payment.status === "confirmed") return "confirmed";
  if (payment.status === "disputed") return "disputed";
  return payment.awaiting_you ? "review" : "waiting";
}
