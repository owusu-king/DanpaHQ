import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
// Comments explain; they must never be what satisfies an assertion.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const screen = () => code(read("mobile/app/(app)/billing.tsx"));
const plans = () => code(read("mobile/app/(app)/billing-plans.tsx"));
const review = () => code(read("mobile/app/(app)/billing-review.tsx"));
const payment = () => code(read("mobile/app/(app)/billing-payment.tsx"));
const card = () => code(read("mobile/src/components/billing/CurrentPlanCard.tsx"));
const records = () => code(read("mobile/src/components/billing/BillingRecords.tsx"));
const restricted = () => code(read("mobile/src/components/billing/RestrictedResources.tsx"));
const chooser = () => code(read("mobile/src/components/billing/KeepChooser.tsx"));
const presentation = () => code(read("mobile/src/billingPresentation.ts"));
const client = () => code(read("mobile/src/billing.ts"));
const screens = () =>
  [screen(), plans(), review(), payment(), card(), records(), restricted(), chooser(), presentation()].join("\n");

/** One function's text, whitespace-normalised, so two clients can be compared rule by rule. */
function body(source, name) {
  const start = source.search(new RegExp(`(?:export )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} not found`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end).replace(/^export /, "").replace(/\s+/g, " ");
}

test("a provider reaches Plan & billing from More, and every step of changing plan is a screen", () => {
  const more = read("mobile/app/(app)/(provider-tabs)/more.tsx");
  const layout = read("mobile/app/(app)/_layout.tsx");

  assert.match(more, /label: "Plan & billing", onPress: go\("\/\(app\)\/billing"\)/);
  for (const name of ["billing", "billing-plans", "billing-review", "billing-payment"]) {
    assert.match(layout, new RegExp(`<Stack\\.Screen name="${name}"`));
  }
});

test("the screen renders one Portfolio's billing read and the public catalogue", () => {
  assert.match(screen(), /await Promise\.all\(\[getPlanCatalogue\(\), getPortfolioBilling\(chosen\.id\)\]\)/);
  assert.match(client(), /export function getPortfolioBilling\(organizationId: string\)/);
  // One billing client. The old copy in the organizations module is gone.
  assert.doesNotMatch(code(read("mobile/src/organizations.ts")), /export function getPortfolioBilling|export type PortfolioBilling/);
});

test("no billing screen branches on a plan code or keeps its own price list", () => {
  assert.doesNotMatch(screens(), /["'](FREE|PRO|BUSINESS)["']/);
  assert.doesNotMatch(screens(), /\b(8900|29900|89000|299000)\b/);
  assert.match(presentation(), /return catalogue\.upgrade_order\.indexOf\(code\);/);
});

test("who may change the plan is the server's answer, not a visible role", () => {
  assert.match(card(), /\{billing\.viewer\.can_change_plan \? \(/);
  assert.match(presentation(), /if \(billing\.viewer\.can_change_plan\) \{/);
  assert.doesNotMatch(screens(), /current_user_role/);
});

test("usage meters measure what runs in full, from the server's own counts", () => {
  const source = presentation();
  const meters = source.slice(source.indexOf("export function metersOf"), source.indexOf("export type StandingAction"));
  assert.match(meters, /const metric = billing\.usage_for_limit\[key\];/);
  assert.match(meters, /const used = metric \? \(billing\.active_usage\?\.\[metric\] \?\? billing\.usage\[metric\] \?\? 0\) : 0;/);
  assert.match(meters, /const restricted = Math\.max\(held - used, 0\);/);
  assert.doesNotMatch(screens(), /PROPERTY_COUNT|USAGE_FOR/);
});

test("a paid change opens a server-priced checkout and waits for the server to confirm it", () => {
  assert.match(
    review(),
    /const checkout = await startSubscriptionCheckout\(organizationId, \{[\s\S]*?\}\);\s*router\.replace\(\{\s*pathname: "\/\(app\)\/billing-payment",\s*params: \{ organizationId, checkoutId: checkout\.id, open: "1" \},/,
  );
  const flow = payment();
  assert.match(flow, /\? await refreshSubscriptionCheckout\(organizationId, checkoutId\)\s*: await getSubscriptionCheckout\(organizationId, checkoutId\);/);
  // Closing the checkout, or its return page, only prompts a server check.
  assert.match(flow, /function returned\(\) \{\s*setSheet\(null\);\s*setClosed\(true\);\s*void check\(true, true\);\s*\}/);
  assert.match(flow, /<PaystackCheckoutModal intent=\{sheet\} settles="your plan" onClose=\{returned\} onCheckoutReturn=\{returned\} \/>/);
  // Success is a state the server reports, never one this screen sets.
  assert.match(flow, /checkout\.status === "succeeded" \? \(/);
  assert.doesNotMatch(flow, /status: "succeeded"/);
});

test("a retry the provider may already have paid never prices the change again", () => {
  assert.match(
    payment(),
    /reason === "payment_confirming" \|\| reason === "paid_needs_review"\)\) \{\s*setError\(cause\.error\.message\);\s*return;\s*\}\s*reprice\(current\);/,
  );
});

test("subscription checkout reuses the one secure checkout sheet rent already uses", () => {
  assert.match(payment(), /import \{ PaystackCheckoutModal \} from "@\/components\/payments\/PaystackCheckoutModal";/);
  assert.doesNotMatch(screens(), /react-native-paystack|PaystackProvider|usePaystack/);
});

test("a downgrade is reviewed against the server's projection and keeps records safe", () => {
  const flow = review();
  assert.match(flow, />\s*Your records stay safe\s*<\/Type>/);
  assert.match(
    flow,
    /Downgrading never deletes your properties, units, tenants, agreements, payments, or history\. Resources above your new plan limits may have restricted management capabilities\. Existing tenancies can continue to completion, but starting new rental activity on restricted properties requires available plan capacity or an upgrade\./,
  );
  // The old promises — that nothing changes, that everything could still be let — were not true, and are gone.
  assert.doesNotMatch(screens(), /keep opening, editing and letting/i);
  assert.doesNotMatch(screens(), /Nothing will be deleted\./);
});

test("the downgrade asks what stays fully active, and sends a choice only when one is needed", () => {
  const flow = review();
  // It opens on the server's own selection, never one this client makes up…
  assert.match(flow, /keep=\{keep \?\? initialKeep\(quote\.resource_choice\)\}/);
  // …asks for a whole choice before it can be confirmed…
  assert.match(flow, /const complete = keepComplete\(quote\.resource_choice, keep\);/);
  assert.match(flow, /label="Confirm downgrade"[\s\S]{0,160}disabled=\{!complete\}/);
  // …in the words the product settled on…
  assert.match(chooser(), /using=\{`You're using \$\{countLabel\(choice\.properties\.length, "Properties"\)\}`\}/);
  assert.match(chooser(), /includes=\{`\$\{plan\} includes \$\{places\}`\}/);
  assert.match(chooser(), /"Choose the property you want to keep fully active\."/);
  // …speaks only for the limits the server says the choice settles…
  assert.match(flow, /rows\.filter\(\(row\) => row\.over && !choice\.covers\.includes\(row\.key\)\)/);
  // …and sends it only when the move goes above the plan's allowance.
  assert.match(
    flow,
    /await changePlanWithoutPayment\(\s*organizationId,\s*quote\.plan\.code,\s*quote\.resource_choice\?\.required \? keepActive : undefined,\s*\);/,
  );
  assert.match(client(), /\.\.\.\(keepActive \? \{ keep_active: keepActive \} : \{\}\)/);
});

test("restricted resources come back only through the server, where it says there is room", () => {
  assert.match(restricted(), /const hasRoom = \(kind: RestrictedResource\["kind"\]\) => room\[kind\] === null \|\| \(room\[kind\] \?\? 0\) > 0;/);
  assert.match(restricted(), /\{canChange && hasRoom\(resource\.kind\) \? \(/);
  assert.match(screen(), /const next = await reactivateResources\(/);
  assert.match(client(), /\/resource-access\/reactivate\//);
  // A restricted property stops offering what the API would refuse, and says why.
  assert.match(
    code(read("mobile/app/(app)/provider-property.tsx")),
    /const canAddUnit = \(property\.capabilities\.private_inventory\?\.allowed \?\? false\) && !restricted;/,
  );
  assert.match(code(read("mobile/app/(app)/space.tsx")), /unit\.billing_access && unit\.billing_access\.state !== "full"/);
});

test("a phone and a browser apply the same rules and say the same words about a downgrade", () => {
  const mobile = presentation();
  const web = code(read("web/src/lib/billingPresentation.ts"));
  // The rules that decide what a choice keeps, and when it can be confirmed, are
  // the same text in both clients — so the two can never disagree.
  for (const name of [
    "placesFor",
    "propertyPlaces",
    "propertiesNeedChoosing",
    "keptPropertyIds",
    "unitsOfKept",
    "unitPlaces",
    "unitsNeedChoosing",
    "unitsFor",
    "initialKeep",
    "keepComplete",
    "keepPropertyNote",
    "propertyConsequence",
    "unitConsequence",
    "accessStatusOf",
    "allowanceLine",
    "restrictionSummary",
  ]) {
    assert.equal(body(mobile, name), body(web, name), `${name} differs between web and mobile`);
  }
  const webDialog = code(read("web/src/components/billing/PlanChangeDialog.tsx"));
  for (const words of [
    "Your records stay safe",
    "Downgrading never deletes your properties, units, tenants, agreements, payments, or history.",
    "Choose the property you want to keep fully active.",
    ", and your choice takes effect with it",
    "Everything already here stays; adding more waits until there is room.",
  ]) {
    assert.ok(review().includes(words) || chooser().includes(words), `mobile lacks: ${words}`);
    assert.ok(webDialog.includes(words), `web lacks: ${words}`);
  }
});

test("a plan nobody pays for shows no billing cycle and no empty payment rows", () => {
  assert.match(records(), /const paid = subscription\?\.is_live && subscription\.funding === "paid";/);
  assert.doesNotMatch(screens(), /Next payment: —/);
});

test("unlimited capacity is a word, never a large number", () => {
  assert.match(presentation(), /if \(count === null\) return `Unlimited \$\{noun\}`;/);
  assert.doesNotMatch(screens(), /999999/);
});

test("nothing on a plan card moves when the billing cycle changes", () => {
  // The note is rendered whether or not there is one. Conditionally, the panel
  // is a line shorter on one cycle than the other and every plan below it
  // jumps as the toggle is pressed.
  assert.match(plans(), /numberOfLines=\{1\} style=\{styles\.planNote\}>\{note \|\| " "\}/);
});
