/**
 * Provider Payments, read as work (owner, 2026-10-06).
 *
 * This month's rent leads as one bar; then what needs the landlord (overdue
 * balances, tenant claims to confirm, a payout that failed); then what is
 * moving (rent coming due, money on its way, what was received); and what was
 * paid out and the expenses fold into a line each. These tests hold what makes
 * it a financial product rather than a pretty one: payment and settlement stay
 * different facts, counts come from the server, an amount is never cut short,
 * and nothing the page could do before is lost.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { moneyWork, paymentStatus, thisMonth } from "./paymentsWork.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  const stop = source.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, `${end} is missing after ${start}`);
  return source.slice(at, stop);
};
const screen = () => code(read("app/(app)/(provider-tabs)/payments.tsx"));
const kit = () => code(read("src/components/portfolio/PortfolioList.tsx"));

const tenant = (id, status, extra = {}) => ({ occupancy_id: id, name: id, rent: { status, outstanding_minor: 0, overdue_minor: 0, next_due_on: null, ...extra } });
const payment = (id, extra = {}) => ({ id, paid_on: "2026-10-01", awaiting_you: false, status: "confirmed", evidence: "COUNTERPARTY_CONFIRMED", ...extra });
const settlement = (id, status, extra = {}) => ({ id, status, settled_at: null, ...extra });

test("this month is received against what is still outstanding, as one share", () => {
  const month = thisMonth({ rent_collection: { currency: "GHS", yearly: [], monthly: [
    { period: "2026-09", collected_minor: 900, outstanding_minor: 0 },
    { period: "2026-10", collected_minor: 750, outstanding_minor: 250 },
  ] } }, new Date(2026, 9, 6));
  assert.equal(month.collected, 750);
  assert.equal(month.outstanding, 250);
  assert.equal(month.share, 0.75);
  assert.equal(thisMonth({ rent_collection: { currency: "GHS", yearly: [], monthly: [] } }, new Date(2026, 9, 6)), null);

  // Outstanding is today's balance, so the card says "still outstanding".
  const card = between(screen(), "function MonthCard(", "function TenantRow(");
  assert.match(card, /still outstanding/);
  assert.match(card, /<Bar value=\{total \? month\.share : 0\} tone=\{KOLA\}/);
});

test("money resolves into what needs the landlord, what is moving and what is done", () => {
  const work = moneyWork({
    tenants: [tenant("small", "overdue", { overdue_minor: 1 }), tenant("big", "overdue", { overdue_minor: 9 }), tenant("later", "outstanding", { next_due_on: "2026-10-20" }), tenant("soon", "outstanding", { next_due_on: "2026-10-09" }), tenant("ok", "current")],
    recent_payments: [payment("claim", { awaiting_you: true }), payment("old", { paid_on: "2026-09-01" }), payment("new", { paid_on: "2026-10-04" })],
    recent_settlements: [settlement("way", "processing"), settlement("pending", "pending"), settlement("bad", "failed"), settlement("back", "reversed"), settlement("done", "settled", { settled_at: "2026-10-02" })],
  });
  assert.deepEqual(work.overdue.map((row) => row.occupancy_id), ["big", "small"]);
  assert.deepEqual(work.due.map((row) => row.occupancy_id), ["soon", "later"]);
  assert.deepEqual(work.toReview.map((row) => row.id), ["claim"]);
  assert.deepEqual(work.recent.map((row) => row.id), ["new", "old"]);
  // Paid by a tenant is not paid to you: pending and processing are on their way, never settled.
  assert.deepEqual(work.onTheWay.map((row) => row.id), ["way", "pending"]);
  assert.deepEqual(work.attention.map((row) => row.id), ["bad", "back"]);
  assert.deepEqual(work.paidOut.map((row) => row.id), ["done"]);

  assert.equal(paymentStatus(payment("a", { evidence: "PSP_CONFIRMED" })), "Processor confirmed");
  assert.equal(paymentStatus(payment("b", { awaiting_you: true, evidence: "AWAITING_COUNTERPARTY_CONFIRMATION" })), "Review needed");
});

test("the page is this month, a briefing and sections, with no Filter sheet", () => {
  const source = screen();
  assert.doesNotMatch(source, /<BottomSheet|<ListHead|<SummaryPanel|<ChoiceRow|<ActiveFilter|function FilterSheet/);
  assert.match(source, /\{month \? <MonthCard month=\{month\} \/> : null\}/);
  for (const [key, title] of [["overdue", "Overdue"], ["review", "To confirm"], ["attention", "Payout needs review"], ["due", "Coming due"], ["way", "On its way to you"], ["recent", "Received"]]) {
    assert.match(source, new RegExp(`label\\("${key}", "${title}"`), title);
  }
  assert.match(source, /title=\{entry\.fold === "paid" \? "Paid out to you" : "Expenses"\}/);
  // Search earns its place past a glance, and reaches balances and payments.
  assert.match(source, />= SEARCH_FROM;/);
  assert.match(source, /<SearchField label="Search payments" placeholder="Tenant, Property, Unit or method"/);
});

test("counts come from the server, and payment and settlement stay different facts", () => {
  const source = screen();
  // Claims to confirm are the server's count: the recent list it sends is capped.
  assert.match(source, /summary\.money\.payment_records_awaiting_you > 0 \? summary\.money\.payment_records_awaiting_you : 0/);
  assert.doesNotMatch(source, /pending_payment_records/);
  assert.match(source, /summary\.money\.overdue_minor > 0 \? \{ text: `\$\{formatMinor\(summary\.money\.overdue_minor\)\} overdue`/);
  // Money on its way is named as such, and never counted as paid out.
  assert.match(source, /summary\.money\.awaiting_settlement_minor > 0 \? \{ text: `\$\{formatMinor\(summary\.money\.awaiting_settlement_minor\)\} on its way`/);
  assert.match(source, /summary: `\$\{formatMinor\(summary\.money\.settled_net_minor\)\} after \$\{formatMinor\(summary\.money\.settled_fee_minor\)\} in fees`/);
  assert.match(source, /Property owners bear Paystack’s transaction fee/);

  const row = between(source, "function SettlementRow(", "function ExpenseRow(");
  assert.match(row, />Paid<\/Type>/);
  assert.match(row, />Settled<\/Type>/);
  assert.match(row, /const amount = settled \? settlement\.net_minor! : settlement\.gross_minor;/);
});

test("a row never cuts an amount short", () => {
  const source = screen();
  assert.match(between(kit(), "export function RowLine(", "export function EmptyState("), /<View style=\{styles\.lineStart\}>\{start\}<\/View>/);
  assert.match(kit(), /lineEnd: \{\s*flexShrink: 0,/);
  assert.match(between(source, "function TenantRow(", "function PaymentsSkeleton("), /end=\{<Type variant="bodyStrong" numberOfLines=\{1\} style=\{\[rowStyles\.rowAmount/);
  for (const name of ["function PaymentRow(", "function SettlementRow(", "function ExpenseRow("]) {
    assert.match(between(source, name, "\n}\n"), /end=\{<Type variant="bodyStrong" numberOfLines=\{1\} style=\{rowStyles\.rowAmount\}>/, name);
  }
  // On the narrowest phones a fee gives way, never the status — and a screen reader still hears it.
  assert.match(source, /end=\{narrow \? undefined : <Type variant="caption" numberOfLines=\{1\} style=\{rowStyles\.rowMeta\}>\{fee\}<\/Type>\}/);
  assert.match(source, /Tenant paid\. \$\{label\}\. \$\{formatMinor\(amount, settlement\.currency\)\}\. \$\{fee\}\./);
});

test("the page keeps everything it could do", () => {
  const source = screen();
  assert.match(source, /<FlatList/);
  assert.match(source, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
  assert.match(source, /pathname: "\/\(app\)\/rent-account"/);
  assert.match(source, /disabled=\{!tenant\.lease_id\}/);
  // Turning online collection on still has its way in.
  assert.match(source, /payoutDestination\.active_profile\?\.status !== "verified"/);
  assert.match(source, /<SignalPanel signals=\{signals\} \/>/);
  // Expenses are still recorded here, and "add" still opens the form.
  assert.match(source, /const \[showExpense, setShowExpense\] = useState\(action === "expense"\);/);
  assert.match(source, /<QuietAction icon="add" label="Record expense" onPress=\{\(\) => setShowExpense\(true\)\} \/>/);
  assert.match(source, /await recordPropertyExpense\(organizationId,/);
  assert.match(source, /\{canManagePayouts && organizationId \? <QuietAction icon="card-outline" label="Manage settlement account"/);
});

test("nothing yet, nothing found and no expenses each have their own glyph", () => {
  const source = screen();
  assert.match(source, /accessibilityRole="progressbar" accessibilityLabel="Loading payments"/);
  assert.match(source, /<Empty\s+icon="wallet-outline"\s+title="No rent to track yet"/);
  assert.match(source, /label="Record an expense" onPress=\{\(\) => setShowExpense\(true\)\}/);
  assert.match(source, /<Empty icon="search-outline" title="No matching payments"/);
  assert.match(source, /<Empty compact icon="receipt-outline" title="No expenses recorded"/);
  assert.match(source, /<Calm text="Nobody is overdue and no tenant claim waits on you\." \/>/);
});
