/**
 * The shortlist.
 *
 * Saved left the tab bar on 2026-09-15. It is a pushed screen beside
 * Verification and Security — reached from Explore's header and from More —
 * which is what these tests protect: the route's shape, the signed-out way in,
 * and the heart that removes a card without waiting for the server.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const screen = () => read("app/(app)/saved.tsx");

test("the shortlist is a pushed screen, not a tab with its bar hidden", () => {
  // A hidden tab still renders inside the tab navigator, so it kept the bar and
  // had no way back. The wrapper that registered it is gone.
  assert.equal(existsSync(new URL("../app/(app)/(tabs)/saved.tsx", import.meta.url)), false);
  assert.doesNotMatch(read("app/(app)/(tabs)/_layout.tsx"), /name="saved"/);
  assert.match(read("app/(app)/_layout.tsx"), /name="saved" options=\{\{ title: "Saved places" \}\}/);

  // Both ways in push the pushed route.
  assert.match(
    read("src/components/nav/ExploreHeaderActions.tsx"),
    /router\.push\("\/\(app\)\/saved" as never\)/,
  );
  assert.match(read("app/(app)/(tabs)/profile.tsx"), /router\.push\("\/\(app\)\/saved" as never\)/);
});

test("signed out, it asks for the account the shortlist belongs to", () => {
  const source = screen();
  // The prompt lives on the screen itself now that there is no wrapper, and it
  // returns to this route rather than to the tab it used to be.
  assert.match(source, /<AuthPrompt\s+icon="bookmark"/);
  assert.match(source, /next="\/\(app\)\/saved"/);
});

test("the heart removes a card at once, and puts it back if the server refuses", () => {
  const source = screen();
  assert.match(source, /const previous = items;/);
  assert.match(
    source,
    /setItems\(\(current\) => current\?\.filter\(\(item\) => item\.listing\.id !== listingId\) \?\? \[\]\);/,
  );
  assert.match(source, /await unsaveListing\(listingId\);/);
  assert.match(source, /setItems\(previous\);/);
  // The same recognition card Explore uses, already showing as saved.
  assert.match(source, /<ListingCard[\s\S]{0,200}saved[\s\S]{0,140}onSave=\{\(\) => void removeSaved\(item\.listing\.id\)\}/);
});

test("a note belongs to the card above it", () => {
  const source = screen();
  // Drawn as that card's foot — pulled up under it, its top edge removed — so
  // it reads as part of the card rather than as a second card.
  assert.match(source, /marginTop: -space\[2\],/);
  assert.match(source, /borderTopWidth: 0,/);
  assert.match(source, /Your note · /);
});

test("nothing yet, and the wait, each say the right thing", () => {
  const source = screen();
  assert.match(source, /title="Nothing saved yet"/);
  assert.match(source, /label="Explore homes"/);
  assert.match(source, /accessibilityLabel="Loading your shortlist"/);
});
