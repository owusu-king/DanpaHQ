import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
// Comments explain; they must never be what satisfies an assertion.
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const page = () => code(read("web/app/settings/billing/page.tsx"));
const hero = () => code(read("web/src/components/billing/CurrentPlan.tsx"));
const dialog = () => code(read("web/src/components/billing/PlanChangeDialog.tsx"));
const records = () => code(read("web/src/components/billing/BillingRecords.tsx"));
const restricted = () => code(read("web/src/components/billing/RestrictedResources.tsx"));
const presentation = () => code(read("web/src/lib/billingPresentation.ts"));
const client = () => code(read("web/src/lib/billing.ts"));
const css = () => read("web/src/styles/billing-workspace.css");
const screens = () => [page(), hero(), dialog(), records(), restricted(), presentation()].join("\n");

test("the page renders one Portfolio's billing read and the public catalogue", () => {
  assert.match(read("web/app/settings/layout.tsx"), /href="\/settings\/billing"/);
  assert.match(page(), /Promise\.all\(\[getPlanCatalogue\(\), getPortfolioBilling\(chosen\.id\)\]\)/);
  assert.match(client(), /export function getPortfolioBilling\(organizationId: string\)/);
  // One billing client. The old copy in the console grab-bag is gone.
  assert.doesNotMatch(code(read("web/src/lib/console.ts")), /export type PortfolioBilling|export function getPortfolioBilling/);
});

