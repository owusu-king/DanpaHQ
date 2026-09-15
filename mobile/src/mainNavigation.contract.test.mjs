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

test("the tab you are on grows a pale kola indicator, fills in deep kola and turns bold", () => {
  const source = code(bar);

  // One shape marks where you are: a pale kola lozenge that widens behind the
  // active glyph. A release took it away for a bare coloured glyph, and the bar
  // read as poorer for it — the indicator is the bar's quality, not its clutter.
  assert.match(source, /style=\{\[styles\.indicator, \{ opacity: focusProgress, transform: \[\{ scaleX: widen \}\] \}\]\}/);
  assert.match(source, /indicator: \{\s*\.\.\.StyleSheet\.absoluteFillObject,\s*borderRadius: radius\.pill,\s*backgroundColor: shell\.activeGround,/);
  // And only the one: no rule across the cell as well.
  assert.doesNotMatch(source, /activeRule/);

  // Both glyphs are drawn, and one fades into the other.
  assert.match(source, /tabBarIcon\?\.\(\{ focused: false, color: RESTING, size: ICON_SIZE \}\)/);
  assert.match(source, /tabBarIcon\?\.\(\{ focused: true, color: ACTIVE, size: ICON_SIZE \}\)/);

  // Rooomly's green throughout: deep kola for the tab you are on and a muted kola
  // for the rest — never gold, and never a brown grey.
  assert.match(source, /const ACTIVE = shell\.active;/);
  assert.match(source, /const RESTING = shell\.resting;/);
  const palette = code(read("src/shell.ts"));
  assert.match(palette, /active: theme\.color\.kola\["800"\],/);
  assert.match(palette, /activeGround: theme\.color\.kola\["50"\],/);
  assert.match(palette, /resting: alpha\(theme\.color\.kola\["900"\], 0\.72\),/);
  assert.doesNotMatch(source, /gold|ink\["500"\]/);

  // Colour is never the only cue: the indicator appears, the glyph fills and the
  // name turns bold, so the state survives both kinds of colour blindness.
  assert.match(source, /restingLabel: \{ color: RESTING, fontWeight: "500" \}/);
  assert.match(source, /activeLabel: \{[^}]*color: ACTIVE, fontWeight: "700" \}/);
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
  const cellWidth = Number(/const CELL_MIN_WIDTH = (\d+);/.exec(bar)?.[1]);
  const indicatorWidth = Number(/const INDICATOR_WIDTH = (\d+);/.exec(bar)?.[1]);
  assert.ok(rowHeight >= floor, `row ${rowHeight} is under the ${floor} floor`);
  assert.ok(cellWidth >= floor, `cell ${cellWidth} is under the ${floor} floor`);
  assert.ok(indicatorWidth >= floor, `indicator ${indicatorWidth} is under the ${floor} floor`);
  assert.match(bar, /minWidth: CELL_MIN_WIDTH/);

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
  assert.match(source, /motion\.duration\.base/);
  assert.match(source, /motion\.duration\.fast/);
  assert.match(source, /motion\.easing\.enter : motion\.easing\.exit/);
  assert.match(source, /borderRadius: radius\.pill/);
  assert.match(source, /from "@\/components\/ui"/);

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
});

test("motion is quiet, optional and platform-aware", () => {
  // The question moved to `src/motion.ts` once the home skeleton needed it
  // too; a second copy of an accessibility check is a second place to
  // forget it. The rule is unchanged: the bar must consult it.
  assert.match(bar, /useReduceMotion\(\)/);
  assert.match(read("src/motion.ts"), /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(bar, /duration: reduceMotion \? 0/);
  assert.match(bar, /Animated\.spring/);
  assert.match(bar, /hapticsPolicy\.onSelection/);

  // The indicator widens into place while the glyph and its name crossfade, all
  // on the native driver, so nothing jumps and nothing redraws on the JS thread.
  assert.match(bar, /const resting = useMemo\(\(\) => focusProgress\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[1, 0\] \}\), \[focusProgress\]\);/);
  assert.match(bar, /const widen = useMemo\(\(\) => focusProgress\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[0\.55, 1\] \}\), \[focusProgress\]\);/);
  assert.match(bar, /opacity: resting/);
  assert.match(bar, /opacity: focusProgress/);

  // The press moves the glyph and its indicator, not the label: type that
  // rubber-bands under a thumb reads as a toy.
  assert.match(bar, /styles\.iconStage, \{ transform: \[\{ scale: pressScale \}\] \}/);

  // Android ripples inside the indicator rather than flooding the whole shelf.
  assert.match(bar, /android_ripple=\{\s*isAndroid/);
  assert.match(bar, /radius: INDICATOR_WIDTH \/ 2, borderless: true/);
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
