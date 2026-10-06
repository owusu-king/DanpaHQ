import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("tenant checkout is a resumable route and never trusts browser payment facts", () => {
  const account = read("web/src/components/payments/RentAccount.tsx");
  const checkout = read("web/app/payments/checkout/page.tsx");
  const returned = read("web/app/payments/return/page.tsx");
  const api = read("web/src/lib/payments.ts");
  const popup = read("web/src/lib/paystackPopup.ts");
  const adapter = read("backend/apps/payments/paystack.py");

  assert.match(account, /digital_payment\.available/);
  assert.match(account, /\/payments\/checkout\?lease=/);
  assert.match(checkout, /createPaymentIntent\(obligationId, method\)/);
  assert.match(checkout, /processing fee is paid by the property owner/i);
  assert.match(returned, /refreshPaymentIntent\(current\.id\)/);
  assert.match(returned, /retryPaymentIntent\(intent\.id\)/);
  assert.doesNotMatch(returned, /amount_minor.*params|get\("amount/i);
  assert.match(api, /hostname\.endsWith\("\.paystack\.com"\)/);
  assert.match(api, /next_action\?\.access_code/);
  assert.match(adapter, /"access_code": access_code/);
  assert.match(popup, /resumeTransaction\(accessCode/);
  assert.match(checkout, /openPaystackPopup\(intent/);
  assert.match(returned, /openPaystackPopup\(target/);
  assert.match(popup, /backend webhook\/verification endpoint remains the payment authority/);
  assert.match(api, /idempotentMutation\(\)/);
});

test("confirmed web payments lead to the durable receipt", () => {
  const returned = read("web/app/payments/return/page.tsx");
  // The receipt is a sheet now; its old address redirects to it.
  const receipt = read("web/src/components/payments/ReceiptModal.tsx");
  assert.match(read("web/app/payments/receipts/[receiptId]/page.tsx"), /redirect\(`\/payments\?receipt=/);
  assert.match(returned, /`\/payments\?receipt=\$\{intent\.receipt_id\}`/);
  const paymentsApi = read("web/src/lib/payments.ts");
  assert.match(returned, /intent\.receipt_id/);
  assert.match(returned, /Provider settlement is tracked separately/i);
  assert.match(receipt, /getPaymentReceipt/);
  assert.match(receipt, /snapshot\.tenant\.name/);
  assert.match(receipt, /snapshot\.obligation\.period_start/);
  assert.match(receipt, /getPaymentReceiptDocument/);
  assert.match(receipt, /Download/);
  // Printing never goes through a tab it has to wait on (lib/printDocument).
  const printing = read("web/src/lib/printDocument.ts");
  assert.match(printing, /export function printPdf\(/);
  assert.match(printing, /export function printElement\(/);
  for (const file of ["web/src/components/leases/LeaseRecord.tsx", "web/src/components/tenant/AgreementRecord.tsx", "web/src/components/payments/ReceiptModal.tsx"]) {
    assert.doesNotMatch(read(file), /pendingWindow|addEventListener\("load", \(\) => pending/, `${file} still prints through a pending tab`);
  }
  assert.match(paymentsApi, /document\.pdf\?disposition=inline/);
});
