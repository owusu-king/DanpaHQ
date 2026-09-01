import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("web Payments is role-aware and gives tenants a first-class destination", () => {
  const route = read("web/app/payments/page.tsx");
  const tenant = read("web/src/components/payments/TenantPayments.tsx");
  const navigation = read("web/src/lib/portalNav.ts");

  assert.match(route, /inProvider \? <ProviderPaymentsContent \/> : <TenantPaymentsWorkspace \/>/);
  assert.match(navigation, /href: "\/payments", label: "Payments"/);
  assert.match(tenant, /Due now/);
  assert.match(tenant, /Pay rent/);
  assert.doesNotMatch(tenant, /Open account/);
  assert.match(tenant, /Check status/);
  assert.match(tenant, /Unsuccessful attempts/);
  assert.match(tenant, /payments\/receipts/);
});

test("landlord Payments keeps tenant payment and provider settlement distinct", () => {
  const page = read("web/app/payments/page.tsx");

  assert.match(page, /Paid online/);
  assert.match(page, /Awaiting settlement/);
  assert.match(page, /Settled to you/);
  assert.match(page, /Fees deducted/);
  assert.match(page, /Property owners bear Paystack’s transaction fee/);
  assert.match(page, /Tenant paid, settlement pending/);
});
