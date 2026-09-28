/**
 * The ground the two Homes stand on.
 *
 * It was a warm stone, which under the kola header read as a second, duller
 * brand, with cream cards a shade of the same beige. The product owner asked for
 * a very soft, desaturated version of Rooomly's green — tonal, faintly glassy,
 * light enough to read on — with cards that lift by tone rather than by heavy
 * shadows or borders, and without turning the whole interface green.
 *
 * Colours here are computed from the design tokens with the same arithmetic the
 * phone uses, so "soft", "readable" and "lifts" are measured, not described.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const tokens = JSON.parse(readFileSync(new URL("../../packages/design-tokens/tokens.json", import.meta.url), "utf8"));

const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
/** `softened` from plinth.tsx: kola-600 let down into field-50 by `amount`. */
const softened = (amount) => {
  const green = channels(tokens.color.kola["600"].value);
  return channels(tokens.color.field["50"].value).map((value, index) => Math.round(value + (green[index] - value) * amount));
};
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
/** An `rgba(…)` colour composited over an opaque ground. */
const over = (rgba, ground) => {
  const [r, g, b, alpha] = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/).slice(1).map(Number);
  return [r, g, b].map((value, index) => value * alpha + ground[index] * (1 - alpha));
};
const saturation = (rgb) => {
  const max = Math.max(...rgb) / 255;
  const min = Math.min(...rgb) / 255;
  return max === min ? 0 : (max - min) / (1 - Math.abs(max + min - 1));
};
const plinth = () => code(read("src/components/home/plinth.tsx"));
const amounts = (source) => Object.fromEntries(
  [...source.matchAll(/(groundTop|ground|groundLow): softened\(([\d.]+)\),/g)].map((match) => [match[1], Number(match[2])]),
);
const colour = (source, name) => source.match(new RegExp(`${name}: "([^"]+)"`))[1];

test("the ground is Rooomly's green let down into the ivory: soft, desaturated, never raw", () => {
  const source = plinth();

  // Derived from the two tokens rather than typed in, so it follows the brand.
  assert.match(source, /const green = theme\.color\.kola\["600"\];/);
  assert.match(source, /const ivory = theme\.color\.field\["50"\];/);

  const { groundTop, ground, groundLow } = amounts(source);
  assert.ok(groundTop > ground && ground > groundLow, "the tone lightens down the page");
  for (const amount of [groundTop, ground, groundLow]) {
    assert.ok(amount >= 0.04 && amount <= 0.16, `a tone, not a colour: ${amount} of kola`);
    assert.ok(saturation(softened(amount)) <= 0.2, `desaturated: ${amount} of kola`);
  }
  assert.doesNotMatch(source, /stone/);
});

test("type reads comfortably on the ground, and cards lift from it by tone", () => {
  const source = plinth();
  const top = softened(amounts(source).groundTop);

  // Measured on the deepest part of the ground, the hardest place to read.
  assert.ok(contrast(channels(colour(source, "ink")), top) >= 12, "headings on the ground");
  assert.ok(contrast(over(colour(source, "ink70"), top), top) >= 4.5, "eyebrows on the ground");

  // White paper, a hairline edge in the ground's own green, a whisper of shadow.
  assert.match(source, /paper: theme\.color\.field\["0"\],/);
  assert.ok(contrast([255, 255, 255], top) >= 1.25, "a card is visibly lighter than the ground");
  assert.match(source, /export const surface = \{[^}]*borderWidth: StyleSheet\.hairlineWidth,[^}]*borderColor: ph\.edge,/);
  assert.match(source, /shadowColor: theme\.color\.kola\["900"\],/);
  for (const [, opacity] of source.matchAll(/shadowOpacity: ([\d.]+)/g)) {
    assert.ok(Number(opacity) <= 0.08, `no heavy shadow: ${opacity}`);
  }
  for (const [, elevation] of source.matchAll(/elevation: (\d+)/g)) {
    assert.ok(Number(elevation) <= 2, `no heavy Android shadow: ${elevation}`);
  }
  // Inside a card the quiet fill stays warm and neutral: the green is the ground's.
  assert.match(source, /paperDim: theme\.color\.field\["100"\],/);
});

