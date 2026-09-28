/**
 * The shell: what stands between a launch and the first screen, and the frame
 * every screen stands in.
 *
 * Two failures this guards against. A refresh drew whichever screen the address
 * named before there was a session — the signed-out version of it, which for a
 * tenant's Home was the browsing page — and a path both workspaces answer opened
 * the provider's tab for anybody. And the app's colour went wrong twice: first
 * one flat beige under pages that titled themselves again, then ink chrome and a
 * gold accent that read as dark and brown. The shell is Rooomly's green now, over
 * an ivory page and paper surfaces.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  const stop = source.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, `${end} is missing after ${start}`);
  return source.slice(at, stop);
};

const gate = () => code(read("app/_layout.tsx"));
const renterTabs = () => read("app/(app)/(tabs)/_layout.tsx");
const providerTabs = () => read("app/(app)/(provider-tabs)/_layout.tsx");

test("nothing is drawn until the app knows who is looking and where they belong", () => {
  const body = gate();

  // Decided while rendering, so the frame that would have shown the wrong screen
  // already knows it is the wrong one.
  assert.match(body, /const redirect = state\.status === "loading" \? null : entryRedirect\(state, activeContext, segments\);/);
  assert.match(body, /const settled = state\.status !== "loading" && redirect === null;/);
  assert.match(body, /if \(redirect\) router\.replace\(redirect as never\);/);

  // One curtain over the navigator until then, and nothing behind it is read aloud.
  assert.match(body, /<\/Stack>\s*<\/View>\s*<LaunchCurtain settled=\{settled\} \/>/);
  assert.match(body, /importantForAccessibility=\{settled \? "auto" : "no-hide-descendants"\}/);
  // A redirect made behind it is instant: the curtain lifting is the transition.
  assert.match(body, /animation: settled \? stackAnimation : "none"/);

  // `/` draws the ground. It no longer announces that it is loading.
  const index = code(read("app/index.tsx"));
  assert.doesNotMatch(index, /Loading your account/);
  assert.doesNotMatch(index, /<Type|<Text/);
});

test("a path both tab groups answer lands in the one this person may use", () => {
  const body = gate();
  const decide = between(body, "function entryRedirect(", "function Shell(");

  // `/payments` is both workspaces' tab, and a refresh opens the provider's.
  assert.match(body, /const SHARED_TABS = \["payments"\];/);
  assert.match(decide, /const renterTwin = inProviderTabs && SHARED_TABS\.includes\(tab\) \? `\/\(app\)\/\(tabs\)\/\$\{tab\}` : null;/);

  // Signed in, the provider tabs open only inside the provider workspace.
  assert.match(decide, /const mayOperate = capabilities\.provider\.workspace_access && capabilities\.active_workspace === "provider";/);
  assert.match(decide, /if \(inProviderTabs && !mayOperate && !destination\.startsWith\("\/\(app\)\/\(provider-tabs\)"\)\) \{\s*return renterTwin \?\? destination;/);
  assert.match(decide, /if \(atRoot\) return destination;/);

  // Signed out, the renter's tab at that address is public; the provider's never is.
  assert.match(decide, /return renterTwin \?\? "\/\(auth\)\/start";/);
});

test("the launch is three dots on the page's own ivory, and it lets go gently", () => {
  const launch = code(read("src/components/shell/LaunchScreen.tsx"));

  assert.doesNotMatch(launch, /ActivityIndicator/);
  assert.match(launch, /accessibilityRole="progressbar"/);
  assert.match(launch, /beats\.map\(rise\)/);
  assert.match(launch, /useReduceMotion\(\)/);
  assert.match(launch, /useNativeDriver: true/);

  // Opaque the instant it is needed; lifted only once everything behind it is right.
  assert.match(launch, /opacity: settled \? opacity : 1/);
  assert.match(launch, /if \(settled && lifted\) return null;/);
  assert.match(launch, /accessibilityViewIsModal=\{!settled\}/);

  // A slow network is said, not left looking like a hang.
  assert.match(launch, /setTimeout\(\(\) => setSlow\(true\), PATIENCE_MS\)/);

  // Waiting looks like waiting: three dots, and no brand moment in the one place
  // nobody wants one. Not the wordmark, and not the green — the curtain stands on
  // the same ivory as the page behind it, and a build's splash is that ivory too,
  // so a launch goes from splash to curtain to first screen without a colour jump.
  assert.doesNotMatch(launch, /Wordmark/);
  assert.doesNotMatch(launch, /shell\.chrome/);
  assert.match(launch, /backgroundColor: shell\.canvas,/);
  assert.match(launch, /<View style=\{styles\.dots\}>/);
  assert.match(launch, /beats\.map\(\(beat, index\) => \(\s*<Animated\.View/);
  assert.match(launch, /styles\.dot,/);
  // Since SDK 55 the splash is configured on the `expo-splash-screen` plugin; the
  // root `splash` key it replaced is gone.
  assert.match(read("app.json"), /\[\s*"expo-splash-screen",\s*\{\s*"resizeMode": "contain",\s*"backgroundColor": "#FAF8F5"/);
  assert.match(read("app.json"), /"backgroundColor": "#FAF8F5",/);
  assert.doesNotMatch(read("app.json"), /"splash":/);

  // The wordmark itself stays — it is still both Homes' header title.
  assert.match(code(read("src/components/shell/Wordmark.tsx")), /o: \{\s*color: shell\.markOnChrome,/);
});

test("green frames the page: kola above, ivory beneath, paper under the thumb", () => {
  const body = gate();
  const palette = code(read("src/shell.ts"));

  // The navigators' own surfaces are Rooomly's, so a scene nobody painted is not
  // React Navigation's default grey.
  assert.match(body, /<ThemeProvider value=\{navigationTheme\}>/);
  assert.match(palette, /background: shell\.canvas,/);
  assert.match(palette, /card: shell\.chrome,/);

  // The chrome is Rooomly's green with white on it; the page is ivory and the
  // surfaces on it are paper.
  assert.match(palette, /chrome: theme\.color\.kola\["600"\],/);
  assert.match(palette, /onChrome: theme\.color\.field\["0"\],/);
  assert.match(palette, /chromeRaised: alpha\(theme\.color\.field\["0"\], 0\.14\),/);
  assert.match(palette, /canvas: theme\.color\.field\["50"\],/);
  assert.match(palette, /paper: theme\.color\.field\["0"\],/);
  assert.match(palette, /dashboard: ph\.ground,/);
  // Ink chrome and a gold accent read as dark and brown and were turned down;
  // `field-100` is a quiet fill, never a page.
  assert.doesNotMatch(palette, /ink\["950"\]|ink\["800"\]|gold\[|field\["100"\]/);

  // Edge to edge, the chrome paints the strip behind the status bar, whose
  // glyphs turn dark only on the ivory sign-in journey.
  // The curtain is ivory now, so the glyphs over it are dark like the auth
  // flow's — white ones would be invisible for the whole of a slow launch.
  assert.match(body, /const statusBar = settled && segments\[0\] !== "\(auth\)" \? "light" : "dark";/);
  assert.match(body, /<StatusBar style=\{statusBar\} \/>/);
  assert.match(body, /<SafeAreaProvider initialMetrics=\{initialWindowMetrics\}>/);
  assert.match(body, /<TypographyScaleProvider>[\s\S]*<AuthProvider>/);
  assert.doesNotMatch(read("src/platform.ts"), /needsStatusBarBackground/);

  // Every tab's header is the chrome, over a page that declares its own ground…
  for (const layout of [renterTabs(), providerTabs()]) {
    assert.match(layout, /header: \(props\) => <TabHeader \{\.\.\.props\}/);
    assert.match(layout, /sceneStyle: \{ backgroundColor: shell\.canvas \}/);
  }
  const header = code(read("src/components/nav/TabHeader.tsx"));
  assert.match(header, /safeHeaderTop\(insets\.top\)/);
  assert.match(
    header,
    /paddingTop: topInset,[\s\S]*paddingLeft: insets\.left,[\s\S]*paddingRight: insets\.right,[\s\S]*backgroundColor: shell\.chrome/,
  );
  assert.match(header, /height: topInset \+ space\[2\], backgroundColor: shell\.chrome/);
  assert.match(header, /color: shell\.onChrome,/);

  // …and so is every pushed screen's, with its way back in the header's white.
  const stack = read("app/(app)/_layout.tsx");
  assert.match(stack, /header: \(props\) => <StackHeader \{\.\.\.props\} \/>/);
  assert.match(stack, /contentStyle: \{ backgroundColor: shell\.canvas \}/);
  const stackHeader = code(read("src/components/nav/StackHeader.tsx"));
  assert.match(stackHeader, /const topInset = safeHeaderTop\(insets\.top\);/);
  assert.match(
    stackHeader,
    /paddingTop: topInset,[\s\S]*paddingLeft: insets\.left,[\s\S]*paddingRight: insets\.right,[\s\S]*backgroundColor: shell\.chrome/,
  );
  assert.match(stackHeader, /const tintColor = options\.headerTintColor \?\? shell\.onChrome;/);
  assert.match(code(read("src/components/nav/BackControl.tsx")), /color=\{tintColor \?\? shell\.onChrome\}/);

  // A control on the chrome is a translucent well the green shows through; the
  // create action is a solid white disc with its glyph in the chrome's kola.
  assert.match(code(read("src/components/nav/HeaderCircleButton.tsx")), /backgroundColor: shell\.chromeRaised,/);
  assert.match(
    code(read("src/components/portfolio/PortfolioSwitcher.tsx")),
    /backgroundColor: pressed \? shell\.chromePressed : shell\.chromeRaised,/,
  );
  assert.match(providerTabs(), /backgroundColor: pressed && !isAndroid \? theme\.color\.field\["200"\] : shell\.onChrome,/);
  assert.match(providerTabs(), /<Ionicons name="add" size=\{24\} color=\{shell\.chrome\} \/>/);

  // The tab bar is paper under a hairline, lifted by a whisper of shadow on iOS only.
  const bar = code(read("src/components/nav/MainTabBar.tsx"));
  assert.match(bar, /bar: \{\s*backgroundColor: shell\.paper,\s*borderTopColor: shell\.rule,\s*borderTopWidth: StyleSheet\.hairlineWidth,/);
  assert.match(bar, /style=\{\[styles\.bar, isIOS \? styles\.lift : null\]\}/);
  assert.doesNotMatch(bar, /elevation:/);

  // The two Homes stand on the soft green ground; see homeGround.contract.test.mjs.
  assert.match(providerTabs(), /name="index" options=\{\{[^\n]*sceneStyle: \{ backgroundColor: shell\.dashboard \}/);
  // Home is the dashboard ground in both states; every other tab is ivory.
  assert.match(renterTabs(), /name="index" options=\{\{[^\n]*sceneStyle: \{ backgroundColor: shell\.dashboard \}/);
  assert.match(renterTabs(), /sceneStyle: \{ backgroundColor: shell\.canvas \}/);
});

test("small phones receive one bounded typography scale", () => {
  const ui = code(read("src/components/ui.tsx"));

  assert.match(ui, /width <= 340 \? "narrow" : width <= 375 \? "compact" : "regular"/);
  assert.match(ui, /display1: \[44, 48\]/);
  assert.match(ui, /display1: \[40, 44\]/);
  assert.match(ui, /body: \[15, 23\]/);
  assert.match(ui, /caption: \[13, 18\]/);
  // The component-level style stays last, so a deliberate fit adjustment is
  // never silently overridden by the global density system.
  assert.match(ui, /style=\{\[TYPE\[variant\], responsiveType, style\]\}/);
  assert.match(ui, /maxFontSizeMultiplier=\{maxFontSizeMultiplier\}/);
});

test("a page's name is said once, by its header", () => {
  const pages = {
    "app/(app)/(tabs)/services.tsx": "Services",
    "app/(app)/tenant-payments.tsx": "Payments",
    "app/(app)/(provider-tabs)/payments.tsx": "Payments",
    "app/(app)/(provider-tabs)/tenants.tsx": "Tenants",
    "app/(app)/(provider-tabs)/properties.tsx": "Properties",
    "app/(app)/(provider-tabs)/more.tsx": "More",
    "app/(app)/provider-viewings.tsx": "Viewings",
    "app/(app)/archive.tsx": "Archive",
  };
  for (const [path, name] of Object.entries(pages)) {
    assert.doesNotMatch(code(read(path)), new RegExp(`>\\s*${name}\\s*</Type>`), `${path} titles itself under its header`);
  }

  // Home's greeting is its title, so its header carries Rooomly's mark rather
  // than a second name — and the mark is announced as the word.
  for (const layout of [renterTabs(), providerTabs()]) {
    assert.match(layout, /name="index" options=\{\{ title: "Home", headerTitle: \(\) => <Wordmark \/>,/);
  }
  assert.match(code(read("src/components/shell/Wordmark.tsx")), /accessibilityRole="header" accessibilityLabel="Rooomly"/);

  // The header draws a title only when there is one, and a drawn title in its place.
  const header = code(read("src/components/nav/TabHeader.tsx"));
  assert.match(header, /typeof options\.headerTitle === "function"/);
  assert.match(header, /if \(!customTitle && !title && !left && !right\) \{/);
  assert.match(header, /accessibilityRole="header"/);
  // Provider chrome keeps one line: the page name. Portfolio scope remains in
  // the labelled switcher rather than stacking a second heading above it.
  assert.match(providerTabs(), /header: \(props\) => <TabHeader \{\.\.\.props\} \/>/);
  assert.doesNotMatch(providerTabs(), /eyebrow=|portfolio\?\.label/);
  assert.doesNotMatch(header, /eyebrow/);
  assert.match(header, /fontSize: 20,[\s\S]*fontWeight: "700"/);
  assert.match(header, /fontSize: 18,[\s\S]*lineHeight: 24/);
  assert.match(header, /paddingLeft: insets\.left,[\s\S]*paddingRight: insets\.right/);
  const stack = code(read("app/(app)/_layout.tsx"));
  assert.match(stack, /name="provider-viewings" options=\{\{ title: "Viewings" \}\}/);
});
