import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bar = read("src/components/nav/MainTabBar.tsx");
// The hidden-route rule is shared by both bars, so it lives beside them.
const routes = read("src/components/nav/tabRoutes.ts");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const renter = read("app/(app)/(tabs)/_layout.tsx");
const provider = read("app/(app)/(provider-tabs)/_layout.tsx");

test("both mobile worlds use one first-class navigation surface", () => {
  for (const layout of [renter, provider]) {
    assert.match(layout, /tabBar=\{\(props\) => <MainTabBar \{\.\.\.props\} \/>\}/);
  }
  assert.equal((renter.match(/<Tabs\.Screen/g) ?? []).length, 5);
  assert.equal((provider.match(/<Tabs\.Screen/g) ?? []).length, 6);
  // Saved left the tab group entirely (2026-09-15). It is a pushed screen beside
  // Verification and Security, so it carries a back arrow and no tab bar, and
  // Explore's header and More both push that href.
  assert.doesNotMatch(renter, /name="saved"/);
  assert.match(read("app/(app)/_layout.tsx"), /name="saved" options=\{\{ title: "Saved places" \}\}/);
  assert.match(provider, /name="add" options=\{\{ href: null \}\}/);
});

test("the tab you are on grows a pale kola indicator, fills in deep kola and turns bold", () => {
  const source = code(bar);

  // One shape marks where you are: a pale kola lozenge that widens behind the
  // active glyph. A release took it away for a bare coloured glyph, and the bar
  // read as poorer for it — the indicator is the bar's quality, not its clutter.
  assert.match(source, /style=\{\[styles\.indicator, \{ opacity: focusProgress, transform: \[\{ scaleX: widen \}\] \}\]\}/);
  assert.match(source, /indicator: \{\s*\.\.\.StyleSheet\.absoluteFill,\s*borderRadius: radius\.pill,\s*backgroundColor: shell\.activeGround,/);
  // And only the one: no rule across the cell as well.
  assert.doesNotMatch(source, /activeRule/);

  // Both glyphs are drawn, and one fades into the other.
  assert.match(source, /tabBarIcon\?\.\(\{ focused: false, color: RESTING, size: ICON_SIZE \}\)/);
  assert.match(source, /tabBarIcon\?\.\(\{ focused: true, color: ACTIVE, size: ICON_SIZE \}\)/);

  // Danpa HQ's green throughout: deep kola for the tab you are on and a muted kola
  // for the rest — never gold, and never a brown grey.
  assert.match(source, /const ACTIVE = shell\.active;/);
  assert.match(source, /const RESTING = shell\.resting;/);
  const palette = code(read("src/shell.ts"));
  assert.match(palette, /active: theme\.color\.kola\["800"\],/);
  assert.match(palette, /activeGround: theme\.color\.kola\["50"\],/);
  assert.match(palette, /resting: alpha\(theme\.color\.kola\["900"\], 0\.72\),/);
  assert.doesNotMatch(source, /gold|ink\["500"\]/);

  // Colour is never the only cue: the indicator appears, the glyph fills and the
  // name turns heavier, so the state survives both kinds of colour blindness.
  assert.match(source, /restingLabel: \{ color: RESTING, fontWeight: "500" \}/);
  assert.match(source, /activeLabel: \{[^}]*color: ACTIVE, fontWeight: "600" \}/);
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
  assert.match(bar, /aria-selected=\{focused\}/);
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
  assert.match(routes, /StyleSheet\.flatten\(options\.tabBarItemStyle\)\?\.display === "none"/);
  // `href` is still checked too: the transform above is skipped when a screen's
  // `options` is a function, and then `href` does survive.
  assert.match(routes, /\.href === null\) return true/);
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

test("iOS floats a glass capsule over the page, and every tab clears it", () => {
  const glass = code(read("src/components/nav/GlassTabBar.tsx"));
  // One entry point: iOS gets the glass, Android keeps its shelf.
  assert.match(code(bar), /return isIOS \? <GlassTabBar \{\.\.\.props\} \/> : <ShelfTabBar \{\.\.\.props\} \/>;/);

  // Real Liquid Glass where the system has it, a chrome blur where it does not.
  assert.match(glass, /const LIQUID_GLASS = isLiquidGlassAvailable\(\);/);
  assert.match(glass, /<GlassView glassEffectStyle="regular"/);
  assert.match(glass, /<BlurView tint="systemChromeMaterialLight"/);
  assert.match(glass, /onPanResponderGrant:[\s\S]*haptics\.selectionAsync\(\)/);
  // Explore can place dark ocean or satellite imagery underneath. Its glass
  // gets a restrained contrast floor and stronger edge without changing the
  // bar on ordinary pages.
  assert.match(glass, /const overMap = state\.routes\[state\.index\]\?\.name === "explore";/);
  assert.match(glass, /overMap \? <View pointerEvents="none" style=\{\[StyleSheet\.absoluteFill, styles\.mapGuard\]\} \/> : null/);
  assert.match(glass, /mapGuard:\s*\{\s*backgroundColor: alpha\(theme\.color\.field\["0"\], 0\.26\)/);
  assert.match(glass, /overMap \? styles\.capsuleOverMap : null/);
  // The material alone is not enough over dark ocean: map icons use solid
  // brand ink, without changing their shape or placing a tile behind each one.
  assert.match(glass, /const restingColor = overMap \? theme\.color\.kola\["900"\] : shell\.resting;/);
  assert.match(glass, /overMap \? styles\.restingLabelOverMap : null/);
  assert.doesNotMatch(glass, /iconStageOverMap|textShadowColor/);

  // Out of the layout flow, so it reports what it covers…
  assert.match(glass, /position: "absolute"/);
  assert.match(glass, /reportHeight\?\.\(CAPSULE_HEIGHT \+ dockLift\)/);
  // …and the pages read it back, on iOS only.
  const platform = code(read("src/platform.ts"));
  assert.match(platform, /if \(!isIOS\) return 0;\s*if \(nativeTabs\) return insets\.bottom;\s*return tabBarHeight \?\? 0;/);
  assert.match(platform, /if \(floatingBar > 0\) return base \+ floatingBar;/);
  assert.match(code(read("src/components/home/HomeHero.tsx")), /paddingBottom: space\[12\] \+ barClearance/);

  // The same hidden-route rule and the same accessible tabs as the shelf.
  assert.match(glass, /isHiddenFromBar\(descriptor\.options\)/);
  assert.match(glass, /accessibilityRole="tablist"/);
  assert.match(glass, /aria-selected=\{focused\}/);
  assert.match(glass, /import\("expo-haptics"\)[\s\S]{0,120}\.catch\(\(\) => null\)/);

  // It moves like the system bar: a drag scrubs, the lozenge is a stiff lead
  // and a soft trail so it stretches as it travels, it swells under a finger,
  // and colour follows its position rather than a timer.
  assert.match(glass, /PanResponder\.create\(/);
  assert.match(glass, /Animated\.parallel\(\[spring\(lead, target, LEAD\), spring\(trail, target, TRAIL\)\]\)/);
  assert.match(glass, /transform: \[\{ translateX: centre \}, \{ scaleX: stretch \}, \{ scaleY: thin \}, \{ scale: swell \}\]/);
  assert.match(glass, /inputRange: \[\(position - 1\) \* cell, position \* cell, \(position \+ 1\) \* cell\]/);
  assert.match(glass, /if \(!placed\.current \|\| reduceMotion\)/);
  // Every animation stays on the native driver.
  assert.match(glass, /Animated\.spring\(value, \{ toValue, \.\.\.config, useNativeDriver: true \}\)/);
  // A touch the system takes away opens nothing and goes home.
  assert.match(glass, /onPanResponderTerminate: \(\) => release\(false\)/);
  // VoiceOver still activates every tab.
  assert.match(glass, /accessibilityActions=\{\[\{ name: "activate" \}\]\}/);

  // Reanimated, Worklets and Gesture Handler froze the app at launch in Expo Go
  // on an iPhone 17 Pro Max (2026-10-13). The bar stays on React Native's own
  // Animated and PanResponder.
  assert.doesNotMatch(glass, /react-native-reanimated|react-native-gesture-handler|react-native-worklets/);
});

test("iOS renter tabs are Apple's own bar, and every tab page draws its own header", () => {
  const layout = code(renter);
  // iOS takes the native bar; Android keeps the JS tabs and their shelf.
  assert.match(layout, /return isIOS \? <RenterNativeTabs \/> : <RenterJsTabs \/>;/);
  assert.match(layout, /from "expo-router\/unstable-native-tabs"/);
  for (const name of ["index", "explore", "services", "payments", "profile"]) {
    assert.match(layout, new RegExp(`<NativeTabs\.Trigger name="${name}" disableAutomaticContentInsets`), `${name} is missing`);
  }
  // Outline at rest, filled when chosen, in Danpa HQ's green.
  assert.match(layout, /sf=\{\{ default: "house", selected: "house\.fill" \}\}/);
  assert.match(layout, /<NativeTabs tintColor=\{theme\.color\.kola\["600"\]\} screenListeners=\{nativeTabHaptics\}>/);

  // The native bar draws no header, so each route frames its page.
  for (const [file, tab] of [["index", "home"], ["explore", "explore"], ["services", "services"], ["payments", "payments"], ["profile", "menu"]]) {
    assert.match(read(`app/(app)/(tabs)/${file}.tsx`), new RegExp(`<RenterTabFrame tab="${tab}">`), `${file} is not framed`);
  }
  const frame = code(read("src/components/nav/NativeTabFrame.tsx"));
  // Nothing at all off iOS, so Android's navigator header is not doubled.
  assert.match(frame, /if \(!isIOS\) return <>\{children\}<\/>;/);
  assert.match(frame, /<TabHeaderRow/);
  assert.match(code(read("src/components/nav/TabHeader.tsx")), /return <TabHeaderRow left=\{left\} middle=\{middle\} right=\{right\} continues=\{continues\} \/>;/);
});

test("iOS provider tabs are Apple's own bar too, with add hidden, and both bars tick", () => {
  const layout = code(provider);
  assert.match(layout, /return isIOS \? <ProviderNativeTabs \/> : <ProviderJsTabs \/>;/);
  for (const name of ["index", "properties", "tenants", "payments", "more"]) {
    assert.match(layout, new RegExp(`<NativeTabs\.Trigger name="${name}" disableAutomaticContentInsets`), `${name} is missing`);
  }
  assert.match(layout, /<NativeTabs\.Trigger name="add" hidden \/>/);
  assert.match(layout, /screenListeners=\{nativeTabHaptics\}/);
  for (const [file, tab] of [["index", "home"], ["properties", "properties"], ["tenants", "tenants"], ["payments", "payments"], ["more", "menu"], ["add", "add"]]) {
    assert.match(read(`app/(app)/(provider-tabs)/${file}.tsx`), new RegExp(`<ProviderTabFrame tab="${tab}">`), `${file} is not framed`);
  }

  // Apple's bar plays no haptic of its own; ours ticks on every press it allows,
  // and a build without the module never throws on a tap.
  const frame = code(read("src/components/nav/NativeTabFrame.tsx"));
  assert.match(frame, /if \(!hapticsPolicy\.onSelection \|\| event\.data\?\.isPrevented\) return;/);
  assert.match(frame, /import\("expo-haptics"\)[\s\S]{0,120}\.catch\(\(\) => null\)/);
});
