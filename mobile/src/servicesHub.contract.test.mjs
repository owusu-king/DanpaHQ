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

  // Saved is a pushed screen rather than a hidden tab, and both ways in say so.
  assert.doesNotMatch(layout, /name="saved"/);
  assert.match(
    read("src/components/nav/ExploreHeaderActions.tsx"),
    /router\.push\("\/\(app\)\/saved" as never\)/,
  );
  assert.match(
    read("app/(app)/(tabs)/profile.tsx"),
    /router\.push\("\/\(app\)\/saved" as never\)/,
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
  assert.match(screen, /CATEGORIES\.flatMap/);
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
  const spring = (text) => ({
    speed: Number(/speed:\s*([\d.]+)/.exec(text)?.[1]),
    bounciness: Number(/bounciness:\s*([\d.]+)/.exec(text)?.[1]),
  });
  const here = spring(code(hub()));
  const bar = spring(code(read("src/components/nav/MainTabBar.tsx")));
  assert.ok(Number.isFinite(here.speed), "no spring found on the hub");
  assert.deepEqual(here, bar, "the hub and the tab bar must press alike");

  // And Reduce Motion is answered by keeping the feedback and dropping the
  // movement, not by dropping both.
  const screen = code(hub());
  assert.match(screen, /useReduceMotion\(\)/);
  assert.match(screen, /scale\.setValue\(toValue\)/);
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

/*
 * The offers page (product owner, 2026-09-27, after a banking app's loans tab):
 * one question and one way in at the top, a row to the rent, then every service
 * as a compact white card two to a row under a single heading — no group names,
 * because the colours already sort the range.
 */

const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  const stop = source.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, `${end} is missing after ${start}`);
  return source.slice(at, stop);
};

