import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("payment operations is an operations-only, auditable reconciliation workspace", () => {
  const shell = read("web/src/components/management/ManagementShell.tsx");
  const page = read("web/app/management/payments/page.tsx");
  const permissions = read("backend/apps/operations/permissions.py");
  const views = read("backend/apps/operations/views.py");

  assert.match(shell, /\/management\/payments/);
  assert.match(shell, /view_payments/);
  assert.match(permissions, /RECONCILE_PAYMENTS = "reconcile_payments"/);
  assert.match(permissions, /ManagementRole\.OPERATIONS_ADMIN/);
  assert.match(page, /managementIdempotentMutation\(\)/);
  assert.match(views, /aggregate_type="payment_operations"/);
  assert.match(views, /management_actor=request\.user/);
});

test("reconciliation decisions never present themselves as financial repairs", () => {
  const page = read("web/app/management/payments/page.tsx");
  const service = read("backend/apps/payments/reconciliation.py");

  assert.match(page, /never rewrites money/i);
  assert.match(page, /Compared evidence/);
  assert.match(page, /Investigation note/);
  assert.doesNotMatch(page, /refundPayment|allocatePayment|updateRent|markSettled/);
  assert.match(service, /A closed reconciliation exception cannot be reopened or reclassified/);
});
