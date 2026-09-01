import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

/** Source with comments stripped, so prose in a docstring never satisfies an
 *  assertion about what the code does. */
const code = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("provider billing is a Settings panel, reached beside Team", () => {
  const layout = read("web/app/settings/layout.tsx");
  const page = code(read("web/app/settings/billing/page.tsx"));

  assert.match(layout, /href="\/settings\/billing"/);
  // A plan belongs to a Portfolio, so the page reads one and says which.
  assert.match(page, /getPortfolioBilling/);
  assert.match(page, /listOrganizations/);
});

test("the page renders from the server's own numbers and decides nothing", () => {
  const page = code(read("web/app/settings/billing/page.tsx"));

  // Usage, limits and over-limit all come from the snapshot the backend
  // enforces with. A client-side recount would be a second source of truth.
  assert.match(page, /billing\.limits\[/);
  assert.match(page, /billing\.usage\[/);
  assert.match(page, /billing\.over_limit/);
  assert.doesNotMatch(page, /const\s+PLAN_LIMITS/);
});

test("entitlement names and grouping come from the catalogue, never hardcoded", () => {
  const page = code(read("web/app/settings/billing/page.tsx"));
  const client = code(read("web/src/lib/console.ts"));

  assert.match(client, /getPlanCatalogue/);
  assert.match(page, /catalogue\.entitlements/);
  assert.match(page, /catalogue\.groups/);
  assert.match(page, /catalogue\.headline_limits/);
  // Moving a capability between plans must not need a frontend release, so no
  // screen may carry its own copy of the plan ladder.
  assert.doesNotMatch(page, /"Automated rent reminders"/);
  assert.doesNotMatch(page, /PRO:\s*\{/);
});

test("no checkout: choosing a plan explains it is not live and charges nothing", () => {
  const page = code(read("web/app/settings/billing/page.tsx"));

  assert.match(page, /not available to buy yet/);
  assert.match(page, /Nothing has been charged/);
  // The whole point. No payment call, no plan mutation, from this page.
  assert.doesNotMatch(page, /createPaymentIntent|initiateCheckout|changePlan/);
});

test("unlimited is rendered as a word, never as a large number", () => {
  const page = code(read("web/app/settings/billing/page.tsx"));

  assert.match(page, /value\.unlimited/);
  assert.match(page, /Unlimited/);
  // 999999 is a lie that eventually gets printed.
  assert.doesNotMatch(page, /999999/);
});

test("being over a limit reads as a state, not as a failure", () => {
  const page = read("web/app/settings/billing/page.tsx");

  // A downgrade never deletes anything, and the page has to say so where a
  // provider would otherwise assume the worst.
  assert.match(page, /Nothing has been removed/);
  // The same sentence both clients carry, so the reassurance cannot drift
  // between web and mobile.
  assert.match(page, /never deletes properties, tenants, leases or payment records/);
});

test("only an owner or administrator is offered a plan change", () => {
  const page = code(read("web/app/settings/billing/page.tsx"));

  assert.match(page, /current_user_role === "owner"/);
  assert.match(page, /current_user_role === "admin"/);
  assert.match(page, /disabled=\{!canManage\}/);
});
