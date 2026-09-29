import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile Updates is a grouped, semantic communication centre", () => {
  const screen = read("mobile/app/(app)/notifications.tsx");

  assert.match(screen, /SectionList/);
  assert.match(screen, /Action needed/);
  assert.match(screen, /needsYou/);
  assert.match(screen, /notificationCategory/);
  assert.match(screen, /notificationSource/);
  assert.match(screen, /notificationStatus/);
  assert.match(screen, /notificationTone/);
  assert.match(screen, /Needs your attention/);
  assert.match(screen, /This week/);
  assert.match(screen, /accessibilityRole="toolbar"/);
  assert.doesNotMatch(screen, /Your inbox/);
  assert.doesNotMatch(screen, /accessibilityRole="summary"/);
});

test("no notification is a dead tap any more", () => {
  const meaning = read("mobile/src/notificationMeaning.ts");
  const screen = read("mobile/app/(app)/notifications.tsx");

  // Three of the seven emitted target types used to fall off the end of an
  // if-chain: the row marked itself read and moved you nowhere.
  for (const target of ["organization", "portfolio_invitation", "property_join_request"]) {
    assert.match(meaning, new RegExp(`case "${target}"`));
  }
  assert.doesNotMatch(meaning, /case "listing"/);
  assert.match(screen, /destination\(item, isProvider\)/);
  assert.doesNotMatch(screen, /else if \(item\.target_type/);
});

test("the feed is rows, and unread does not depend on colour", () => {
  const screen = read("mobile/app/(app)/notifications.tsx");

  assert.doesNotMatch(screen, /<Surface/);
  assert.match(screen, /borderLeftWidth: 3/);
  assert.match(screen, /notificationStatus\(item\)/);
  assert.match(screen, /accessibilityLabel=.*notificationSource/s);
  assert.match(screen, /tonePalette/);
});

test("opening an update does not wait for the read acknowledgement", () => {
  const screen = read("mobile/app/(app)/notifications.tsx");

  assert.match(screen, /void markRead\(\[item\.id\]\)\.catch/);
  assert.match(screen, /router\.push\(destination\(item, isProvider\)/);
});

test("mobile Updates presents ten records per page", () => {
  const screen = read("mobile/app/(app)/notifications.tsx");

  assert.match(screen, /const PAGE_SIZE = 10/);
  assert.match(screen, /orderedVisible\.slice\(\(currentPage - 1\) \* PAGE_SIZE, currentPage \* PAGE_SIZE\)/);
  assert.match(screen, /\.\.\.visible\.filter\(needsYou\)/);
  assert.match(screen, /function MobilePagination/);
  assert.match(screen, /accessibilityLabel="Updates pages"/);
});

test("Explore keeps one search bar and one Filters button over the map, and every filter in a bottom sheet", () => {
  const search = read("mobile/app/(app)/search.tsx");

  const hero = read("mobile/src/components/explore/ExploreHero.tsx");
  // Two controls, not a rail: pills and chips crowded a phone's map, and every
  // one of them is in the sheet already. They live in the Explore hero now,
  // shared by Rent and Buy (owner, 2026-09-29).
  assert.match(search, /<ExploreHero\b/);
  assert.match(search, /<HeroSearch\b/);
  assert.match(hero, /function FiltersButton/);
  assert.match(hero, /export function HeroSearch/);
  assert.doesNotMatch(search, /accessibilityRole="toolbar"|function CompactFilter|function ActiveFilter/);
  // All has no filters of its own; Rent and Buy each open theirs (owner, 2026-09-29).
  assert.match(search, /onFilters=\{mode === "all" \? undefined : \(\) => \{ Keyboard\.dismiss\(\); setFiltersOpen\(true\); \}\}/);
  // Each question is one row — a rent range, dropdowns, a segmented choice and a
  // switch; see filterFields.contract.test.mjs.
  assert.match(search, /<PriceRange\n/);
  assert.match(search, /<SelectField\s+label="Property type"/);
  assert.match(search, /function FilterSheet/);
  // The shared sheet a thumb can swipe away; see bottomSheet.contract.test.mjs.
  assert.match(search, /<BottomSheet\s+visible=\{visible\}\s+onClose=\{onClose\}\s+title="Filters"/);
  assert.match(search, /resultLabel/);
  assert.match(read("mobile/src/components/filters/FilterFields.tsx"), /accessibilityRole="radio"/);
  assert.match(search, /q: area \? undefined : place\.trim\(\) \|\| undefined/);
  assert.doesNotMatch(search, /presentationStyle=/);
});

test("Explore on the phone shows each choice once, and turning one on moves nothing", () => {
  const search = read("mobile/app/(app)/search.tsx");
  const fields = read("mobile/src/components/filters/FilterFields.tsx");

  const hero = read("mobile/src/components/explore/ExploreHero.tsx");
  // The button counts the refinements, and names the count for a screen reader.
  const button = hero.slice(hero.indexOf("function FiltersButton("), hero.indexOf("export function HeroSearch("));
  assert.match(button, /accessibilityLabel=\{count \? `Filters, \$\{count\} active` : "Filters"\}/);
  assert.match(search, /filterCount=\{mode === "all" \? undefined : filterCountForSide\}/);
  assert.match(search, /const filterCountForSide = mode === "buy" \? saleRefinements\(saleChoices\) : refinementCount;/);

  // The one Clear all sits beside the count it changes.
  const results = hero.slice(hero.indexOf("export function ExploreResults("));
  assert.match(results, /accessibilityLiveRegion="polite"/);
  assert.match(results, /accessibilityLabel="Clear all filters"/);
  // Each side clears its own filters; All has none to clear.
  assert.match(search, /: mode === "rent" && refinementCount \? clearFilters : undefined\}/);
  assert.match(search, /saleRefinements\(saleChoices\) \? \(\) => setSaleChoices\(NO_SALE_CHOICES\) : undefined/);

  // Furnished is the platform switch, and the row owns the touch.
  assert.match(fields, /<View pointerEvents="none"[^>]*>\s*<Switch\s+value=\{value\}/);

  // A choice changes colour, never size: every segment keeps its one-point edge.
  assert.match(fields, /segment: \{[^}]*borderWidth: 1,[^}]*borderColor: "transparent",/);
  assert.doesNotMatch(fields, /(segmentChosen|selectChosen|selectOpen): \{[^}]*borderWidth/);

  // The search bar's ring is drawn behind it; its border never thickens.
  const box = hero.slice(hero.indexOf("export function HeroSearch("), hero.indexOf("export function ExploreResults("));
  assert.match(box, /style=\{styles\.ring\}/);
  assert.doesNotMatch(box, /borderWidth: focused/);
  assert.match(box, /clearButtonMode="never"/);

  // One title per sheet, and the same word for results everywhere.
  assert.doesNotMatch(search, /REFINE YOUR SEARCH/);
  assert.doesNotMatch(search, /homes/);
});
