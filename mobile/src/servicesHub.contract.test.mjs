/**
 * The tenant Services hub.
 *
 * Two rules hold this screen up, and both are about honesty.
 *
 * **Nothing may claim to sell what cannot be sold.** No biller is integrated
 * anywhere in `backend/apps`, and `apps.payments` still registers no production
 * adapter — `create_intent` refuses before writing a row when one is missing.
 * So the hub offers no purchase, and the catalogue may not mark a service
 * `available` without a route behind it.
 *
 * **Nothing may be a control that rejects you.** A service that is not open is
 * either something you can genuinely prepare for — save the meter number, so
 * the day it opens buying is one tap — or it is not a control at all. A
 * disabled button that answers a tap with nothing teaches people the screen is
 * broken.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const hub = () => read("app/(app)/(tabs)/services.tsx");
const detail = () => read("app/(app)/service.tsx");
const catalogue = () => read("src/serviceCatalogue.ts");
const accounts = () => read("src/serviceAccounts.ts");

test("Services is a primary tab and Saved kept every way it was reached", () => {
  const layout = read("app/(app)/(tabs)/_layout.tsx");
  const order = [...layout.matchAll(/name="([a-z]+)"[^\n]*tabBarLabel: "([A-Za-z]+)"/g)].map(
    (match) => match[2],
  );
  assert.deepEqual(order, ["Home", "Explore", "Services", "Payments", "More"]);

  // The route stays registered, so every existing push to it still resolves.
  assert.match(layout, /name="saved" options=\{\{ href: null \}\}/);
  assert.match(
    read("src/components/nav/ExploreHeaderActions.tsx"),
    /router\.push\("\/\(app\)\/\(tabs\)\/saved" as never\)/,
  );
  assert.match(
    read("app/(app)/(tabs)/profile.tsx"),
    /router\.push\("\/\(app\)\/\(tabs\)\/saved" as never\)/,
  );
});

test("nothing on the hub offers to take money", () => {
  // Re-checked upstream, so the day a real adapter lands this test is where the
  // conversation starts rather than something noticing months later.
  const providers = read("../backend/apps/payments/providers.py");
  const settings = read("../backend/config/settings/production.py");
  assert.match(providers, /_PROVIDERS = \{"memory": MemoryPaymentProvider, "paystack": _paystack\}/);
  assert.match(settings, /PAYMENT_BACKEND = env\("PAYMENT_BACKEND", ""\)/);

  // The invariant is that nothing *offers* the action. Explaining how paying
  // will work when a biller lands is the opposite of a false promise, so this
  // matches call-to-action shapes rather than the word "checkout" in prose.
  for (const source of [code(hub()), code(detail())]) {
    assert.doesNotMatch(source, /label=\{?["`](Pay|Buy|Top up|Recharge|Renew)/i);
    assert.doesNotMatch(source, /Pay now|Buy now|Top up now|Purchase now|Proceed to pay/i);
  }
});

test("the categories are the ones a household thinks in, in order", () => {
  const source = catalogue();
  const order = [...source.matchAll(/\{ id: "([a-z]+)", label: "([A-Za-z]+)"/g)].map((m) => m[2]);
  assert.deepEqual(order, ["Utilities", "Entertainment", "Connectivity", "Home"]);

  // The hub renders from the declaration rather than listing services itself,
  // so next quarter's service is one entry there and no change here.
  const screen = code(hub());
  assert.match(screen, /CATEGORIES\.map/);
  assert.match(screen, /servicesIn\(category\.id\)/);
  for (const label of ["Electricity", "DStv", "GOtv", "Airtime", "Mobile data", "Cleaning"]) {
    assert.doesNotMatch(screen, new RegExp(`"${label}"`));
    assert.match(catalogue(), new RegExp(`label: "${label}"`));
  }
});

test("nothing is marked available without a route behind it", () => {
  const source = catalogue();
  const entries = [...source.matchAll(/\{\s*id: "([a-z]+)",[\s\S]*?\n  \},\n/g)].map((m) => m[0]);
  assert.ok(entries.length >= 9, `expected the catalogue, parsed ${entries.length}`);

  for (const entry of entries) {
    const id = /id: "([a-z]+)"/.exec(entry)?.[1];
    const available = /status: "available"/.test(entry);
    const hasRoute = /route: "/.test(entry);
    assert.equal(
      available,
      hasRoute,
      `${id}: "available" and a route must come together, not one without the other`,
    );
  }

  // No biller exists yet, so none of these may claim otherwise. If that
  // changes, this fails and asks whether the backend really landed.
  for (const id of ["electricity", "water", "dstv", "gotv", "airtime", "data"]) {
    const entry = entries.find((row) => row.includes(`id: "${id}"`));
    assert.ok(entry, `${id} missing from the catalogue`);
    assert.doesNotMatch(entry, /status: "available"/, `${id} claims to be available`);
  }
});

test("an unopened service is either preparable or not a control at all", () => {
  const screen = code(hub());
  // `later` is a row, never a Pressable, and never a disabled one.
  assert.match(screen, /if \(later\) \{\s*return \(\s*<View/);
  assert.match(screen, /Coming later/);
  assert.doesNotMatch(screen, /disabled=\{/);

  // `preparing` opens somewhere that has a real job: saving the number the
  // service will need. That is what makes it worth a tap today.
  assert.match(screen, /service\.status === "later" \? undefined :/);
  assert.match(screen, /pathname: "\/\(app\)\/service"/);
  assert.match(code(detail()), /saveDetail\(/);
  assert.match(read("app/(app)/_layout.tsx"), /name="service"/);
});

test("the page closes with more to come, quietly", () => {
  const screen = code(hub());
  assert.match(screen, /MORE SERVICES/);
  assert.match(screen, /Coming soon/);
  // One statement at the end of the catalogue, not a badge on every row.
  assert.equal((screen.match(/Coming soon/g) ?? []).length, 1);
});

test("a saved number is stored the way this app stores anything identifying", () => {
  const source = accounts();
  // Not AsyncStorage: phones in this market get lent to family, which is the
  // same reason the session token is in the Keychain. Checked against the code
  // rather than the file, because the module explains that choice in a comment.
  assert.match(source, /from "@\/secure"/);
  assert.doesNotMatch(code(source), /async-storage|AsyncStorage/);
  // Shown shortened, so a screen somebody else can see does not carry it whole.
  assert.match(source, /export function maskDetail/);
  assert.match(source, /slice\(-4\)/);
});

test("purchase history is the platform's record, not the device's", () => {
  const source = accounts();
  // A locally-kept list beside server receipts and allocations would be a
  // second version of the truth that nobody reconciles.
  const history = /export async function listRecentPurchases[\s\S]*?\n\}/.exec(source)?.[0] ?? "";
  assert.ok(history, "listRecentPurchases not found");
  assert.doesNotMatch(history, /secure\.get|read\(\)/);
  assert.match(history, /return \[\];/);
  // And the hub renders nothing rather than an empty heading.
  assert.match(code(hub()), /recent\.length \? <RecentActivity/);
});

test("services will settle through the Payments Core, not their own checkout", () => {
  assert.match(catalogue(), /SETTLEMENT_ROUTE = "payments_core"/);
  assert.match(catalogue(), /PAYMENT_ARCHITECTURE\.md/);

  // The rule that matters is structural, not a sentence: a service screen adds
  // an obligation and nothing else. It must never grow its own provider
  // reference, intent status or transaction — a second payment path would have
  // no allocation, no ledger and no reconciliation behind it while looking,
  // from a tenant's side, exactly the same.
  for (const source of [code(hub()), code(detail())]) {
    assert.doesNotMatch(source, /provider_reference|provider_transaction_id/);
    assert.doesNotMatch(source, /createPaymentIntent|process_webhook|LedgerEntry/);
  }
});

test("colour sorts the list, and is drained rather than swapped when closed", () => {
  const glyph = code(read("src/components/services/ServiceGlyph.tsx"));
  // Every tone resolves to real palette families, so a new one cannot be typed
  // in as a hex value.
  assert.match(glyph, /harmattan: \{ ink: theme\.color\.harmattan/);
  assert.match(glyph, /lagoon: \{ ink: theme\.color\.lagoon/);
  assert.match(glyph, /laterite: \{ ink: theme\.color\.laterite/);
  assert.match(glyph, /kola: \{ ink: theme\.color\.kola/);
  // Same shape, same position, no colour. Nothing has to say "disabled".
  assert.match(glyph, /muted \? theme\.color\.field\["100"\] : tone\.wash/);
});

test("it presses like the tab bar, because it sits under it", () => {
  const screen = code(hub());

  // Both take the one spring from `src/motion.ts`. This used to parse `speed`
  // and `bounciness` out of each file and compare them, which was the strongest
  // check available while the numbers were transcribed and no check at all once
  // a third screen transcribed them too.
  assert.match(screen, /from "@\/motion"/);
  assert.doesNotMatch(screen, /speed:|bounciness:|stiffness:|damping:/);
  assert.match(screen, /withSpring\(toValue, pressSpring\)/);

  // And Reduce Motion is still answered by keeping the feedback and dropping
  // the movement, not by dropping both. It is answered on the UI thread now —
  // `press` carries `ReduceMotion.System`, so the scale still reaches its
  // pressed value and simply does not travel to get there. The screen no longer
  // subscribes to the setting itself only to skip to the same end value.
  const motion = code(read("src/motion.ts"));
  assert.match(motion, /export const press: WithSpringConfig/);
  assert.match(motion, /reduceMotion: ReduceMotion\.System/);
});

test("loading has the shape of what is coming, and failure keeps the page", () => {
  const screen = code(hub());
  assert.match(screen, /QuickSkeleton/);
  assert.doesNotMatch(screen, /ActivityIndicator/);
  // Saved details are a convenience; losing them must not replace the
  // catalogue with an error.
  assert.match(screen, /tone="info"/);
  assert.doesNotMatch(screen, /if \(error\) return/);
});
