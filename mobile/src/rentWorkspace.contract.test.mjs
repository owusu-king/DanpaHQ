import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile Payments supports scale and opens a focused rent account", () => {
  const list = read("mobile/app/(app)/(provider-tabs)/payments.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");

  assert.match(list, /FlatList/);
  assert.match(list, /"balances", "records", "payouts", "expenses"/);
  assert.match(list, /Search balances/);
  assert.match(list, /"all", "overdue", "outstanding", "current"/);
  assert.match(list, /rent-account/);

  // Tenant payment and provider settlement are different financial facts.
  assert.match(list, /summary\.money\.awaiting_settlement_minor/);
  assert.match(list, /summary\.money\.settled_net_minor/);
  assert.match(list, /Property owners bear Paystack’s transaction fee/);
  assert.match(layout, /name="rent-account"/);
});

test("mobile rent account uses domain actions and a dedicated payment-record journey", () => {
  const detail = read("mobile/app/(app)/rent-account.tsx");
  const record = read("mobile/app/(app)/provider-payment-record.tsx");
  const api = read("mobile/src/leases.ts");

  assert.match(detail, /getLeaseLedger/);
  assert.match(detail, /rentPaymentAction/);
  assert.match(detail, /adjustRentCharge/);
  assert.match(detail, /ledger\.financial_summary\.is_post_tenancy && ledger\.permissions\.waive/);
  assert.match(detail, /ledger\.financial_summary\.is_post_tenancy && ledger\.permissions\.write_off/);
  assert.match(detail, /Confirm write-off/);
  assert.match(detail, /Closing financial summary/);
  assert.match(detail, /provider-payment-record/);
  assert.match(record, /recordRentPayment/);
  assert.doesNotMatch(record, /<Modal|presentationStyle="pageSheet"/);
  assert.match(record, /does not collect money/i);
  assert.match(record, /tenant must confirm/i);
  assert.match(api, /\/rent\/payments\/\$\{id\}\/\$\{action\}\//);
  assert.match(api, /\/rent\/charges\/\$\{id\}\/\$\{kind\}\//);
  assert.match(api, /amount_minor: amountMinor, reason, confirmed: true/);
});

test("mobile payment attention counts only the claims the provider still owes", () => {
  const payments = read("mobile/app/(app)/(provider-tabs)/payments.tsx");
  const home = read("mobile/app/(app)/(provider-tabs)/index.tsx");

  assert.match(payments, /summary\.money\.payment_records_awaiting_you > 0/);
  assert.doesNotMatch(payments, /pending_payment_records/);
  assert.match(home, /money\?\.payment_records_awaiting_you/);
  assert.doesNotMatch(home, /pending_payment_records/);
  assert.match(home, /to confirm/);
});

test("mobile tenant Payments keeps ended rent accounts reachable", () => {
  assert.match(read("mobile/app/(app)/tenant-payments.tsx"), /listMyTenancies\(true\)/);
  assert.match(read("mobile/src/tenancy.ts"), /include_ended=1/);
});

test("external payments are explicit, evidenced and tenant-confirmed on mobile", () => {
  const detail = read("mobile/app/(app)/rent-account.tsx");
  const record = read("mobile/app/(app)/provider-payment-record.tsx");
  const tenant = read("mobile/app/(app)/tenant-payments.tsx");
  const receipt = read("mobile/app/(app)/payment-receipt.tsx");
  const api = read("mobile/src/leases.ts");

  assert.match(record, /Record external payment/);
  assert.match(record, /Direct mobile money/);
  assert.match(record, /uploadImage\(evidence, "payment_evidence"\)/);
  assert.match(detail, /I didn’t make this payment/);
  assert.match(detail, /Paid externally · recorded through Rooomly/);
  assert.match(tenant, /CONFIRM AN EXTERNAL PAYMENT/);
  assert.match(tenant, /receiptId: payment\.receipt_id/);
  assert.match(receipt, /snapshot\.payment\.source === "PLATFORM_PSP"/);
  assert.match(api, /evidence_file_id\?: string \| null/);
  assert.match(api, /rent_payment_review/);
});
