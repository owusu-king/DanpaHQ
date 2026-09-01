import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("a provider reaches their plan from More, and it is a registered screen", () => {
  const more = read("mobile/app/(app)/(provider-tabs)/more.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");

  assert.match(more, /label="Plan"/);
  assert.match(more, /\/\(app\)\/billing"/);
  assert.match(layout, /name="billing"/);
});

test("the screen renders from the server's snapshot and recounts nothing", () => {
  const screen = code(read("mobile/app/(app)/billing.tsx"));

  assert.match(screen, /getPortfolioBilling/);
  assert.match(screen, /billing\.limits\[/);
  assert.match(screen, /billing\.usage\[/);
  assert.match(screen, /billing\.over_limit/);
});

test("entitlement names and grouping come from the catalogue", () => {
  const screen = code(read("mobile/app/(app)/billing.tsx"));
  const client = code(read("mobile/src/organizations.ts"));

  assert.match(client, /getPlanCatalogue/);
  assert.match(screen, /catalogue\.entitlements/);
  assert.match(screen, /catalogue\.groups/);
  assert.match(screen, /catalogue\.headline_limits/);
  // A plan ladder copied into the app is a plan ladder that needs a release to
  // change. The three plan names may appear only as data from the server.
  assert.doesNotMatch(screen, /"Automated rent reminders"/);
  assert.doesNotMatch(screen, /monthly_price_minor:\s*\d/);
});

test("no checkout on mobile either", () => {
  const screen = code(read("mobile/app/(app)/billing.tsx"));

  assert.match(screen, /not available to buy yet/);
  assert.match(screen, /Nothing has been charged/);
  assert.doesNotMatch(screen, /createPaymentIntent|initiatePayment|changePlan/);
});

test("unlimited is a word and a downgrade is described as losing nothing", () => {
  const screen = read("mobile/app/(app)/billing.tsx");

  assert.match(code(screen), /value\.unlimited/);
  assert.match(screen, /Unlimited/);
  // Stripped, so the comment explaining why 999999 is wrong does not count as
  // the code doing it.
  assert.doesNotMatch(code(screen), /999999/);
  assert.match(screen, /never deletes properties, tenants, leases or payment records/);
});

test("web and mobile show the same three headline limits", () => {
  const mobile = read("mobile/app/(app)/billing.tsx");
  const web = read("web/app/settings/billing/page.tsx");

  // Both read the list from the catalogue rather than each naming its own, so
  // the two surfaces cannot drift apart.
  for (const source of [mobile, web]) {
    assert.match(source, /PROPERTY_LIMIT: "PROPERTY_COUNT"/);
    assert.match(source, /UNIT_LIMIT: "UNIT_COUNT"/);
    assert.match(source, /TEAM_MEMBER_LIMIT: "TEAM_MEMBER_COUNT"/);
    assert.match(source, /headline_limits/);
  }
});
