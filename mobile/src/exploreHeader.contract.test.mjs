/**
 * Saved and Profile at the top of Explore.
 *
 * The scoping is the fragile part. `explore.tsx` is a one-line re-export of
 * `search.tsx`, which is *also* registered as a pushed `/search` route — one
 * component rendered in two places. A header wired inside that component would
 * appear on both, putting tab shortcuts on a screen that has no tab bar.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const layout = () => read("app/(app)/(tabs)/_layout.tsx");
const actions = () => read("src/components/nav/ExploreHeaderActions.tsx");
const controls = () => read("src/components/nav/TabHeaderControls.tsx");
const button = () => read("src/components/nav/HeaderCircleButton.tsx");

test("the actions belong to the Explore tab, not to the screen behind it", () => {
  // Still one component in two places — the reason the scoping matters.
  // The tab renders the same screen, framed for iOS's native tab bar.
  const tab = read("app/(app)/(tabs)/explore.tsx");
  assert.match(tab, /import SearchScreen from "\.\.\/search";/);
  assert.match(tab, /<RenterTabFrame tab="explore">\s*<SearchScreen \/>/);
  assert.match(read("app/(app)/_layout.tsx"), /name="search"/);

  // Inside the tabs means either kind of tabs: the native bar provides no JS
  // tab context, so the check reads the native frame's context too.
  assert.match(code(read("src/platform.ts")), /return jsTabs \|\| nativeTabs;/);
  assert.match(code(read("src/components/nav/NativeTabFrame.tsx")), /<NativeTabContext\.Provider value>/);

  // Explore draws its own top now — one green hero holding the title, these
  // actions, Rent or Buy, the search and the filters (owner, 2026-09-29) — so
  // the tab hides the shared header rather than decorating it.
  const explore = /<Tabs\.Screen name="explore"[^\n]*/.exec(code(layout()))?.[0] ?? "";
  assert.match(explore, /headerShown: false/);
  assert.doesNotMatch(code(layout()), /ExploreHeaderActions/);

  // The shared screen adds the actions only inside the tabs, so the pushed
  // `/search` route still grows no tab shortcuts.
  const search = code(read("app/(app)/search.tsx"));
  assert.match(search, /const actions = inTabs \? <ExploreHeaderActions \/> : undefined;/);
  assert.equal((search.match(/<ExploreHeaderActions/g) ?? []).length, 1);
  // The hero is one row (owner, 2026-10-06): the search, Saved and Filters. No
  // title, profile or bell — they made the top heavy and are a tab away. The
  // All / Rent / Buy bar is gone too — Show is the first row of the Filters
  // sheet (owner, 2026-10-05).
  const hero = code(read("src/components/explore/ExploreHero.tsx"));
  assert.doesNotMatch(hero, /titleRow|>\s*Explore\s*</);
  assert.match(hero, /<View style=\{styles\.searchRow\}>\s*<View style=\{\{ flex: 1, minWidth: 0 \}\}>\{search\}<\/View>\s*\{actions\}\s*<FiltersButton/);
  assert.doesNotMatch(code(actions()), /TenantProfileButton|notifications|UpdatesBell/);
  // Field, Saved and Filters stand at one height.
  assert.match(hero, /field: \{\s*minHeight: 42,/);
  assert.match(hero, /filters: \{\s*width: 42,\s*height: 42,/);
  assert.match(code(actions()), /const SIZE = 42;/);
  assert.doesNotMatch(hero, /ModeSwitch/);
  assert.match(hero, /<View style=\{styles\.controls\}>[\s\S]{0,40}<View style=\{styles\.searchRow\}>/);
});

