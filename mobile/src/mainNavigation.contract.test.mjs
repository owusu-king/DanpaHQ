import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bar = read("src/components/nav/MainTabBar.tsx");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const renter = read("app/(app)/(tabs)/_layout.tsx");
const provider = read("app/(app)/(provider-tabs)/_layout.tsx");

test("both mobile worlds use one first-class navigation surface", () => {
  for (const layout of [renter, provider]) {
    assert.match(layout, /tabBar=\{\(props\) => <MainTabBar \{\.\.\.props\} \/>\}/);
  }
  assert.equal((renter.match(/<Tabs\.Screen/g) ?? []).length, 6);
  assert.equal((provider.match(/<Tabs\.Screen/g) ?? []).length, 6);
  // Saved is the renter's hidden-but-registered route now that Services took
  // its place in the bar. It keeps working because Explore's header and More
  // both push this exact href — a tab was never the only way to reach it.
  assert.match(renter, /name="saved" options=\{\{ href: null \}\}/);
  assert.match(provider, /name="add" options=\{\{ href: null \}\}/);
});

test("active navigation is stated by form, tone and type", () => {
  // One indicator, not two. The bar used to draw a 22x2 rule across the top of
  // the active cell *and* a lozenge behind its glyph — two "you are here" marks
  // four points apart, with the rule colliding with the shelf's own hairline
  // border directly above it. The lozenge is the stronger of the two and the
  // one that doubles as a touch affordance, so the rule went.
  assert.match(bar, /styles\.activePill/);
  assert.doesNotMatch(bar, /activeRule/);

  // Colour is never the only cue: the glyph fills, the tone moves and the
  // label thickens, so the state survives both kinds of colour blindness.
  assert.match(bar, /focused \? activeColor : inactiveColor/);
  assert.match(bar, /focused \? styles\.activeLabel : null/);
  for (const layout of [renter, provider]) {
    assert.match(layout, /focused \? "home" : "home-outline"/);
  }
});

test("every tab is a safe, accessible target", () => {
  // Assert the floor, not the number. The design system sets `targetMin: 48`;
  // a row that satisfies it stays correct if the row is retuned.
  const themeSource = read("src/theme.ts");
  const floor = Number(/"targetMin":\s*(\d+)/.exec(themeSource)?.[1]);
  assert.ok(floor >= 44, `expected a real touch floor, saw ${floor}`);

  const rowHeight = Number(/const ITEM_HEIGHT = (\d+);/.exec(bar)?.[1]);
  const pillWidth = Number(/const PILL_WIDTH = (\d+);/.exec(bar)?.[1]);
  assert.ok(rowHeight >= floor, `row ${rowHeight} is under the ${floor} floor`);
  assert.ok(pillWidth >= floor, `cell ${pillWidth} is under the ${floor} floor`);
  assert.match(bar, /minWidth: PILL_WIDTH/);

  assert.match(bar, /accessibilityRole="tablist"/);
  assert.match(bar, /accessibilityRole="tab"/);
  assert.match(bar, /accessibilityState=\{\{ selected: focused \}\}/);
  assert.match(bar, /hitSlop=\{space\[1\]\}/);
  assert.match(bar, /useSafeAreaInsets/);
  assert.match(bar, /maxWidth: BAR_MAX_WIDTH/);
});

