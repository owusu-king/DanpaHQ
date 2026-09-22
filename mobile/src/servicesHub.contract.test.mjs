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
 * The tile hub (product owner review, 2026-09-15): ruled rows read as a settings
 * list and the sentences around them repeated what the glyphs already said. The
 * catalogue is glass tiles, two to a row, and the page carries as few words as it
 * can while a screen reader still hears everything.
 */

const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  const stop = source.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, `${end} is missing after ${start}`);
  return source.slice(at, stop);
};

test("the catalogue is tiles, two to a row, under nothing but a category's name", () => {
  const screen = code(hub());

  // The hub ground More stands on, and tiles rather than ruled rows in surfaces.
  assert.match(screen, /import \{ IndexPage \} from "@\/components\/account\/IndexRows";/);
  assert.match(screen, /return \(\s*<IndexPage>/);
  assert.doesNotMatch(screen, /<Surface|function ServiceRow|borderTopColor: theme\.color\.field\["200"\]/);
  assert.match(screen, /\{services\.map\(\(service\) => \(\s*<ServiceTile/);
  assert.match(screen, /const TILE_WIDTH = "48\.5%";/);
  assert.match(screen, /grid: \{\s*flexDirection: "row",\s*flexWrap: "wrap",\s*justifyContent: "space-between",\s*\}/);

  // Tiles in one row stand equally tall because only the pressable fills its
  // frame; a grid item that grew would eat the gap between the two.
  assert.match(screen, /style=\{\[styles\.tile, styles\.glass, styles\.fill, shape\]\}/);
  assert.doesNotMatch(between(screen, "  tile: {", "  fill: {"), /flexGrow/);

  // As few words as the page can manage: no introduction, a category is its
  // name, and a tile is its glyph and its name. The summary and "Coming later"
  // are read to a screen reader rather than printed.
  assert.doesNotMatch(screen, /paid for in one place/);
  assert.match(screen, /<SectionTitle>\{title\}<\/SectionTitle>/);
  assert.doesNotMatch(code(catalogue()), /blurb/);
  assert.doesNotMatch(screen, />\s*\{service\.summary\}\s*</);
  assert.doesNotMatch(screen, />\s*Coming later\s*</);
  assert.match(screen, /accessibilityLabel=\{`\$\{service\.label\}\. \$\{service\.summary\}\. Coming later\.`\}/);
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

test("a tile is glass in its service's colour when it opens, and drained when it does not", () => {
  const screen = code(hub());
  const tile = between(screen, "function ServiceTile(", "function Tint(");

  // A service that opens: its colour washed into a corner of the glass, and a
  // check with a count when numbers are saved for it.
  assert.match(tile, /const tone = TONE\[service\.tone\];/);
  assert.match(tile, /\{later \? null : <Tint colour=\{tone\.wash\} \/>\}/);
  assert.match(tile, /<ServiceGlyph service=\{service\} size=\{[^}]+\} muted=\{later\} \/>/);
  assert.match(
    tile,
    /<View style=\{\[styles\.saved, \{ backgroundColor: tone\.wash \}\]\}>\s*<Ionicons name="checkmark-circle" size=\{12\} color=\{tone\.ink\} \/>/,
  );
  assert.match(tile, /\$\{savedCount\} saved\./);

  // One that does not: thinner glass, a drained glyph and a clock.
  assert.match(tile, /later \? \(\s*<Ionicons name="time-outline"/);
  assert.match(screen, /tileLater: \{\s*backgroundColor: GLASS_LATER,\s*borderColor: EDGE_LATER,/);
  assert.match(screen, /style=\{\[styles\.tile, styles\.tileLater, shape, \{ width: TILE_WIDTH \}\]\}/);
  const glass = Number(/const GLASS = alpha\(WHITE, ([\d.]+)\);/.exec(screen)?.[1]);
  const thinner = Number(/const GLASS_LATER = alpha\(WHITE, ([\d.]+)\);/.exec(screen)?.[1]);
  assert.ok(thinner < glass, `a closed service's glass is thinner than an open one's: ${thinner} vs ${glass}`);

  // The wash is gone before the far corner, takes no touches, and is silent.
  const tint = between(screen, "function Tint(", "function MoreServices(");
  assert.match(tint, /<Stop offset="0" stopColor=\{colour\} stopOpacity=\{TINT_OPACITY\} \/>\s*<Stop offset="0\.62" stopColor=\{colour\} stopOpacity=\{0\} \/>/);
  assert.match(tint, /pointerEvents="none"\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/);
  assert.match(tint, /const id = `tint\$\{useId\(\)\.replace\(\/\[\^a-zA-Z0-9\]\/g, ""\)\}`;/);

  // A whisper of shadow, and none on Android, where elevation smudges through glass.
  assert.match(screen, /lift: isAndroid\s*\? \{\}\s*: \{[^}]*shadowOpacity: 0\.05,/);
});

test("the words left on the page read on the glass they stand on", () => {
  const tokens = JSON.parse(read("../packages/design-tokens/tokens.json"));
  const screen = code(hub());
  const rows = code(read("src/components/account/IndexRows.tsx"));
  const glyph = code(read("src/components/services/ServiceGlyph.tsx"));

  const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  const token = (family, step) => channels(tokens.color[family][step].value);
  const mix = (base, over, amount) => base.map((value, index) => value + (over[index] - value) * amount);
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
  const number = (source, pattern) => Number(pattern.exec(source)?.[1]);

  // The deepest the hub ground gets, just under the header.
  const kola = token("kola", "600");
  const white = token("field", "0");
  const ink = token("ink", "900");
  const ground = mix(
    mix(token("field", "50"), kola, number(rows, /const FLOOR_OPACITY = ([\d.]+);/)),
    kola,
    number(rows, /const AURA_OPACITY = ([\d.]+);/),
  );
  const glass = mix(ground, white, number(screen, /const GLASS = alpha\(WHITE, ([\d.]+)\);/));
  const thinner = mix(ground, white, number(screen, /const GLASS_LATER = alpha\(WHITE, ([\d.]+)\);/));
  const summary = number(screen, /const SUMMARY = alpha\(INK, ([\d.]+)\);/);
  const faint = number(screen, /const FAINT = alpha\(INK, ([\d.]+)\);/);

  assert.ok(contrast(ink, ground) >= 12, "a section's name on the ground");
  assert.ok(contrast(ink, glass) >= 12, "a service's name on glass");
  assert.ok(contrast(mix(glass, ink, summary), glass) >= 4.5, "a saved number's nickname on glass");
  assert.ok(contrast(mix(thinner, ink, summary), thinner) >= 4.5, "a closed service's name on thinner glass");
  assert.ok(contrast(mix(thinner, ink, faint), thinner) >= 3, "the clock on a closed service");

  // A saved count is its colour's ink on its colour's wash, and every colour a
  // service can take keeps that at 4.5:1.
  const tones = [...glyph.matchAll(/(\w+): \{ ink: theme\.color\.(\w+)\["(\d+)"\], wash: theme\.color\.(\w+)\["(\d+)"\] \}/g)];
  assert.ok(tones.length >= 5, "the tone families were not found");
  for (const [, name, inkFamily, inkStep, washFamily, washStep] of tones) {
    assert.ok(contrast(token(inkFamily, inkStep), token(washFamily, washStep)) >= 4.5, `${name}: a count on its wash`);
  }
});