test("the ground is tonal and faintly glassy, and never takes a touch", () => {
  const ground = code(read("src/components/home/HomeGround.tsx"));

  assert.match(ground, /<LinearGradient id=\{`\$\{id\}tone`\} x1="0" y1="0" x2="0" y2="1">/);
  assert.match(
    ground,
    /<Stop offset="0" stopColor=\{ph\.groundTop\} \/>\s*<Stop offset="0\.55" stopColor=\{ph\.ground\} \/>\s*<Stop offset="1" stopColor=\{ph\.groundLow\} \/>/,
  );
  const sheen = Number(ground.match(/const SHEEN_OPACITY = ([\d.]+);/)[1]);
  const depth = Number(ground.match(/const DEPTH_OPACITY = ([\d.]+);/)[1]);
  assert.ok(sheen > 0 && sheen <= 0.5, "a breath of light, not a glare");
  assert.ok(depth > 0 && depth <= 0.08, "a pool of green, not a stain");
  assert.match(ground, /fill=\{`url\(#\$\{id\}tone\)`\}/);
  assert.match(ground, /fill=\{`url\(#\$\{id\}depth\)`\}/);
  assert.match(ground, /fill=\{`url\(#\$\{id\}sheen\)`\}/);

  // Behind the content, never in its way, and silent to a screen reader.
  assert.match(ground, /pointerEvents="none"\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/);
  // One gradient id per mount, so two grounds in one web document never collide.
  assert.match(ground, /const id = `ground\$\{useId\(\)\.replace\(\/\[\^a-zA-Z0-9\]\/g, ""\)\}`;/);
  // It paints, full stop. `active` existed so the tenant's signed-out Home
  // could hold the same tree unpainted while it was a wall of listing cards;
  // those moved to Explore, both Homes paint in every state, and nothing passed
  // the prop any more.
  assert.match(ground, /style=\{\[styles\.fill, styles\.painted\]\}/);
  assert.doesNotMatch(ground, /active/);
});

test("both Homes stand on it in every state, and every other tab keeps the ivory", () => {
  const provider = code(read("app/(app)/(provider-tabs)/index.tsx"));
  const tenant = code(read("app/(app)/(tabs)/index.tsx"));

  // The provider's first Property, skeleton and Portfolio are all inside one ground.
  assert.match(provider, /export default function ProviderHomeScreen\(\) \{\s*return \(\s*<HomeGround>\s*<ProviderHome \/>\s*<\/HomeGround>/);
  // The tenant's Home stands on it in both states, exactly like the provider's.
  assert.match(tenant, /<HomeGround>\s*<DiscoveryHome \/>\s*<\/HomeGround>/);
  // And it lists nothing: Explore is the tab with the catalogue, the search
  // field, the filters and the map. Home showing the first six was a worse copy.
  assert.doesNotMatch(tenant, /ListingCard|searchListings|FlatList/);
  // No scroller paints over the ground, and the stone is gone.
  for (const source of [provider, tenant]) {
    assert.doesNotMatch(source, /ph\.stone|backgroundColor: ph\.ground/);
  }

  // The scene under each Home is the same tone, so changing tab never flashes.
  assert.match(code(read("src/shell.ts")), /dashboard: ph\.ground,/);
  const providerTabs = code(read("app/(app)/(provider-tabs)/_layout.tsx"));
  const renterTabs = code(read("app/(app)/(tabs)/_layout.tsx"));
  for (const layout of [providerTabs, renterTabs]) {
    assert.match(layout, /name="index" options=\{\{[^\n]*sceneStyle: \{ backgroundColor: shell\.dashboard \}/);
  }
  for (const layout of [providerTabs, renterTabs]) {
    assert.match(layout, /sceneStyle: \{ backgroundColor: shell\.canvas \}/);
  }
});

test("what sits on the ground reads clearly, and what leads onward is glass", () => {
  const source = plinth();
  const top = softened(amounts(source).groundTop);
  const shortcuts = code(read("src/components/home/HomeShortcuts.tsx"));

  // Shortcuts are frosted glass rather than more white cards, and still legible.
  assert.match(shortcuts, /borderColor: ph\.glassEdge,\s*backgroundColor: ph\.glass,/);
  const glass = over(colour(source, "glass"), top);
  assert.ok(contrast(over(colour(source, "ink70"), glass), glass) >= 4.5, "a shortcut's name on glass");

  // The eyebrows standing on the ground, not on a card, are set dark enough to read.
  assert.match(shortcuts, /lineHeight: 14, color: ph\.ink70 \}/);
  for (const path of ["src/components/home/TenantHome.tsx", "app/(app)/(provider-tabs)/index.tsx"]) {
    const screen = code(read(path));
    assert.match(screen, /fontSize: density\.labelSize, lineHeight: 14, color: ph\.ink70 \}/, path);
    assert.doesNotMatch(screen, /fontSize: density\.labelSize, lineHeight: 14, color: ph\.ink38/, path);
  }
});
