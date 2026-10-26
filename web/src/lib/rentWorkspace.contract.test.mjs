import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("provider Payments is a scalable rent workspace, not a summary dashboard", () => {
  const page = read("web/app/payments/page.tsx");

  assert.match(page, /type PaymentsView = "balances" \| "records" \| "payouts" \| "expenses"/);
  assert.match(page, /Search tenant, Property or Unit/);
  assert.match(page, /"all", "overdue", "outstanding", "current"/);
  assert.match(page, /lease_id/);
  assert.match(page, /summary\.money\.awaiting_settlement_minor/);
  assert.match(page, /summary\.money\.settled_net_minor/);
  assert.match(page, />Payouts<\/PaymentTab>/);

  // The account itself moved to its own route when it stopped being a modal.
  // The ledger and the receiving gate went with it; the workspace's job is to
  // find the right row and hand over the id.
  assert.match(read("web/app/record/payment/page.tsx"), /getLeaseLedger/);
  assert.match(read("web/src/components/payments/RentAccount.tsx"), /ledger\.permissions\.record_payment/);
});

test("provider can review claims and record auditable adjustments through the authoritative rent API", () => {
  // These live in the rent account, which is now a page rather than a dialog
  // over the payments list. Every call is unchanged — moving the container was
  // not allowed to move where the authority is.
  const account = read("web/src/components/payments/RentAccount.tsx");
  const api = read("web/src/lib/tenant.ts");
  const css = read("web/src/styles/payments-workspace.css");

  // The call, not the import: asserting the bare name went green with the
  // import line still present and the call replaced by a no-op.
  assert.match(account, /await rentPaymentAction\(payment\.id, action, reason\.trim\(\)\)/);
  assert.match(account, /await recordRentPayment\(\{/);
  assert.match(account, /await adjustRentCharge\(charge\.id, adjusting, amountMinor, reason\.trim\(\)\)/);
  assert.match(account, /ledger\.financial_summary\.is_post_tenancy && ledger\.permissions\.waive/);
  assert.match(account, /ledger\.financial_summary\.is_post_tenancy && ledger\.permissions\.write_off/);
  assert.match(account, /Confirm write-off/);
  assert.match(account, /Closing financial summary/);
  assert.match(account, /does not collect or transfer money/i);
  assert.match(account, /tenant must confirm/i);
  assert.match(api, /\/rent\/payments\/\$\{id\}\/\$\{action\}\//);
  assert.match(api, /\/rent\/charges\/\$\{id\}\/\$\{kind\}\//);
  assert.match(api, /amount_minor: amountMinor, reason, confirmed: true/);

  // The rent account's own dialog is gone. Recording a payment or an expense
  // is the shared sheet (full screen on a phone, per doc-modal.css), so the
  // page no longer draws a dialog of its own.
  assert.doesNotMatch(css, /\.rent-dialog/);
  assert.doesNotMatch(css, /\.payment-dialog/);
  assert.match(css, /\.payment-sheet \.rent-actions \{[^}]*position: sticky/);
});

test("payment attention counts only the claims the provider still owes an answer to", () => {
  const payments = read("web/app/payments/page.tsx");
  const home = read("web/app/home/page.tsx");

  // A record the provider made is waiting on the tenant. Counting it as their
  // own queue told them to confirm their own payment.
  assert.match(payments, /summary\.money\.payment_records_awaiting_you > 0/);
  assert.doesNotMatch(payments, /pending_payment_records/);
  assert.match(home, /money\?\.payment_records_awaiting_you/);
  assert.doesNotMatch(home, /pending_payment_records/);
  // The count lives in its own column now rather than inside the label, so
  // the row reads "Payments to confirm … 2" instead of "2 payment records to
  // confirm". What must not change is that the number is the one the
  // provider still owes an answer to.
  assert.match(home, /label: "Payments to confirm"/);
  assert.match(home, /value: String\(paymentsAwaitingYou\)/);
  assert.match(home, /Confirm or dispute/);
});

test("tenant Payments keeps ended rent accounts reachable", () => {
  const workspace = read("web/src/components/payments/TenantPayments.tsx");
  const tenancyApi = read("web/src/lib/tenancy.ts");
  assert.match(workspace, /listMyTenancies\(true\)/);
  assert.match(tenancyApi, /include_ended=1/);
});

test("external payments are explicit, evidenced and tenant-confirmed on web", () => {
  const account = read("web/src/components/payments/RentAccount.tsx");
  const tenant = read("web/src/components/payments/TenantPayments.tsx");
  const receipt = read("web/src/components/payments/ReceiptModal.tsx");
  const api = read("web/src/lib/tenant.ts");

  assert.match(account, /Record external payment/);
  assert.match(account, /Direct mobile money/);
  assert.match(account, /Direct bank transfer/);
  assert.match(account, /uploadFile\(evidenceFile, "payment_evidence"\)/);
  assert.match(account, /I didn’t make this payment/);
  assert.match(account, /Paid externally · recorded through Danpa HQ/);
  assert.match(tenant, /Confirm an external payment/);
  assert.match(tenant, /receiptId: payment\.receipt_id/);
  assert.match(receipt, /const external = receipt\.source === "EXTERNAL"/);
  assert.match(api, /evidence_file_id\?: string \| null/);
  assert.match(api, /rent_payment_review/);
});
