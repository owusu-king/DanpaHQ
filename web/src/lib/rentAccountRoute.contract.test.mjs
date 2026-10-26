/**
 * The rent account is a place, not a layer.
 *
 * It used to open as a `<dialog>` over the payments list. That was the wrong
 * container for what it holds: a review queue whose decisions are irreversible,
 * a schedule of charges, a payment history, and two forms. Somebody confirming
 * that money arrived often wants to check something else first — the tenancy,
 * the agreement, their own bank record — and a modal makes leaving mean losing
 * your place. It could not be linked to, sent to a colleague, or reopened from
 * history.
 *
 * What must stay true: the lease id is the address, the rows are links, and
 * nothing about who may do what moved to the client.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const list = () => read("web/app/payments/page.tsx");
const detail = () => read("web/app/record/payment/page.tsx");
const account = () => read("web/src/components/payments/RentAccount.tsx");

test("the rent account has an address of its own", () => {
  assert.ok(
    existsSync(resolve(root, "web/app/record/payment/page.tsx")),
    "the rent account needs a route",
  );
  // The lease id, because the ledger itself is the lease's — `/leases/<id>/charges/`.
  assert.match(code(detail()), /const leaseId = search\.get\("leaseId"\)/);
  assert.match(code(detail()), /getLeaseLedger\(leaseId\)/);
});

test("the list opens it by navigating, not by covering itself", () => {
  const body = code(list());

  // The dialog and everything that drove it are gone.
  assert.doesNotMatch(body, /RentAccountDialog/);
  assert.doesNotMatch(body, /selectedLeaseId/);
  assert.doesNotMatch(body, /rent-dialog/);
  // The expense form is still a sheet over the page, and should be: it is one
  // short form. It is the shared sheet now, like every other modal here.
  assert.match(body, /className="payment-sheet expense-sheet"/);
  assert.match(body, /<ModalSheet/);

  // Both lists that carry a lease id link to the same place.
  assert.match(body, /href=\{`\/record\/payment\?leaseId=\$\{tenant\.lease_id\}` as never\}/);
  assert.match(body, /href=\{`\/record\/payment\?leaseId=\$\{payment\.lease_id\}` as never\}/);

  // A row that goes somewhere is a link, so it can be opened in a new tab and
  // is announced as navigation rather than as a button that does something.
  assert.doesNotMatch(body, /<button type="button" className="rent-row"/);

  // No lease means no rent account to open. It used to be a disabled button;
  // a disabled link is not a thing, so it stops being a link at all.
  assert.match(body, /tenant\.lease_id\s*\n?\s*\?\s*<Link/);
  assert.match(body, /rent-row is-inert/);
  // The rule itself, not one of its variants: asserting the bare selector
  // matched `.rent-row.is-inert:hover` and went green while the rule that
  // actually styles the row had been renamed out from under it.
  assert.match(read("web/src/styles/payments-workspace.css"), /\.rent-row\.is-inert \{/);
});

test("leaving and coming back lands where you left", () => {
  // The tab, the balance filter and the search were React state, which was free
  // while the account opened over the top of this page. Now that it is a page,
  // coming back remounts this one — so the address has to carry them, or
  // somebody who filtered to overdue and opened a record returns to Balances/All.
  const body = code(list());
  assert.match(body, /useSearchParams\(\)/);
  assert.match(body, /search\.get\("view"\)/);
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);

  // Replace, not push: filtering must not build a history trail somebody has to
  // walk back through to leave the page.
  assert.match(body, /router\.replace\(/);
  assert.doesNotMatch(body, /router\.push\(/);

  // Reading search params in the App Router needs a boundary above them.
  assert.match(body, /<Suspense/);

  // Only values the page knows are honoured; anything else falls back.
  assert.match(body, /VIEWS\.find\(/);
  assert.match(body, /FILTERS\.find\(/);
});

test("moving the account did not move the authority", () => {
  const body = code(account());

  // Every action still goes to the same endpoint it always did.
  for (const call of ["rentPaymentAction(", "adjustRentCharge(", "recordRentPayment("]) {
    assert.ok(body.includes(call), `${call} must still be the way this happens`);
  }

  // High-consequence gates are the ledger endpoint's server answers; route
  // params and a current-tenant Portfolio row are not authority for an ended
  // account.
  assert.match(body, /\{ledger\.permissions\.record_payment \? \(/);
  // Recording opens a small modal over the account (owner, 2026-10-05).
  assert.match(body, /<ModalSheet\s+open=\{recording\}/);
  // Both halves, in that order: waiving is a closing decision, so the client
  // asks for the server's permission *and* the server's post-tenancy answer.
  // Neither is client state, and the server enforces the same pair again.
  assert.match(
    body,
    /canWaive=\{ledger\.financial_summary\.is_post_tenancy && ledger\.permissions\.waive\}/,
  );
  assert.match(
    body,
    /canWriteOff=\{ledger\.financial_summary\.is_post_tenancy && ledger\.permissions\.write_off\}/,
  );
  assert.match(body, /title="Receiving actions are locked"/);

  // Confirming or disputing is still a decision somebody takes twice.
  assert.match(body, /decision === "confirm" \? "Confirm this payment\?"/);

  // Current Portfolio context may enrich the page, but the ledger remains
  // independently authoritative and contains ended-account context itself.
  assert.match(code(detail()), /portfolio\.tenants\.find\(\(row\) => row\.lease_id === leaseId\)/);
  assert.match(code(detail()), /ledger\?\.context\.tenant_name/);
});

test("a slow tenant lookup cannot keep the account off the screen", () => {
  // Two independent calls: the ledger is authorised on its own, and the tenant
  // beside it is only context. Settling them together would mean a Portfolio
  // that fails to load takes the rent account down with it.
  assert.match(code(detail()), /Promise\.allSettled/);
  // The ledger is what decides whether this page has anything to show.
  assert.match(code(detail()), /ledgerResult\.status === "rejected"/);
  // Without the tenant the account still renders, minus the actions it gates.
  assert.match(code(account()), /tenant: ProviderTenant \| null/);
});

test("the words a payment's state is described in are written once", () => {
  // The list says it and so does the record it opens. Two copies would
  // eventually disagree about what "confirmed" means.
  const shared = read("web/src/lib/rentDisplay.ts");
  for (const name of ["rentStatus", "recentPaymentStatus", "paymentStatus", "formatDate"]) {
    assert.match(shared, new RegExp(`export function ${name}\\(`));
  }
  assert.doesNotMatch(code(list()), /^function (rentStatus|paymentStatus|formatDate)\(/m);
  assert.doesNotMatch(code(account()), /^function (paymentStatus|formatDate)\(/m);
  assert.match(code(list()), /from "@\/lib\/rentDisplay"/);
  assert.match(code(account()), /from "@\/lib\/rentDisplay"/);
});

test("a payment record opens in a sheet over the list", () => {
  const body = code(list());
  const modal = code(read("web/src/components/payments/PaymentRecordModal.tsx"));

  // A plain click reads the record over the list, held in page state; the row
  // is still the link to the rent account, for a new tab.
  assert.match(body, /useDeepLinkedModal\("record"\)/);
  assert.match(body, /<PaymentRecordModal record=\{openedRecord\}/);
  assert.match(body, /href=\{`\/record\/payment\?leaseId=\$\{payment\.lease_id\}` as never\}[\s\S]{0,300}event\.preventDefault\(\);\s*onPeek\(\)/);
  // Refreshed in place, so it does not close under the person who acted.
  assert.match(body, /onChanged=\{load\}/);

  // The full record comes from the lease's ledger; the decision goes to the
  // same endpoint the rent account uses, and only when it is owed.
  assert.match(modal, /getLeaseLedger\(record\.lease_id\)/);
  assert.match(modal, /rentPaymentAction\(payment\.id, action, reason\.trim\(\)\)/);
  assert.match(modal, /awaiting && payment \?/);
  assert.match(modal, /disabled=\{decision === "dispute" && !reason\.trim\(\)\}/);
  assert.match(modal, /getPaymentEvidenceDownload\(file\.id\)/);
  // "All their payments" leaves for the tenant's payment page, not a sheet.
  assert.match(modal, /href=\{`\/record\/payment\?leaseId=\$\{record\.lease_id\}` as never\}>\s*All their payments/);
  assert.doesNotMatch(modal, /\/payments\?due=/);

  // The balance sheet is only the current balance: no Record payment action,
  // historical payments or receipt navigation is mixed into it.
  const due = code(read("web/src/components/payments/RentDueModal.tsx"));
  assert.doesNotMatch(due, /onRecord|Record payment/);
  assert.doesNotMatch(due, /dm-history|Payment history|ReceiptView|onViewReceipt|receipt_id/);
  assert.match(due, /href=\{`\/record\/payment\?leaseId=\$\{tenant\.lease_id\}` as never\}><Icon name="payments" \/>Full account/);
});

test("a balance opens in a sheet, and a receipt is read before it is printed", () => {
  const body = code(list());
  const due = code(read("web/src/components/payments/RentDueModal.tsx"));
  const receipt = code(read("web/src/components/payments/ReceiptModal.tsx"));
  const record = code(read("web/src/components/payments/PaymentRecordModal.tsx"));

  // Rent due rows open the balance over the list; the row still links to the account.
  assert.match(body, /useDeepLinkedModal\("due"\)/);
  assert.match(body, /<RentDueModal/);
  assert.match(due, /getLeaseLedger\(tenant\.lease_id\)/);
  assert.match(due, /charge\.outstanding_minor > 0/);
  // Recording starts on the tenant it was opened for.
  assert.match(body, /initialTenant=\{recordFor\}/);

  // The receipt is a view of the record's own sheet, with Back to the record.
  assert.match(record, /onViewReceipt\(payment\.receipt_id!\)/);
  assert.match(record, /nav\.push\(\{ kind: "receipt", id \}\)/);
  assert.match(record, /<ReceiptView/);
  assert.doesNotMatch(record, /<ReceiptModal/);
  assert.match(receipt, /getPaymentReceipt\(receiptId\)/);
  // Print requests a Unicode-safe copy of the frozen snapshot; Download saves
  // the exact issued PDF. Print stays left and Download right.
  assert.match(receipt, /printPdf\(await getPaymentReceiptDocument\(receipt\.id, true\)\)/);
  assert.match(receipt, /downloadBlob\(await getPaymentReceiptDocument\(receipt\.id\)/);
  assert.match(receipt, /Print<\/Button>\s*<span className="rc-actions-spacer" \/>[\s\S]*?Download\s*<\/Button>/);
  assert.doesNotMatch(receipt, /\/record\/receipt\?receiptId=/);

  // Links out of a sheet navigate without closing it first: the close reset
  // the address after the link had started, and the page stayed.
  for (const source of [record, due]) assert.doesNotMatch(source, /as never\} onClick=\{onClose\}/);
});

test("links to a tenancy or a tenant's payments open their sheets", () => {
  // The old detail pages stay for a new tab; links inside the app open the sheets.
  const home = code(read("web/app/home/page.tsx"));
  assert.match(home, /`\/tenants\?tenant=\$\{tenant\.tenancy_id \?\? tenant\.occupancy_id\}`/);
  assert.match(home, /`\/payments\?view=records&record=\$\{row\.id\}`/);
  assert.doesNotMatch(home, /`\/record\/tenant\?tenancyId=\$\{/);
  assert.doesNotMatch(home, /href: `\/record\/payment\?leaseId=\$\{/);
  assert.match(code(read("web/src/components/payments/RentAccount.tsx")), /`\/tenants\?tenant=\$\{tenant\.tenancy_id\}`/);

  // Payments opens a tenant's sheet by lease, and can start recording for one.
  const body = code(list());
  assert.match(body, /tenant\.lease_id === openDueId/);
  assert.match(body, /useDeepLinkedModal\("payfor"\)/);
  // The sheet stays on the current balance; history remains in the full account.
  assert.doesNotMatch(code(read("web/src/components/payments/RentDueModal.tsx")), /className="dm-history"/);
});
