import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("web payout setup is a permission-aware Portfolio setting", () => {
  const workspace = read("web/app/payments/page.tsx");
  const page = read("web/app/settings/settlement/page.tsx");

  // Settings › Settlement account; the old Payments address redirects there.
  assert.match(workspace, /settings\/settlement\?organization=/);
  assert.match(read("web/app/settings/layout.tsx"), /href="\/settings\/settlement"/);
  assert.match(read("web/app/record/payout-account/page.tsx"), /router\.replace\(/);
  assert.match(page, /current_user_role === "owner"/);
  assert.match(page, /current_user_role === "admin"/);
  assert.match(page, /state\?\.provisioning\?\.checking/);
  assert.match(page, /Danpa HQ does not retain this number/);
  assert.match(page, /state\.profiles\.map/);
  assert.match(page, /Use this account/);
  assert.match(page, /Remove from future use/);
  assert.doesNotMatch(page, /<dialog|<Modal/);
});

test("web payout API keeps provisioning idempotent and account numbers transient", () => {
  const api = read("web/src/lib/console.ts");
  const page = read("web/app/settings/settlement/page.tsx");

  assert.match(api, /payout-destination\/`/);
  assert.match(api, /idempotentMutation\(\)/);
  assert.match(api, /payout-institutions/);
  assert.match(api, /payout-destination\/resolve/);
  assert.match(api, /payout-destination\/refresh/);
  assert.match(api, /payout-destinations\/\$\{profileId\}\/activate/);
  assert.match(api, /method: "DELETE"/);
  assert.match(page, /Check verification status/);
  assert.match(page, /setAccountNumber\(""\)/);
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
});
