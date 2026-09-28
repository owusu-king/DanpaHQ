/**
 * Tenant Payments, refined on review (2026-09-15).
 *
 * One reading order instead of two tabs: what is outstanding and whether any of
 * it is late, anything the tenant is asked to confirm, what is due with the one
 * thing to do about each, and the latest payments with their receipts. Panels
 * show their first few rows and the shared sheet holds the rest. These tests hold
 * what a row tells somebody, not only where it sits.
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

test("one reading order: what is owed, what to confirm, what is due, what was paid", () => {
  const source = screen();
  let at = -1;
  for (const fragment of [
    "<SummaryPanel label=\"Outstanding\" value={formatMinor(outstanding)} note={note} facts={facts} />",
    "title=\"Confirm an external payment\"",
    ">Due now</GroupLabel>",
    ">Payments</GroupLabel>",
  ]) {
    const found = source.indexOf(fragment);
    assert.notEqual(found, -1, `${fragment} is missing`);
    assert.ok(found > at, `${fragment} is out of order`);
    at = found;
  }
  assert.match(source, /<IndexGround>/);
  assert.doesNotMatch(source, /accessibilityRole="tab"|accessibilityRole="tablist"|function Tab\(/);
  assert.doesNotMatch(source, /Rent due, secure payments and the records you keep\./);
});

test("the summary leads with late money, and last paid means a payment that counts", () => {
  const source = screen();
  assert.match(source, /charges\.filter\(\(charge\) => charge\.outstanding_minor > 0\)/);
  assert.match(source, /Number\(b\.charge\.is_overdue\) - Number\(a\.charge\.is_overdue\)\s*\|\| a\.charge\.due_on\.localeCompare\(b\.charge\.due_on\)/);
  assert.match(source, /const outstanding = dueRows\.reduce\(\(total, row\) => total \+ row\.charge\.outstanding_minor, 0\);/);
  assert.match(
    source,
    /const note: SummaryNote = overdue > 0\s*\? \{ text: `\$\{formatMinor\(overdue\)\} overdue`, tone: "alert" \}\s*: inProgress > 0\s*\? \{ text: `\$\{inProgress\} \$\{inProgress === 1 \? "payment" : "payments"\} confirming`, tone: "calm" \}\s*: \{ text: outstanding > 0 \? "Nothing overdue" : "All paid up", tone: "calm" \};/,
  );
  assert.match(source, /const next = dueRows\.filter\(\(row\) => !row\.charge\.is_overdue\)\s*\.sort\(\(a, b\) => a\.charge\.due_on\.localeCompare\(b\.charge\.due_on\)\)\[0\];/);
  assert.match(source, /const latest = history\.find\(\(row\) => row\.payment\.is_confirmed \|\| row\.payment\.evidence === "PSP_CONFIRMED"\);/);
  assert.match(source, /next \? \{ label: "Next due", value: dayMonth\(next\.charge\.due_on\) \} : null,/);
  assert.match(source, /latest \? \{ label: "Last paid", value: paidAmount\(latest\.payment\) \} : null,/);
  assert.match(source, /\{ label: "Rent accounts", value: String\(accounts\?\.length \?\? 0\) \},\s*\]\.filter\(\(fact\): fact is \{ label: string; value: string \} => fact !== null\)\.slice\(0, 2\);/);
});

test("every due item keeps its one action, and the sheet holds the rest", () => {
  const source = screen();
  const row = between(source, "function DueItem(", "function dueLook(");
  const look = between(source, "function dueLook(", "function PaymentItem(");

  assert.match(source, /const SHOWN = 3;/);
  assert.match(source, /\{dueRows\.length \? dueRows\.slice\(0, SHOWN\)\.map\(/);
  assert.match(source, /: <QuietRow icon="checkmark-circle-outline" title="Nothing due" \/>/);
  assert.match(source, /\{dueRows\.length > SHOWN \? <ViewAll count=\{dueRows\.length\} noun="due items" onPress=\{\(\) => setSheet\("due"\)\} \/> : null\}/);
  assert.match(source, /<BottomSheet visible=\{sheet === "due"\} onClose=\{\(\) => setSheet\(null\)\} title="Due now" closeLabel="Close due items">/);
  assert.match(source, /\{dueRows\.map\(\(row, index\) => <DueItem key=\{row\.charge\.id\} row=\{row\} first=\{index === 0\} onPress=\{\(\) => openDue\(row\)\} \/>\)\}/);

  assert.match(row, /const action = intent \? "Check status" : charge\.kind === "rent" \? "Pay rent" : `Pay \$\{charge\.kind_display\.toLowerCase\(\)\}`;/);
  assert.match(row, /accessibilityLabel=\{`\$\{charge\.kind_display\}\. \$\{amount\}\. \$\{place\}\. \$\{look\.status\}\. \$\{action\}\.`\}/);
  assert.match(row, /end=\{<Type variant="bodyStrong" numberOfLines=\{1\} style=\{rowStyles\.rowAmount\}>\{amount\}<\/Type>\}/);
  assert.match(look, /const part = charge\.status === "part_paid" \? " · part paid" : "";/);
  assert.match(look, /icon: "hourglass-outline", ink: HARMATTAN, text: HARMATTAN, wash: theme\.color\.harmattan\["100"\], status: "Confirming payment"/);
  assert.match(look, /icon: "alert-circle-outline", ink: LATERITE, text: LATERITE, wash: theme\.color\.laterite\["100"\], status: `\$\{days\} overdue\$\{part\}`/);
  assert.match(look, /status: `Due \$\{dayMonth\(charge\.due_on\)\}\$\{part\}`/);

  // Paying opens checkout; a payment already under way opens its status, never a
  // second checkout. From a sheet, the sheet closes first: it is a modal.
  assert.match(source, /const OPEN_INTENT = new Set\(\["created", "pending", "processing"\]\);/);
  assert.match(source, /intent: intents\.find\(\(intent\) => intent\.obligation_id === charge\.id && OPEN_INTENT\.has\(intent\.status\)\) \?\? null,/);
  assert.match(
    between(source, "const openDue = (row: DueRow) => {", "const openPayment = "),
    /setSheet\(null\);\s*if \(row\.intent\) \{\s*router\.push\(\{ pathname: "\/\(app\)\/payment-status", params: \{ intentId: row\.intent\.id \} \} as never\);\s*\} else \{\s*router\.push\(\{ pathname: "\/\(app\)\/payment-checkout", params: \{ leaseId: row\.account\.tenancy\.lease!\.id, obligationId: row\.charge\.id \} \} as never\);/,
  );

  // Where a home cannot be paid online yet, the page says Pay rent will explain.
  assert.match(source, /const unavailable = dueRows\.some\(\(row\) => !row\.account\.ledger\.digital_payment\.available && !row\.intent\);/);
  assert.match(source, /\{unavailable \? <Footnote>Pay rent explains anything a home still needs before it can be paid online\.<\/Footnote> : null\}/);
});

test("a payment the landlord recorded waits at the top for the tenant to confirm", () => {
  const source = screen();
  assert.match(source, /\.filter\(\(payment\) => payment\.awaiting_you\)/);
  const panel = between(source, "title=\"Confirm an external payment\"", ">Due now</GroupLabel>");
  assert.match(panel, /title: `\$\{payment\.recorded_by_name\} recorded \$\{paidAmount\(payment\)\}`,/);
  assert.match(panel, /detail: \[payment\.method_display, payment\.obligation_label, account\.tenancy\.property\.title\]\.filter\(Boolean\)\.join\(" · "\),/);
  assert.match(panel, /onPress: \(\) => openAccount\(router, account\.tenancy\),/);
  assert.match(
    source,
    /pathname: "\/\(app\)\/rent-account", params: \{ leaseId: tenancy\.lease\?\.id \?\? "", propertyTitle: tenancy\.property\.title, unitLabel: tenancy\.space\.unit_label, bedLabel: tenancy\.space\.bed_label \?\? "", tenancyId: tenancy\.id, mode: "tenant" \}/,
  );
});

test("payments show the latest few with their receipts, and attempts are kept apart", () => {
  const source = screen();
  const row = between(source, "function PaymentItem(", "function paymentLook(");

  assert.match(source, /\.sort\(\(a, b\) => b\.payment\.paid_on\.localeCompare\(a\.payment\.paid_on\)\)/);
  assert.match(source, /\{history\.length \? history\.slice\(0, SHOWN\)\.map\(/);
  assert.match(source, /: <QuietRow icon="receipt-outline" title="No payments yet" \/>/);
  assert.match(source, /\{history\.length > SHOWN \? <ViewAll count=\{history\.length\} noun="payments" onPress=\{\(\) => setSheet\("history"\)\} \/> : null\}/);
  assert.match(source, /<BottomSheet visible=\{sheet === "history"\} onClose=\{\(\) => setSheet\(null\)\} title="Payments" closeLabel="Close payments">/);
  assert.match(
    between(source, "const openPayment = ", "if (!signedIn)"),
    /setSheet\(null\);\s*if \(receiptId\) \{\s*router\.push\(\{ pathname: "\/\(app\)\/payment-receipt", params: \{ receiptId \} \} as never\);\s*\} else \{\s*openAccount\(router, account\.tenancy\);/,
  );

  assert.match(row, /const action = receiptId \? "Receipt" : "Details";/);
  assert.match(row, /end=\{<Type variant="bodyStrong" numberOfLines=\{1\} style=\{rowStyles\.rowAmount\}>\{amount\}<\/Type>\}/);
  assert.match(row, /<Type variant="caption" numberOfLines=\{2\} style=\{rowStyles\.rowMeta\}>\{shortDate\(payment\.paid_on\)\} · \{payment\.method_display\} · \{place\}<\/Type>/);
  assert.match(
    source,
    /function paymentStatus\(payment: RentPayment\) \{ return payment\.evidence === "PSP_CONFIRMED" \? "Processor confirmed" : payment\.awaiting_you \? "Review needed" : payment\.status === "confirmed" \? "Confirmed by both" : payment\.status === "disputed" \? "Disputed" : payment\.recorded_by_tenant \? "Waiting for provider" : "Waiting for you"; \}/,
  );

  // Failed, expired and cancelled attempts never mark rent paid: they live behind
  // their own link, and a row for one is not a way in.
  assert.match(source, /const FAILED_INTENT = new Set\(\["failed", "expired", "cancelled"\]\);/);
  assert.match(source, /\{unsuccessful\.length \? <PanelLink label="Unsuccessful attempts" count=\{unsuccessful\.length\} onPress=\{\(\) => setSheet\("attempts"\)\} \/> : null\}/);
  assert.match(source, /title="Unsuccessful attempts" closeLabel="Close unsuccessful attempts">\s*<SheetList summary="These attempts did not mark rent as paid\.">/);
  assert.doesNotMatch(between(source, "function AttemptItem(", "function QuietRow("), /Pressable|onPress/);
});

test("nothing is cut short on a small phone", () => {
  const source = screen();
  // The action pill drops under the status rather than squeezing it.
  assert.match(source, /standing: \{\s*flexDirection: "row",\s*flexWrap: "wrap",/);
  assert.match(source, /standingLine: \{\s*flexGrow: 1,\s*flexShrink: 1,\s*flexBasis: 110,/);
  assert.match(source, /act: \{\s*marginLeft: "auto",/);
  assert.match(between(source, "function DueItem(", "function dueLook("), /<Type variant="captionStrong" style=\{\[styles\.standingText, \{ color: look\.text \}\]\}>\{look\.status\}<\/Type>/);
  // A short label stays with its word: "Bed A", not "Bed" at the end of a line.
  assert.match(source, /\.join\(" · "\)\.replace\(\/ \(\?=\\S\{1,2\}\(\?:\\s\|\$\)\)\/g, "\\u00A0"\)/);
});

test("everything the page could do is still there", () => {
  const source = screen();
  assert.match(source, /<AuthPrompt\s+icon="wallet"/);
  assert.match(source, /next="\/\(app\)\/\(tabs\)\/payments"/);
  assert.match(source, /listMyTenancies\(true\),\s*listPaymentIntents\(\),/);
  assert.match(source, /ledger: await getLeaseLedger\(tenancy\.lease!\.id\),/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /\{accounts === null \? <PaymentsSkeleton \/> : null\}/);
  assert.match(between(source, "function PaymentsSkeleton(", "function openAccount("), /accessibilityRole="progressbar" accessibilityLabel="Loading your payments"/);
  // No rent account is said once, large, with the way to the agreement that would
  // create one — and never after a load failure.
  assert.match(source, /\{accounts\?\.length === 0 && !error \? \(\s*<EmptyState\s+icon="wallet-outline"\s+hero\s+title="No rent account yet"/);
  assert.match(source, /label="Your agreements" onPress=\{\(\) => router\.push\("\/\(app\)\/leases" as never\)\}/);
});
