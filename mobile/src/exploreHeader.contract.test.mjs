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
const button = () => read("src/components/nav/HeaderCircleButton.tsx");

test("the actions belong to the Explore tab, not to the screen behind it", () => {
  // Still one component in two places — the reason the scoping matters.
  assert.match(read("app/(app)/(tabs)/explore.tsx"), /export \{ default \} from "\.\.\/search"/);
  assert.match(read("app/(app)/_layout.tsx"), /name="search"/);

  // So the header is declared on the tab, and nowhere in the shared screen.
  const explore = /<Tabs\.Screen name="explore"[^\n]*/.exec(code(layout()))?.[0] ?? "";
  assert.match(explore, /headerRight: \(\) => <ExploreHeaderActions \/>/);
  assert.doesNotMatch(code(read("app/(app)/search.tsx")), /headerRight|ExploreHeaderActions/);

  // And on that tab only: no other tab grows the same pair by accident.
  assert.equal((code(layout()).match(/<ExploreHeaderActions/g) ?? []).length, 1);
});

test("each button opens the tab it names, the way the app already does", () => {
  const source = code(actions());
  assert.match(source, /icon="bookmark-outline"[\s\S]{0,80}label="Saved"/);
  assert.match(source, /label="Your profile"/);

  // The same hrefs and the same method Profile -> "Saved places" uses. One
  // transition should not behave two ways.
  assert.match(source, /router\.push\("\/\(app\)\/\(tabs\)\/saved" as never\)/);
  assert.match(source, /router\.push\("\/\(app\)\/\(tabs\)\/profile" as never\)/);
  assert.match(
    read("app/(app)/(tabs)/profile.tsx"),
    /router\.push\("\/\(app\)\/\(tabs\)\/saved" as never\)/,
  );
});

test("a real face beats a generic silhouette, without a request per render", () => {
  const source = code(actions());
  assert.match(source, /resolvePhotoUrl\(avatarEndpoint\)/);
  assert.match(source, /imageUri=\{photoUri\}/);
  // The same guarded effect the Profile screen uses: a photo that changes
  // mid-resolve must not flash the previous one back.
  assert.match(source, /if \(live\) setPhotoUri\(url\)/);
  assert.match(source, /live = false/);
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
  const bar = code(read("src/components/nav/MainTabBar.tsx"));

  // Two navigation affordances on one screen that answer a thumb differently
  // feel like two products.
  //
  // This used to parse `speed` and `bounciness` out of both files and compare
  // the numbers — which is the strongest check available when a constant is
  // transcribed, and no check at all once somebody transcribes a third one.
  // Both now import the same spring from `src/motion.ts`, so the guarantee is
  // that neither file is in a position to disagree.
  for (const [name, text] of [["the header button", source], ["the tab bar", bar]]) {
    assert.match(text, /from "@\/motion"/, `${name} must take its press from the motion module`);
    assert.doesNotMatch(
      text,
      /speed:|bounciness:|stiffness:|damping:/,
      `${name} must not describe a spring of its own`,
    );
  }

  assert.match(source, /withSpring\(toValue, pressSpring\)/);
  assert.match(source, /radius: DISC \/ 2, borderless: true/);
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityLabel=\{label\}/);
});