test("the bar is built from the shared tokens, not from copies of them", () => {
  // It hardcoded `220`, `140` and two bezier curves that were, character for
  // character, `motion.duration.base`, `motion.duration.fast`,
  // `motion.easing.enter` and `motion.easing.exit`. Duplicated constants agree
  // until one of them is revised.
  // Against the code with its prose stripped: the docstring above names all
  // four tokens, so matching the raw file proves only that the comment exists.
  const source = code(bar);
  assert.match(source, /duration\.base/);
  assert.match(source, /duration\.fast/);
  // The curve is no longer named at the call site: `enter` and `exit` *are* the
  // curves, so asking for one is asking for the token behind it.
  assert.match(source, /enter\(duration\.base\) : exit\(duration\.fast\)/);
  assert.match(source, /borderRadius: radius\.pill/);
  assert.match(source, /from "@\/components\/ui"/);
  assert.match(source, /from "@\/motion"/);

  // No literal milliseconds or curves left behind to drift.
  // The four duration tokens are 80, 140, 220 and 320. None should appear
  // as a literal here; the reduce-motion `0` is not one of them.
  assert.doesNotMatch(source, /\b(?:80|140|220|320)\b/);
  assert.doesNotMatch(source, /Easing\.bezier\(\s*\d/);

  // And the bridge reads the system rather than restating it.
  const ui = read("src/components/ui.tsx");
  assert.match(ui, /export const motion = \{/);
  assert.match(ui, /ms\(theme\.motion\.duration\.base\)/);
  assert.match(ui, /bezier\(theme\.motion\.easing\.enter\)/);
  assert.match(ui, /export const radius = \{/);

  // And the curves reach Reanimated from that same bridge, built once rather
  // than recompiled per animation.
  const motion = read("src/motion.ts");
  assert.match(motion, /Easing\.bezier\(\.\.\.motion\.easing\.enter\)/);
  assert.match(motion, /Easing\.bezier\(\.\.\.motion\.easing\.exit\)/);
  assert.match(motion, /Easing\.bezier\(\.\.\.motion\.easing\.standard\)/);
});

test("motion is quiet, optional and platform-aware", () => {
  // The question moved to `src/motion.ts` once the home skeleton needed it
  // too; a second copy of an accessibility check is a second place to
  // forget it. The rule is unchanged: the bar must consult it.
  // The question lives in `src/motion.ts`, and it is now asked in two places
  // for two different reasons.
  //
  // Every timing and spring config there carries `ReduceMotion.System`, which
  // the UI thread answers without a round trip to JavaScript — so the bar no
  // longer holds a subscription purely to multiply a duration by zero, and the
  // rule it must satisfy is that its animations come from those configs.
  //
  // The hook is still exported and still reads the system, because one case
  // cannot be expressed as a config: the skeleton's pulse, where the right
  // answer is not to start the loop rather than to freeze it at its faintest.
  const motion = read("src/motion.ts");
  assert.match(motion, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(motion, /reduceMotion: ReduceMotion\.System/);
  assert.match(bar, /withTiming\(/);
  assert.match(bar, /withSpring\(toValue, press\)/);
  assert.match(bar, /hapticsPolicy\.onSelection/);

  // The press moves the glyph, not the label: type that rubber-bands under a
  // thumb reads as a toy.
  assert.match(bar, /styles\.iconStage, stageStyle/);
  assert.match(bar, /scale: pressScale\.value/);

  // Android ripples inside the target rather than flooding the whole shelf.
  assert.match(bar, /android_ripple=\{\s*isAndroid/);
  assert.match(bar, /radius: PILL_WIDTH \/ 2, borderless: true/);
});

test("a route hidden from the bar stays hidden", () => {
  // The provider declares `add` with `href: null` to keep it in the navigator
  // and off the bar.
  assert.match(provider, /name="add" options=\{\{ href: null \}\}/);

  // But `href` never reaches a custom tab bar. expo-router destructures it away
  // and marks the route with `tabBarItemStyle: { display: "none" }` instead —
  // pinned here against its own source, so a change upstream fails loudly
  // rather than quietly growing a sixth tab.
  const upstream = readFileSync(
    new URL("../node_modules/expo-router/build/layouts/TabsClient.js", import.meta.url),
    "utf8",
  );
  assert.match(upstream, /const \{ href, \.\.\.options \} = screen\.options/);
  assert.match(upstream, /tabBarItemStyle: href == null \? \{ display: 'none' \}/);

  // So the bar reads the marker, not the prop that no longer exists.
  assert.match(bar, /StyleSheet\.flatten\(options\.tabBarItemStyle\)\?\.display === "none"/);
  // `href` is still checked too: the transform above is skipped when a screen's
  // `options` is a function, and then `href` does survive.
  assert.match(bar, /\.href === null\) return true/);
  assert.match(bar, /isHiddenFromBar\(descriptor\.options\)/);

  // Narrowed away rather than asserted away, so a missing descriptor cannot
  // throw on the one control the whole app is navigated by.
  assert.match(bar, /if \(!descriptor\) return \[\]/);
});

test("nothing in the bar can throw on a tap", () => {
  // Haptics are optional at runtime: a build without the native module rejects
  // the import. Unguarded, that is an unhandled rejection on every selection.
  assert.match(bar, /import\("expo-haptics"\)[\s\S]{0,120}\.catch\(\(\) => null\)/);
});

test("a label stays on one line and stops growing before the bar breaks", () => {
  // Five tabs share the width of a handset. "Properties" wrapping to two lines
  // would push the bar taller than its safe-area allowance.
  assert.match(bar, /numberOfLines=\{1\}/);
  assert.match(bar, /maxFontSizeMultiplier=\{1\.25\}/);
});