test("no billing screen branches on a plan code or keeps its own price list", () => {
  assert.doesNotMatch(screens(), /["'](FREE|PRO|BUSINESS)["']/);
  assert.doesNotMatch(screens(), /\b(8900|29900|89000|299000)\b/);
  // Which plan is higher is the catalogue's ladder, not an opinion in a component.
  assert.match(presentation(), /return catalogue\.upgrade_order\.indexOf\(code\);/);
  assert.match(presentation(), /return catalogue\.plans\.map\(\(plan, index\) =>/);
});

test("who may change the plan is the server's answer, not a visible role", () => {
  assert.match(hero(), /\{billing\.viewer\.can_change_plan \? \(/);
  assert.match(presentation(), /if \(billing\.viewer\.can_change_plan\) \{/);
  assert.doesNotMatch(screens(), /current_user_role/);
});

test("usage meters measure what runs in full, from the server's own counts", () => {
  // Sliced to the meters themselves: the downgrade review reads the same map,
  // and a file-wide match would be satisfied by whichever copy still does.
  const source = presentation();
  const meters = source.slice(source.indexOf("export function metersOf"), source.indexOf("export type StandingAction"));
  assert.match(meters, /const metric = billing\.usage_for_limit\[key\];/);
  assert.match(meters, /const used = metric \? \(billing\.active_usage\?\.\[metric\] \?\? billing\.usage\[metric\] \?\? 0\) : 0;/);
  assert.match(meters, /const restricted = Math\.max\(held - used, 0\);/);
  assert.match(meters, /const limit = billing\.limits\[key\] \?\? null;/);
  assert.doesNotMatch(screens(), /PROPERTY_COUNT|USAGE_FOR/);
});

test("a paid change opens a checkout and waits for the server to confirm it", () => {
  const flow = dialog();
  assert.match(flow, /const checkout = await startSubscriptionCheckout\([\s\S]*?\);\s*setStep\(\{ name: "payment", checkout \}\);/);
  assert.match(flow, /if \(next\.status === "succeeded"\) \{[\s\S]{0,200}setStep\(\{\s*name: "done"/);
  assert.match(flow, /\? await refreshSubscriptionCheckout\(organizationId, id\)\s*: await getSubscriptionCheckout\(organizationId, id\);/);
  // The provider's own "success" callback only prompts a server check.
  assert.match(flow, /onSuccess: \(\) => \{[^}]*void check\(checkout\.id, true\);/);
  assert.doesNotMatch(flow, /onSuccess:[^}]*name: "done"/);
});

test("a retry the provider may already have paid never prices the change again", () => {
  const flow = dialog();
  // Paid after all: applied, and shown as the result, not charged again…
  assert.match(flow, /if \(next\.status === "succeeded"\) \{\s*settle\(next\);\s*return;\s*\}/);
  // …and money still being confirmed, or needing review, keeps the payer where they are.
  assert.match(
    flow,
    /if \(reason === "payment_confirming" \|\| reason === "paid_needs_review"\) \{\s*setError\([\s\S]{0,120}\);\s*void onChanged\(\);\s*return;\s*\}\s*setStep\(reprice\);/,
  );
});

test("subscription checkout reuses the one Paystack popup rent already uses", () => {
  assert.match(dialog(), /import \{ openPaystackPopup \} from "@\/lib\/paystackPopup";/);
  assert.match(dialog(), /const opened = await openPaystackPopup\(checkout, \{/);
  assert.doesNotMatch(screens(), /@paystack\/inline-js|new PaystackPop\b/);
});

test("the dialog is modal, keeps a payment from being dismissed mid-start, and restores focus", () => {
  const flow = dialog();
  assert.match(flow, /<dialog/);
  assert.match(flow, /if \(dialog && !dialog\.open\) dialog\.showModal\(\);/);
  assert.match(flow, /onCancel=\{\(event\) => \{\s*event\.preventDefault\(\);\s*requestClose\(\);/);
  // Escape takes the same guarded path, not only the browser's own close request.
  assert.match(flow, /onKeyDown=\{\(event\) => \{\s*if \(event\.key === "Escape"\) \{\s*event\.preventDefault\(\);\s*requestClose\(\);/);
  assert.match(flow, /if \(busy === null\) onClose\(\);/);
  assert.match(flow, /headingRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*\}, \[step\.name\]\);/);
  assert.match(flow, /opener\?\.focus\(\{ preventScroll: true \}\);/);
  // A top-layer modal would sit above the provider's window, so it steps aside.
  assert.match(flow, /handedOff\.current = true;\s*dialog\?\.close\(\);/);
});

test("a downgrade is reviewed against the server's projection and keeps records safe", () => {
  assert.match(presentation(), /const over = quote\.over_limit\.find\(\(row\) => row\.entitlement === key\);/);
  assert.match(dialog(), /offer\.effective === "period_end"/);
  assert.match(dialog(), /<p className="billing-reassure-title">Your records stay safe<\/p>/);
  // The approved copy, whole.
  assert.match(
    dialog(),
    /Downgrading never deletes your properties, units, tenants, agreements, payments, or history\. Resources above your new plan limits may have restricted management capabilities\. Existing tenancies can continue to completion, but starting new rental activity on restricted properties requires available plan capacity or an upgrade\./,
  );
  // The old promises — that nothing changes, that everything could still be let — were not true, and are gone.
  assert.doesNotMatch(screens(), /keep opening, editing and letting/i);
  assert.doesNotMatch(screens(), /Nothing will be deleted\./);
});

test("the downgrade asks what stays fully active, and sends a choice only when one is needed", () => {
  const flow = dialog();
  const source = presentation();
  // It opens on the server's own selection, never one this client makes up…
  assert.match(flow, /initialKeep\(offer\.resource_choice\)/);
  assert.match(source, /const property_ids = propertiesNeedChoosing\(choice\) \? \[\.\.\.choice\.selected\.property_ids\] : \[\];/);
  // …asks for a whole choice before it can be confirmed…
  assert.match(flow, /const complete = keepComplete\(offer\.resource_choice, kept\);/);
  assert.match(flow, /disabled=\{!complete \|\| \(busy !== null && busy !== "downgrade"\)\}/);
  assert.match(source, /chosen\.length === places && chosen\.every\(\(id\) => eligible\.includes\(id\)\)/);
  // …in the words the product settled on…
  assert.match(flow, /using=\{`You're using \$\{countLabel\(choice\.properties\.length, "Properties"\)\}`\}/);
  assert.match(flow, /includes=\{`\$\{plan\} includes \$\{places\}`\}/);
  assert.match(flow, /"Choose the property you want to keep fully active\."/);
  assert.match(
    source,
    /`\$\{others\} other \$\{others === 1 \? "property" : "properties"\} will remain accessible\. Existing tenancies can continue, but new rental activity on \$\{others === 1 \? "it" : "those properties"\} will be restricted\.`/,
  );
  // …speaks only for the limits the server says the choice settles…
  assert.match(flow, /rows\.filter\(\(row\) => row\.over && !choice\.covers\.includes\(row\.key\)\)/);
  // …and sends it only when the move goes above the plan's allowance.
  assert.match(
    flow,
    /await changePlanWithoutPayment\(\s*organizationId,\s*offer\.plan\.code,\s*offer\.resource_choice\?\.required \? keepActive : undefined,\s*\);/,
  );
  assert.match(client(), /\.\.\.\(keepActive \? \{ keep_active: keepActive \} : \{\}\)/);
});

test("restricted resources come back only through the server, where it says there is room", () => {
  assert.match(restricted(), /const hasRoom = \(kind: RestrictedResource\["kind"\]\) => room\[kind\] === null \|\| \(room\[kind\] \?\? 0\) > 0;/);
  assert.match(restricted(), /\{canChange && hasRoom\(resource\.kind\) \? \(/);
  assert.match(page(), /const next = await reactivateResources\(/);
  assert.match(client(), /\/resource-access\/reactivate\//);
  // A restricted property stops offering what the API would refuse.
  assert.match(
    code(read("web/app/record/property/page.tsx")),
    /const canAddUnit = \(property\.capabilities\.private_inventory\?\.allowed \?\? false\) && !restricted;/,
  );
});

test("a plan nobody pays for shows no billing cycle and no empty payment rows", () => {
  assert.match(records(), /const paid = subscription\?\.is_live && subscription\.funding === "paid";/);
  assert.match(records(), /\{paid && subscription \? \(/);
  assert.doesNotMatch(screens(), /Next payment: —/);
});

test("payments come from server invoices, and receipts are the frozen documents", () => {
  assert.match(records(), /const records = billing\.viewer\.can_view_invoices \? billing\.invoices : \[\];/);
  assert.match(records(), /const blob = await getPaymentReceiptDocument\(receiptId\);/);
  // Staff write billing event reasons for the audit trail, not for customers.
  assert.doesNotMatch(records(), /\.reason\b/);
  assert.doesNotMatch(presentation(), /event\.reason/);
});

test("the current plan is unmistakable and is never offered as a purchase", () => {
  assert.match(dialog(), /\{option\.isCurrent \? \(\s*<span className="billing-option-flag" data-kind="current">/);
  assert.match(presentation(), /if \(isCurrent && billing\.renewal\.available\) action = \{ kind: "renew"/);
  assert.match(presentation(), /recommended: catalogue\.recommended_plan === plan\.code && rank > currentRank,/);
});

test("unlimited capacity is a word, never a large number", () => {
  assert.match(presentation(), /if \(count === null\) return `Unlimited \$\{noun\}`;/);
  assert.doesNotMatch(screens(), /999999/);
});

test("nothing in the chooser moves when its content changes", () => {
  const styles = css();
  // Every plan card keeps its second price line in both cycles — rendered on its
  // own line, unconditionally, as the price's last child…
  assert.match(dialog(), /\n\s*<small>\{priceNote\(plan, interval\)\}<\/small>\s*<\/p>/);
  // …the dialog body keeps room for its scrollbar whether or not it shows…
  assert.match(styles, /\.billing-dialog-body \{[^}]*scrollbar-gutter: stable;/);
  // …and the dialog grows from the top instead of re-centring.
  assert.match(styles, /margin: var\(--billing-dialog-inset\) auto auto;/);
  // The page itself keeps the scrollbar's width when a dialog locks its scroll.
  assert.match(read("web/app/globals.css"), /html \{[^}]*scrollbar-gutter: stable;/);
});

test("the chooser is a bottom sheet on small screens and every motion respects reduced motion", () => {
  const styles = css();
  assert.match(styles, /@media \(max-width: 640px\) \{[\s\S]*?\.billing-dialog \{[\s\S]*?margin: auto 0 0;/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.settings-panel:has\(> \.billing-page\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.billing-spinner \{ animation: none;/);
  // Only real tokens: an undefined custom property silently drops the rule.
  assert.doesNotMatch(styles, /var\(--space-7\)/);
});