test("each button opens the tab it names, the way the app already does", () => {
  const explore = code(actions());
  assert.match(explore, /accessibilityLabel="Saved"/);
  assert.match(explore, /router\.push\("\/\(app\)\/saved" as never\)/);
  assert.match(explore, /name="bookmark-outline"/);
  // The tenant tabs' avatar opens the profile.
  const source = code(controls());
  assert.match(source, /"Your profile"/);

  // The same href and the same method More -> "Saved places" uses. One
  // transition should not behave two ways. Saved is a pushed screen now.
  assert.match(source, /"\/\(app\)\/profile-edit"/);
  assert.match(
    read("app/(app)/(tabs)/profile.tsx"),
    /const go = \(path: string\) => \(\) => router\.push\(path as never\);[\s\S]*onPress: go\("\/\(app\)\/saved"\)/,
  );
});

test("a real face beats a generic silhouette, without a request per render", () => {
  const source = code(controls());
  assert.match(source, /resolvePhotoUrl\(endpoint\)/);
  assert.match(source, /<Image source=\{\{ uri: photoUri \}\}/);
  // A photo that changes mid-resolve must not flash the previous one back: the
  // answer is kept with the endpoint it belongs to, and a stale one is ignored.
  assert.match(source, /if \(live\) setResolved\(\{ endpoint, url \}\)/);
  assert.match(source, /live = false/);
  assert.match(source, /resolved\?\.endpoint === endpoint \? resolved\.url : null/);
});

test("the disc is smaller than the target it sits in", () => {
  const source = code(button());
  const floor = Number(/"targetMin":\s*(\d+)/.exec(read("src/theme.ts"))?.[1]);
  const disc = Number(/const DISC = (\d+);/.exec(source)?.[1]);
  const slop = Number(/space\[(\d+)\]/.exec(/hitSlop=\{space\[\d\]\}/.exec(source)?.[0] ?? "")?.[1]);
  const slopPx = { 1: 4, 2: 8, 3: 12 }[slop];

  assert.ok(disc < floor, `a ${disc}pt disc that is only ${disc}pt to a thumb misses the floor`);
  assert.ok(
    disc + slopPx * 2 >= floor,
    `${disc}pt + ${slopPx}pt slop each side is ${disc + slopPx * 2}, under the ${floor} floor`,
  );
  assert.match(source, /borderRadius: radius\.pill/);
});

test("it presses like the tab bar, because it sits beside it", () => {
  const source = code(button());
  // Two navigation affordances on one screen that answer a thumb differently
  // feel like two products.
  const spring = (text) => ({
    speed: Number(/speed:\s*([\d.]+)/.exec(text)?.[1]),
    bounciness: Number(/bounciness:\s*([\d.]+)/.exec(text)?.[1]),
  });
  const here = spring(source);
  const bar = spring(code(read("src/components/nav/MainTabBar.tsx")));
  assert.ok(Number.isFinite(here.speed), "no spring found on the header button");
  assert.deepEqual(here, bar, "the header button and the tab bar must press alike");

  assert.match(source, /Animated\.spring\(scale/);
  assert.match(source, /radius: DISC \/ 2, borderless: true/);
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityLabel=\{label\}/);
});

test("Explore's Filters is one sheet, and Show is a draft its button applies", () => {
  // Three sheets swapped one native Modal for another and froze iOS; closing
  // first "just applied" and was not smooth (owner, 2026-10-05). Now one sheet:
  // Show picks a draft, the cards below follow it, and the button applies it.
  const search = code(read("app/(app)/search.tsx"));
  assert.equal((search.match(/<BottomSheet\b/g) ?? []).length, 1);
  assert.match(search, /<FilterSheet\s+visible=\{filtersOpen\}\s+mode=\{mode\}\s+onApplySide=\{onModeChange\}/);
  assert.match(search, /<ShowField mode=\{draft\} onChange=\{setDraft\} \/>/);
  assert.match(search, /\{draft === "buy" \? saleCards : draft === "all" \? allCards : \(/);
  assert.match(search, /function apply\(\) \{\s*if \(draft !== mode\) onApplySide\(draft\);\s*onClose\(\);/);
  assert.doesNotMatch(search, /<SaleFilterSheet|<AllFilterSheet|switchSide/);
});
