import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile tenant Payments owns due items, attempts, history and receipts", () => {
  const screen = read("mobile/app/(app)/tenant-payments.tsx");
  const tab = read("mobile/app/(app)/(tabs)/payments.tsx");
  const home = read("mobile/src/components/home/TenantHome.tsx");
  const layout = read("mobile/app/(app)/(tabs)/_layout.tsx");

  assert.match(layout, /name="payments"[\s\S]{0,180}tabBarLabel: "Payments"/);
  // Services is a primary tab beside Payments, not hidden behind it. The two
  // stay separate: rent is an obligation between two named parties, a bundle is
  // a purchase from a third party, and one tab holding both is how a rental
  // product starts looking like a wallet.
  assert.match(layout, /name="services"[\s\S]{0,180}tabBarLabel: "Services"/);
  assert.doesNotMatch(read("mobile/app/(app)/(tabs)/services.tsx"), /rent-account|getLeaseLedger/);
  assert.match(tab, /tenant-payments/);
  assert.doesNotMatch(home, /label: "Payments"/);
  assert.match(screen, /<AuthPrompt[\s\S]{0,180}next="\/\(app\)\/\(tabs\)\/payments"/);
  assert.match(screen, /Due now/);
  assert.match(screen, /Check status/);
  assert.match(screen, /Pay rent/);
  assert.doesNotMatch(screen, /Open account/);
  assert.match(screen, /payment-checkout/);
  assert.match(screen, /Unsuccessful attempts/);
  assert.match(screen, /payment-receipt/);
});

test("mobile provider payment recording is a resumable screen, not a modal", () => {
  const account = read("mobile/app/(app)/rent-account.tsx");
  const record = read("mobile/app/(app)/provider-payment-record.tsx");
  const provider = read("mobile/app/(app)/(provider-tabs)/payments.tsx");

  assert.match(account, /provider-payment-record/);
  assert.doesNotMatch(account, /RecordPaymentModal/);
  assert.doesNotMatch(record, /<Modal/);
  assert.match(record, /This does not collect money/);
  assert.match(provider, /Awaiting settlement/);
  assert.match(provider, /Tenant paid/);
});
