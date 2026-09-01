import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile payout setup is a dedicated screen with owner and admin gating", () => {
  const workspace = read("mobile/app/(app)/(provider-tabs)/payments.tsx");
  const more = read("mobile/app/(app)/(provider-tabs)/more.tsx");
  const page = read("mobile/app/(app)/payout-account.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");

  assert.match(workspace, /\(app\)\/payout-account/);
  assert.match(workspace, /Activate online rent payments/);
  assert.match(workspace, /Add a verified bank or Mobile Money account/);
  assert.match(more, /label="Settlement account"/);
  assert.match(more, /\(app\)\/payout-account/);
  assert.match(layout, /name="payout-account"/);
  assert.match(page, /current_user_role === "owner"/);
  assert.match(page, /current_user_role === "admin"/);
  assert.match(page, /state\?\.provisioning\?\.checking/);
  assert.match(page, /Rooomly does not retain this number/);
  assert.match(page, /state\.profiles\.map/);
  assert.match(page, /Use this account/);
  assert.match(page, /Remove from future use/);
  assert.doesNotMatch(page, /<Modal|presentationStyle=/);
});

test("mobile payout provisioning is idempotent and never persists raw account details", () => {
  const api = read("mobile/src/organizations.ts");
  const page = read("mobile/app/(app)/payout-account.tsx");

  assert.match(api, /payout-destination\/`/);
  assert.match(api, /idempotentMutation\(\)/);
  assert.match(api, /payout-institutions/);
  assert.match(api, /payout-destination\/resolve/);
  assert.match(api, /payout-destination\/refresh/);
  assert.match(api, /payout-destinations\/\$\{profileId\}\/activate/);
  assert.match(api, /method: "DELETE"/);
  assert.match(page, /Check verification status/);
  assert.match(page, /setAccountNumber\(""\)/);
  assert.doesNotMatch(page, /AsyncStorage|SecureStore/);
});
