import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile Verification is an overview with focused identity and payout journeys", () => {
  const overview = read("mobile/app/(app)/trust.tsx");
  const identity = read("mobile/app/(app)/identity-verification.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");
  const tenantIndex = read("mobile/app/(app)/(tabs)/profile.tsx");
  const providerIndex = read("mobile/app/(app)/(provider-tabs)/more.tsx");

  assert.match(overview, /getPayoutDestination/);
  assert.match(overview, /profile\?\.status === "verified"/);
  assert.match(overview, /pathname: "\/\(app\)\/payout-account"/);
  assert.match(overview, /\/\(app\)\/identity-verification/);
  assert.doesNotMatch(overview, /ImagePicker|Ghana Card number/);
  assert.match(identity, /ImagePicker/);
  assert.match(identity, /Ghana Card number/);
  assert.match(layout, /name="trust" options=\{\{ title: "Verification"/);
  assert.match(tenantIndex, /label: "Verification"/);
  assert.match(providerIndex, /label: "Verification"/);
  assert.doesNotMatch(tenantIndex, /Your checks/);
  assert.doesNotMatch(providerIndex, /Your checks/);
});
