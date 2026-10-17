import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile checkout is a dedicated journey with a server-authoritative return", () => {
  const account = read("mobile/app/(app)/rent-account.tsx");
  const checkout = read("mobile/app/(app)/payment-checkout.tsx");
  const status = read("mobile/app/(app)/payment-status.tsx");
  const modal = read("mobile/src/components/payments/PaystackCheckoutModal.tsx");
  const api = read("mobile/src/payments.ts");

  assert.match(account, /digital_payment\.available/);
  assert.match(account, /payment-checkout/);
  assert.match(checkout, /createPaymentIntent\(obligationId, method\)/);
  assert.match(checkout, /processing fee is paid by the property owner/i);
  assert.match(status, /useFocusEffect/);
  assert.match(status, /refreshPaymentIntent\(current\.id\)/);
  assert.match(status, /retryPaymentIntent\(intent\.id\)/);
  assert.doesNotMatch(status, /Linking\.openURL/);
  assert.match(checkout, /PaystackCheckoutModal/);
  assert.match(status, /PaystackCheckoutModal/);
  assert.match(modal, /from "react-native-webview"/);
  assert.match(modal, /isPaymentReturnUrl/);
  assert.match(modal, /Danpa HQ confirms the result with Paystack/i);
  assert.match(api, /hostname\.endsWith\("\.paystack\.com"\)/);
  assert.match(api, /pathname\.replace\(\/\\\/\$\//);
});

test("mobile payment success keeps settlement distinct and opens a receipt screen", () => {
  const status = read("mobile/app/(app)/payment-status.tsx");
  const receipt = read("mobile/app/(app)/payment-receipt.tsx");
  const documents = read("mobile/src/paymentDocuments.ts");
  const layout = read("mobile/app/(app)/_layout.tsx");
  assert.match(status, /Provider settlement is tracked separately/i);
  assert.match(status, /intent\.receipt_id/);
  assert.match(receipt, /getPaymentReceipt/);
  assert.match(receipt, /snapshot\.tenant\.name/);
  assert.match(receipt, /Period covered/);
  assert.match(receipt, /View or save PDF/);
  assert.match(receipt, /Print/);
  assert.match(documents, /document\.pdf\?disposition=inline/);
  assert.match(documents, /Sharing\.shareAsync/);
  assert.match(documents, /Print\.printAsync/);
  assert.match(layout, /name="payment-checkout"/);
  assert.match(layout, /name="payment-status"/);
  assert.match(layout, /name="payment-receipt"/);
});
