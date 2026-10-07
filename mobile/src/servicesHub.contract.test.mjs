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
  assert.deepEqual(order, ["Home", "Explore", "Services", "Payments", "Menu"]);

  // Saved is a pushed screen rather than a hidden tab, and both ways in say so.
  assert.doesNotMatch(layout, /name="saved"/);
  assert.match(
    read("src/components/nav/ExploreHeaderActions.tsx"),
    /router\.push\("\/\(app\)\/saved" as never\)/,
  );
  assert.match(
    read("app/(app)/(tabs)/profile.tsx"),
    /const go = \(path: string\) => \(\) => router\.push\(path as never\);[\s\S]*onPress: go\("\/\(app\)\/saved"\)/,
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
  assert.match(screen, /CATEGORIES\.filter\(\(category\) => group\.categories\.includes\(category\.id\)\)\.flatMap\(\(category\) => servicesIn\(category\.id\)\)/);
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
 * The page, redesigned (owner, 2026-10-06): a carousel of the services that
 * open, then the range as small square cards three to a row and centred, in
 * two groups and no more.
 */

const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  const stop = source.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, `${end} is missing after ${start}`);
  return source.slice(at, stop);
};

test("the range is two groups of small cards, three to a row and centred", () => {
  const screen = code(hub());

  // The hub ground More stands on, and cards rather than ruled rows in surfaces.
  assert.match(screen, /import \{ IndexPage \} from "@\/components\/account\/IndexRows";/);
  assert.match(screen, /return \(\s*<IndexPage>/);
  assert.doesNotMatch(screen, /<Surface|function ServiceRow/);
  assert.match(screen, /\{services\.map\(\(service\) => \(\s*<ServiceTile/);

  // Two groups, never more, and every category in exactly one of them.
  const groups = between(screen, "const GROUPS", "];");
  const titles = [...groups.matchAll(/title: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(titles, ["Bills and top-ups", "Around your home"]);
  const claimed = [...groups.matchAll(/"(utilities|entertainment|connectivity|home)"/g)].map((match) => match[1]);
  assert.deepEqual(claimed, ["utilities", "entertainment", "connectivity", "home"]);
  assert.match(screen, /\{GROUPS\.map\(\(group\) => \(\s*<Catalogue/);
  assert.match(screen, /<SectionTitle count=\{services\.length\}>\{title\}<\/SectionTitle>/);
  assert.doesNotMatch(code(catalogue()), /blurb/);

  // Three across any phone, and a short last row sits in the middle.
  assert.match(screen, /const tileWidth = Math\.floor\(\(width - density\.pagePadding \* 2 - TILE_GAP \* 2\) \/ 3\);/);
  assert.match(screen, /grid: \{\s*flexDirection: "row",\s*flexWrap: "wrap",\s*justifyContent: "center",\s*gap: TILE_GAP,\s*\}/);

  // A rounded square with the art in the middle and the name under it.
  const tile = between(screen, "function ServiceTile(", "function MoreServices(");
  const shape = between(tile, "const shape = {", "};");
  assert.match(shape, /aspectRatio: 1,/);
  assert.doesNotMatch(shape, /minHeight/);
  assert.match(between(screen, "  tile: {", "  tileName: {"), /alignItems: "center",\s*justifyContent: "center",/);
  assert.match(between(screen, "  tileName: {", "  corner: {"), /textAlign: "center",/);
  // What a service is, is read rather than printed on a card this small.
  assert.doesNotMatch(tile, />\s*\{service\.summary\}\s*</);
  assert.doesNotMatch(screen, />\s*Coming later\s*</);
  assert.match(screen, /accessibilityLabel=\{`\$\{service\.label\}\. \$\{service\.summary\}\. Coming later\.`\}/);
});

test("the page opens on a carousel of what opens, and no slide takes money", () => {
  const screen = code(hub());
  const carousel = between(screen, "function Carousel(", "function Slide(");

  // Every service that opens has a slide, the household's own leads, and a
  // \`later\` service never has one.
  assert.match(screen, /const openable = openableServices\(\);/);
  assert.match(screen, /const mine = openable\.find\(\(service\) => service\.id === saved\[0\]\?\.serviceId\);/);
  assert.match(screen, /services=\{featured\}/);

  // A slide is the catalogue's own words, so a new service brings its slide.
  assert.match(carousel, /eyebrow=\{service\.label\}\s+title=\{service\.summary\}\s+body=\{service\.promise\}/);
  // Its one act is what can be done today: save the number, or open the screen.
  assert.match(carousel, /act=\{service\.identifier \? `Save \$\{service\.identifier\.label\.toLowerCase\(\)\}` : `Open \$\{service\.label\}`\}/);
  assert.match(screen, /service\.route\s*\?\s*router\.push\(service\.route as never\)/);
  assert.doesNotMatch(carousel, /act="(Pay|Buy|Top up|Recharge|Renew)/);
  assert.match(carousel, /Nothing is charged yet\./);

  // It swipes and snaps a slide at a time, the next one peeking in, and the
  // dots say where you are without being read out.
  assert.match(carousel, /snapToInterval=\{slideWidth \+ SLIDE_GAP\}/);
  assert.match(carousel, /const slideWidth = Math\.round\(\(width - density\.pagePadding \* 2\) \* \(width < 360 \? NARROW_SLIDE_SHARE : SLIDE_SHARE\)\);/);

  // Short white cards like the rest of the page (revised on review: full-colour
  // slides were too big and too loud). Colour stays on the art's tile and the act.
  const slideBody = between(screen, "function Slide(", "function Strip(");
  assert.match(slideBody, /style=\{\[styles\.slide, styles\.card\]\}/);
  assert.match(slideBody, /<View style=\{\[styles\.slideArt, \{ backgroundColor: tone\.wash \}\]\}>\{art\}<\/View>/);
  assert.match(slideBody, /style=\{\[styles\.slideActText, \{ color: tone\.ink \}\]\}/);
  assert.match(carousel, /tone=\{TONE\[service\.tone\]\}/);
  assert.doesNotMatch(screen, /const SLIDE:|backgroundColor: ground/);
  assert.match(between(screen, "  slide: {", "  slideArt: {"), /flexGrow: 1,[\s\S]*flexDirection: "row",/);
  assert.match(carousel, /<View style=\{styles\.dots\} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">/);
  // Each slide is one control that says its place, not a button inside a button.
  const slide = between(screen, "function Slide(", "function Strip(");
  assert.match(slide, /accessibilityLabel=\{`\$\{eyebrow\}\. \$\{title\}\. \$\{body\} \$\{act\}\. \$\{position\}\.`\}/);
  assert.match(slide, /<PressableScale/);
  assert.doesNotMatch(slide, /<Pressable\b/);

  // And the rent is pointed to from the last slide, not repeated.
  assert.match(screen, /onRent=\{\(\) => router\.push\("\/\(app\)\/\(tabs\)\/payments" as never\)\}/);
  assert.match(carousel, /act="Go to Payments"/);
  assert.doesNotMatch(screen, /<BottomSheet|function StartPanel|function RentRow/);
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
    /<View style=\{\[styles\.corner, styles\.saved, \{ backgroundColor: tone\.wash \}\]\}>\s*<Ionicons name="checkmark-circle" size=\{12\} color=\{tone\.ink\} \/>/,
  );
  assert.match(tile, /\$\{savedCount\} saved\./);

  // One that does not: the same card, drained art, a quieter name and a clock.
  assert.match(tile, /later \? \(\s*<View style=\{\[styles\.corner, styles\.clock\]\}>\s*<Ionicons name="time-outline"/);
  assert.match(tile, /color: later \? CLOSED : INK \}/);
  assert.match(screen, /style=\{\[styles\.tile, styles\.card, shape\]\}/);

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
  assert.match(screen, /frame=\{\[styles\.lift, \{ width, borderRadius: shape\.borderRadius \}\]\}/);
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

  // A slide's act is its service's ink on the white card.
  for (const [, name, inkFamily, inkStep] of [...glyph.matchAll(/(\w+): \{ ink: theme\.color\.(\w+)\["(\d+)"\]/g)]) {
    assert.ok(contrast(token(inkFamily, inkStep), paper) >= 4.5, `${name}: a slide's act on white`);
  }

  // A saved count is its colour's ink on its colour's wash, and every colour a
  // service can take keeps that at 4.5:1.
  const tones = [...glyph.matchAll(/(\w+): \{ ink: theme\.color\.(\w+)\["(\d+)"\], wash: theme\.color\.(\w+)\["(\d+)"\] \}/g)];
  assert.ok(tones.length >= 5, "the tone families were not found");
  for (const [, name, inkFamily, inkStep, washFamily, washStep] of tones) {
    assert.ok(contrast(token(inkFamily, inkStep), token(washFamily, washStep)) >= 4.5, `${name}: a count on its wash`);
  }
});