test("the range is one grid of cards, two to a row, under one heading and no group names", () => {
  const screen = code(hub());

  // The hub ground More stands on, and cards rather than ruled rows in surfaces.
  assert.match(screen, /import \{ IndexPage \} from "@\/components\/account\/IndexRows";/);
  assert.match(screen, /return \(\s*<IndexPage>/);
  assert.doesNotMatch(screen, /<Surface|function ServiceRow|borderTopColor: theme\.color\.field\["200"\]/);
  assert.match(screen, /\{services\.map\(\(service\) => \(\s*<ServiceTile/);
  assert.match(screen, /const TILE_WIDTH = "48\.5%";/);
  assert.match(screen, /grid: \{\s*flexDirection: "row",\s*flexWrap: "wrap",\s*justifyContent: "space-between",\s*\}/);

  // Still in the order a household thinks in, and still from the declaration —
  // but flattened into one grid, with no category's name printed over it.
  assert.match(screen, /services=\{CATEGORIES\.flatMap\(\(category\) => servicesIn\(category\.id\)\)\}/);
  assert.match(screen, /<SectionTitle>Explore our range of offers<\/SectionTitle>/);
  assert.doesNotMatch(screen, /\{category\.label\}|title=\{category\.label\}|function CategoryBlock/);
  assert.doesNotMatch(screen, /paid for in one place/);
  assert.doesNotMatch(code(catalogue()), /blurb/);

  // Cards in one row stand equally tall because only the pressable fills its
  // frame; a grid item that grew would eat the gap between the two.
  assert.match(screen, /style=\{\[styles\.tile, styles\.card, styles\.fill, shape\]\}/);
  assert.doesNotMatch(between(screen, "  tile: {", "  fill: {"), /flexGrow/);

  // A rounded square, never wider than it is tall, with no height of its own
  // to grow past that.
  const tile = between(screen, "function ServiceTile(", "function MoreServices(");
  const shape = between(tile, "const shape = {", "};");
  assert.match(shape, /aspectRatio: 1,/);
  assert.doesNotMatch(shape, /minHeight/);

  // Art and badge along the top, name and one short line at the foot, and the
  // space between them is the card's own. "Coming later" is read, not printed.
  assert.match(tile, /<View style=\{styles\.tileTop\}>\s*<ServiceArt/);
  assert.match(between(screen, "  tile: {", "  fill: {"), /justifyContent: "space-between",/);
  assert.match(tile, /numberOfLines=\{2\}[\s\S]*?>\s*\{service\.summary\}\s*</);
  assert.doesNotMatch(screen, />\s*Coming later\s*</);
  assert.match(screen, /accessibilityLabel=\{`\$\{service\.label\}\. \$\{service\.summary\}\. Coming later\.`\}/);
});

test("the page opens on one question and one way in, and neither takes money", () => {
  const screen = code(hub());
  const panel = between(screen, "function StartPanel(", "function ServicePicker(");
  const picker = between(screen, "function ServicePicker(", "function RentRow(");

  // The picker only ever holds a service that opens and is bought against an
  // account number; `later` is not a choice, and neither is Maintenance, which
  // opens from its own tile onto its own screen.
  assert.match(screen, /const openable = purchasableServices\(\);/);
  assert.match(catalogue(), /return openableServices\(\)\.filter\(\(service\) => Boolean\(service\.identifier\)\);/);
  assert.match(screen, /service\.route\s*\?\s*router\.push\(service\.route as never\)/);
  assert.match(screen, /services=\{openable\}/);
  assert.match(screen, /openable\.find\(\(service\) => service\.id === saved\[0\]\?\.serviceId\)/);
  assert.match(picker, /<BottomSheet visible=\{visible\}/);
  assert.match(picker, /accessibilityRole="radio"/);

  // The button goes to the chosen service's own screen and is named for that,
  // not for a purchase. The line under it says nothing is charged.
  assert.match(screen, /onContinue=\{\(\) => openService\(chosen\)\}/);
  assert.match(panel, />Continue<\/Type>/);
  assert.match(panel, /accessibilityLabel=\{`Continue to \$\{service\.label\}`\}/);
  assert.match(panel, /Nothing<\/Type> is charged/);
  assert.doesNotMatch(panel, /\b(Pay|Buy|Top up|Recharge|Renew)\b/);

  // It leads without weighing the page down: a kola tint with deep kola words,
  // not a solid slab with a glow under it.
  assert.match(screen, /const ACTION_WASH = theme\.color\.kola\["50"\];/);
  assert.match(screen, /const ACTION_INK = theme\.color\.kola\["800"\];/);
  assert.match(between(screen, "  action: {", "  actionText: {"), /backgroundColor: ACTION_WASH,/);
  assert.doesNotMatch(screen, /actionLift|backgroundColor: ACTION,/);

  // And the rent is pointed to, not repeated.
  assert.match(screen, /<RentRow onPress=\{\(\) => router\.push\("\/\(app\)\/\(tabs\)\/payments" as never\)\} \/>/);
});

test("Referrals joins Home, and says honestly that it is not open", () => {
  const source = catalogue();
  const entries = [...source.matchAll(/\{\s*id: "([a-z]+)",[\s\S]*?\n  \},\n/g)];
  const entry = entries.find((match) => match[1] === "referrals")?.[0] ?? "";
  assert.ok(entry, "Referrals is missing from the catalogue");
  assert.match(entry, /label: "Referrals",/);

  // Nothing in the backend refers anybody yet, so it is named for the roadmap and
  // is not a control: no route, nothing to save, never available.
  assert.match(entry, /status: "later",/);
  assert.doesNotMatch(entry, /route:|identifier:/);

  // It is Home's last service, and the hub renders it from the declaration.
  assert.deepEqual(
    entries.filter((match) => /category: "home",/.test(match[0])).map((match) => match[1]),
    ["maintenance", "cleaning", "moving", "referrals"],
  );
  assert.doesNotMatch(code(hub()), /"Referrals"/);
});

test("a card is in its service's colour when it opens, and drained when it does not", () => {
  const screen = code(hub());
  const tile = between(screen, "function ServiceTile(", "function MoreServices(");
  const art = code(read("src/components/services/ServiceArt.tsx"));

  // A service that opens: its illustration in its colours, and a check with a
  // count when numbers are saved for it.
  assert.match(tile, /const tone = TONE\[service\.tone\];/);
  assert.match(tile, /<ServiceArt\s+service=\{service\}\s+index=\{SERVICES\.indexOf\(service\)\}\s+width=\{[^}]+\}\s+muted=\{later\}\s+\/>/);
  assert.match(
    tile,
    /<View style=\{\[styles\.saved, \{ backgroundColor: tone\.wash \}\]\}>\s*<Ionicons name="checkmark-circle" size=\{12\} color=\{tone\.ink\} \/>/,
  );
  assert.match(tile, /\$\{savedCount\} saved\./);

  // One that does not: the same card, drained art, a quieter name and a clock.
  assert.match(tile, /later \? \(\s*<View style=\{styles\.clock\}>\s*<Ionicons name="time-outline"/);
  assert.match(tile, /color: later \? CLOSED : INK,/);
  assert.match(screen, /style=\{\[styles\.tile, styles\.card, shape, \{ width: TILE_WIDTH \}\]\}/);

  // The art is every tone's palette, drained to the neutrals when closed, and
  // silent to a screen reader because the card's label already says it all.
  for (const tone of ["harmattan", "lagoon", "laterite", "kola", "ink"]) {
    assert.match(art, new RegExp(`${tone}: \\{\\s*main: theme\\.color\\.`), `${tone} has no art colours`);
  }
  assert.match(art, /const colours = muted \? DRAINED : ART\[service\.tone\];/);
  assert.match(art, /main: theme\.color\.field\["300"\],/);
  assert.match(art, /pointerEvents="none"\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/);

  // A soft shadow on a frame that takes the card's corners, and none on
  // Android, where elevation under a rounded card draws a hard ring.
  assert.match(screen, /lift: isAndroid\s*\? \{\}\s*: \{[^}]*shadowOpacity: 0\.06,/);
  assert.match(screen, /frame=\{\[styles\.lift, \{ width: TILE_WIDTH, borderRadius: shape\.borderRadius \}\]\}/);
});

test("the words on the page read on the paper they stand on", () => {
  const tokens = JSON.parse(read("../packages/design-tokens/tokens.json"));
  const screen = code(hub());
  const glyph = code(read("src/components/services/ServiceGlyph.tsx"));

  const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const token = (family, step) => channels(tokens.color[family][step].value);
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((value) => {
      const unit = value / 255;
      return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const tokenOf = (name) => {
    const match = new RegExp(`const ${name} = theme\\.color\\.(\\w+)\\["(\\d+)"\\];`).exec(screen);
    assert.ok(match, `${name} is not a palette token`);
    return token(match[1], match[2]);
  };

  // Cards, the picker and the row are paper.
  assert.match(screen, /const CARD = WHITE;/);
  const paper = token("field", "0");
  assert.ok(contrast(tokenOf("INK"), paper) >= 12, "a service's name on a card");
  assert.ok(contrast(tokenOf("CLOSED"), paper) >= 7, "a closed service's name");
  assert.ok(contrast(tokenOf("SUMMARY"), paper) >= 4.5, "the line under a name");
  assert.ok(contrast(tokenOf("FAINT"), token("field", "100")) >= 3, "the clock on its well");

  // The button's words on its tint.
  assert.ok(contrast(tokenOf("ACTION_INK"), tokenOf("ACTION_WASH")) >= 4.5, "Continue on its tint");

  // A saved count is its colour's ink on its colour's wash, and every colour a
  // service can take keeps that at 4.5:1.
  const tones = [...glyph.matchAll(/(\w+): \{ ink: theme\.color\.(\w+)\["(\d+)"\], wash: theme\.color\.(\w+)\["(\d+)"\] \}/g)];
  assert.ok(tones.length >= 5, "the tone families were not found");
  for (const [, name, inkFamily, inkStep, washFamily, washStep] of tones) {
    assert.ok(contrast(token(inkFamily, inkStep), token(washFamily, washStep)) >= 4.5, `${name}: a count on its wash`);
  }
});
