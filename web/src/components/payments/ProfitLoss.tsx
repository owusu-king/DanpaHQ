"use client";
import { useState } from "react";
import type { OrganizationPortfolio } from "@/lib/console";
import { formatMoney } from "@/lib/money";
import { GraReport } from "./GraReport";

export function ProfitLoss({ report, organizationId, organizationName = "", properties = [] }: { report: OrganizationPortfolio["profit_loss"]; organizationId?: string; organizationName?: string; properties?: { id: string; title: string }[] }) {
  const [currency, setCurrency] = useState("GHS");
  if (!report) return <p role="status">Refresh Finance to load your Profit &amp; Loss ledger.</p>;
  const ledger = report.ledgers.find(row => row.currency === currency) ?? report.ledgers[0];
  if (!ledger) return null;
  const money = (minor: number) => formatMoney({ minor, currency: ledger.currency });
  return <section id="profit-loss" role="tabpanel" aria-labelledby="profit-loss-tab" className="ws-panel pnl-ledger">
    <header className="pnl-heading flex-wrap"><div><p className="type-caption">All recorded periods · Cash basis</p><h2>Profit &amp; Loss</h2></div>
      <div className="flex flex-wrap items-center gap-3">{report.ledgers.length > 1 ? <label>Currency <select value={ledger.currency} onChange={event => setCurrency(event.target.value)}>{report.ledgers.map(row => <option key={row.currency}>{row.currency}</option>)}</select></label> : <span>{ledger.currency}</span>}
      {organizationId ? <GraReport key={organizationId} organizationId={organizationId} organizationName={organizationName} properties={properties} /> : null}</div>
    </header>
    <dl className="pnl-summary">
      <div><dt>Net rent revenue</dt><dd>{money(ledger.revenue_minor - ledger.refunds_minor)}</dd><small>Confirmed rent less completed refunds</small></div>
      <div><dt>Total expenses</dt><dd>{money(ledger.expenses_minor + ledger.fees_minor)}</dd><small>Property expenses and settled processing fees</small></div>
      <div data-loss={ledger.profit_minor < 0}><dt>{ledger.profit_minor < 0 ? "Net loss" : "Net profit"}</dt><dd>{money(ledger.profit_minor)}</dd><small>Revenue less expenses</small></div>
    </dl>
    <div className="pnl-table-wrap"><table className="pnl-table"><caption className="sr-only">Monthly cash-basis profit and loss, {ledger.currency}</caption><thead><tr><th scope="col">Period</th><th scope="col">Rent received</th><th scope="col">Refunds</th><th scope="col">Expenses</th><th scope="col">Processing fees</th><th scope="col">Profit / loss</th></tr></thead>
      <tbody>{ledger.monthly.map(row => <tr key={row.period}><th scope="row">{new Intl.DateTimeFormat("en-GH", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${row.period}-01T00:00:00Z`))}</th><td data-label="Rent received">{money(row.revenue_minor)}</td><td data-label="Refunds">{money(row.refunds_minor)}</td><td data-label="Expenses">{money(row.expenses_minor)}</td><td data-label="Processing fees">{money(row.fees_minor)}</td><td data-label="Profit / loss" data-loss={row.profit_minor < 0}>{money(row.profit_minor)}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row">Total</th><td data-label="Rent received">{money(ledger.revenue_minor)}</td><td data-label="Refunds">{money(ledger.refunds_minor)}</td><td data-label="Expenses">{money(ledger.expenses_minor)}</td><td data-label="Processing fees">{money(ledger.fees_minor)}</td><td data-label="Profit / loss">{money(ledger.profit_minor)}</td></tr></tfoot></table></div>
    <p className="pnl-note">Payouts are transfers, so they are not counted again as income. Completed refunds reduce the original rent-receipt month. Only confirmed rent, recorded expenses and settled processing fees are included.</p>
  </section>;
}
