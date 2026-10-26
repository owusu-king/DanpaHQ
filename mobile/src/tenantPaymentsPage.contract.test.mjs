/**
 * Tenant Payments, read as what to pay next (owner, 2026-10-06).
 *
 * The next thing owed leads on its own card with the button that pays it;
 * anything else due follows with its own step; then a payment the landlord
 * recorded that the tenant must confirm; then what was paid, each with its
 * receipt; attempts that did not go through fold away. These tests hold what a
 * row tells somebody, not only where it sits.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  const stop = source.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, `${end} is missing after ${start}`);
  return source.slice(at, stop);
};
const screen = () => code(read("app/(app)/tenant-payments.tsx"));

test("the next thing owed leads, late first, with the button that pays it", () => {
  const source = screen();
  // Late first, then soonest: the first is the one to pay.
  assert.match(source, /\.sort\(\(a, b\) => Number\(b\.charge\.is_overdue\) - Number\(a\.charge\.is_overdue\)\s*\|\| a\.charge\.due_on\.localeCompare\(b\.charge\.due_on\)\)/);
  assert.match(source, /const \[lead, \.\.\.restDue\] = dueRows;/);
  assert.match(source, /<NextDue row=\{lead\} more=\{restDue\.length\} total=\{outstanding\} onPay=\{\(\) => openDue\(lead\)\} \/>/);
  const card = between(source, "function NextDue(", "function DueItem(");
  assert.match(card, /`OVERDUE · \$\{charge\.days_overdue\} \$\{charge\.days_overdue === 1 \? "DAY" : "DAYS"\} LATE`/);
  assert.match(card, /const action = intent \? "Check status" : charge\.kind === "rent" \? "Pay rent" : `Pay \$\{charge\.kind_display\.toLowerCase\(\)\}`;/);
  assert.match(card, /`\$\{more\} more due · \$\{formatMinor\(total\)/);
  // Nothing due: said plainly, with the last payment that counts.
  assert.match(source, /<Calm text=\{latest \? `All paid up\. Your last payment was/);
  // Paid means it counts: a claim still waiting for confirmation is not the last payment.
  assert.match(source, /const latest = history\.find\(\(row\) => row\.payment\.is_confirmed \|\| row\.payment\.evidence === "PSP_CONFIRMED"\);/);
});

test("every due item keeps its one action: pay it, or check a payment already confirming", () => {
  const source = screen();
  assert.match(source, /intent: intents\.find\(\(intent\) => intent\.obligation_id === charge\.id && OPEN_INTENT\.has\(intent\.status\)\) \?\? null,/);
  const open = between(source, "const openDue = (row: DueRow) => {", "const openPayment");
  assert.match(open, /pathname: "\/\(app\)\/payment-status", params: \{ intentId: row\.intent\.id \}/);
  assert.match(open, /pathname: "\/\(app\)\/payment-checkout", params: \{ leaseId: row\.account\.tenancy\.lease!\.id, obligationId: row\.charge\.id \}/);
  const row = between(source, "function DueItem(", "function ConfirmItem(");
  assert.match(row, /<Act label=\{action\} icon=\{intent \? "hourglass-outline" : "card-outline"\} primary=\{!intent\} onPress=\{onPress\} \/>/);
  // Late in laterite with how late; confirming in harmattan.
  const look = between(source, "function dueLook(", "function PaymentItem(");
  assert.match(look, /status: `\$\{days\} overdue\$\{part\}`/);
  assert.match(look, /status: "Confirming payment"/);
  assert.match(source, /Pay rent explains anything a home still needs before it can be paid online\./);
});

test("a payment the landlord recorded waits for the tenant to confirm or dispute", () => {
  const source = screen();
  assert.match(source, /\.filter\(\(payment\) => payment\.awaiting_you\)\.map\(\(payment\) => \(\{ account, payment \}\)\)/);
  assert.match(source, /<GroupLabel count=\{confirmationRows\.length\} tone=\{HARMATTAN\}>To confirm<\/GroupLabel>/);
  const row = between(source, "function ConfirmItem(", "function dueLook(");
  assert.match(row, /`\$\{payment\.recorded_by_name\} recorded a payment`/);
  assert.match(row, /<Act label="Confirm or dispute"/);
  assert.match(source, /onPress=\{\(\) => openAccount\(router, account\.tenancy\)\}/);
});

test("payments show the latest few with their receipts, and attempts fold apart", () => {
  const source = screen();
  assert.match(source, /const HISTORY_SHOWN = 5;/);
  assert.match(source, /const shownHistory = open\.history \? history : history\.slice\(0, HISTORY_SHOWN\);/);
  assert.match(source, /receiptId: payment\.receipt_id/);
  const open = between(source, "const openPayment = ", "if (!signedIn)");
  assert.match(open, /pathname: "\/\(app\)\/payment-receipt", params: \{ receiptId \}/);
  assert.match(source, /title="Unsuccessful attempts"/);
  assert.match(source, /summary="These did not mark rent as paid"/);
  assert.match(source, /const FAILED_INTENT = new Set\(\["failed", "expired", "cancelled"\]\);/);
});

test("nothing yet, nothing paid and signed out each say the right thing", () => {
  const source = screen();
  assert.match(source, /<Empty\s+icon="wallet-outline"\s+title="No rent account yet"/);
  assert.match(source, /label="Your agreements" onPress=\{\(\) => router\.push\("\/\(app\)\/leases" as never\)\}/);
  assert.match(source, /<Empty compact icon="receipt-outline" title="No payments yet"/);
  assert.match(source, /<AuthPrompt[\s\S]{0,180}next="\/\(app\)\/\(tabs\)\/payments"/);
  assert.match(source, /accessibilityRole="progressbar" accessibilityLabel="Loading your payments"/);
  assert.doesNotMatch(source, /<BottomSheet|<SummaryPanel|<SignalPanel/);
});

test("everything the page could do is still there", () => {
  const source = screen();
  assert.match(source, /listMyTenancies\(true\)/);
  assert.match(source, /getLeaseLedger\(tenancy\.lease!\.id\)/);
  assert.match(source, /listPaymentIntents\(\)/);
  assert.match(source, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /mode: "tenant"/);
  // A short label stays with the word before it, so "Bed A" never breaks across lines.
  assert.match(source, /const NBSP = String\.fromCharCode\(160\);/);
});
