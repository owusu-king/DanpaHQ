/**
 * The tenant's Viewings schedule, refined on review (2026-09-15).
 *
 * The very next visit leads as a card with its photograph and its day, because it
 * is what somebody opened the page to check. The rest of the schedule is one
 * glass list per group, in the order the brief set — Upcoming, Needs you, Past —
 * under one green Filter; the past shows its latest few, and "View all" turns the
 * Filter to it. The web contracts still hold the row's words and the mirrored
 * meaning; these hold the layout's promises.
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
const screen = () => code(read("app/(app)/viewings.tsx"));

test("the next timed visit leads as a card, and a request without a time never does", () => {
  const source = screen();
  const card = between(source, "function NextVisit(", "function ScheduleRow(");

  assert.match(source, /rows: rows\s*\.filter\(\(row\) => row\.state\.group === "upcoming"\)\s*\.sort\(\(a, b\) => bySoonest\(a\.viewing, b\.viewing\)\),/);
  assert.match(source, /const lead = section\.id === "upcoming" && section\.rows\[0\]\?\.viewing\.confirmed_starts_at \? section\.rows\[0\] : null;/);
  assert.match(source, /const rest = lead \? section\.rows\.slice\(1\) : section\.rows;/);
  assert.match(source, /\{lead \? <NextVisit viewing=\{lead\.viewing\} state=\{lead\.state\} onPress=\{\(\) => open\(lead\.viewing\)\} \/> : null\}/);

  // The photograph with the day on it, then the time as the largest words.
  assert.match(card, /\{viewing\.photo_url \? \(\s*<Image source=\{\{ uri: viewing\.photo_url \}\} accessible=\{false\} resizeMode="cover" style=\{styles\.coverImage\} \/>/);
  assert.match(card, /const day = dayTile\(viewing\.confirmed_starts_at\);/);
  assert.match(card, /\{day \? \(\s*<View style=\{styles\.tile\}>\s*<Type variant="label" style=\{styles\.tileMonth\}>\{day\.month\}<\/Type>\s*<Type variant="bodyStrong" style=\{styles\.tileDay\}>\{day\.date\}<\/Type>/);
  assert.match(card, /<Type variant="title2" numberOfLines=\{1\} adjustsFontSizeToFit minimumFontScale=\{0\.85\} style=\{styles\.cardWhen\}>\{when\}<\/Type>/);
  assert.match(card, /accessibilityLabel=\{`\$\{viewing\.listing_headline\}\. \$\{placeOf\(viewing\)\}\. \$\{when \?\? state\.line\}\. \$\{state\.callToAction \?\? "View details"\}\.`\}/);
  assert.match(card, /<Standing state=\{state\} \/>/);
  assert.match(source, /month: at\.toLocaleDateString\("en-GH", \{ month: "short" \}\)\.toUpperCase\(\),\s*date: String\(at\.getDate\(\)\),/);
});

test("the schedule is grouped Upcoming, Needs you, Past, under one green Filter", () => {
  const source = screen();
  assert.match(source, /const FILTER_TITLE: Record<ViewingFilter, string> = \{\s*all: "All viewings",\s*upcoming: "Upcoming",\s*action: "Needs you",\s*past: "Past",\s*\};/);
  const upcoming = source.indexOf('id: "upcoming"');
  const action = source.indexOf('id: "action"');
  const past = source.indexOf('id: "past"');
  assert.ok(upcoming !== -1 && upcoming < action && action < past, "Upcoming, then Needs you, then Past");

  assert.doesNotMatch(source, /accessibilityRole="tab"|accessibilityRole="tablist"|function ViewingFilters\(/);
  assert.match(source, /<ListHead title=\{FILTER_TITLE\[filter\]\} count=\{counts\[filter\]\} filters=\{filter === "all" \? 0 : 1\} filterTone="kola" onFilter=\{\(\) => setFiltering\(true\)\} \/>/);
  assert.match(source, /\{filter === "all" \? \(\s*<GroupLabel count=\{section\.rows\.length\} tone=\{section\.id === "action" \? KOLA_DEEP : undefined\}>\{section\.label\}<\/GroupLabel>/);

  // The sheet: every filter with its count, closing on what it will show.
  assert.equal((source.match(/<BottomSheet/g) ?? []).length, 1, "the Filter is the page's one sheet");
  assert.match(source, /<BottomSheet\s+visible=\{filtering\}\s+onClose=\{\(\) => setFiltering\(false\)\}\s+title="Filter"\s+closeLabel="Close filter"/);
  assert.match(source, /\{viewingFilters\.map\(\(option, index\) => \(/);
  assert.match(source, /count=\{counts\[option\.id\]\}/);
  assert.match(source, /onPress=\{\(\) => choose\(option\.id\)\}/);
  assert.match(source, /results=\{counts\[filter\]\}/);
  assert.match(source, /onReset=\{\(\) => choose\("all"\)\}/);
});

test("the past shows its latest few, and View all turns the Filter to it", () => {
  const source = screen();
  assert.match(source, /const PAST_SHOWN = 3;/);
  assert.match(source, /const cut = section\.id === "past" && filter === "all" && rest\.length > PAST_SHOWN;/);
  assert.match(source, /const shown = cut \? rest\.slice\(0, PAST_SHOWN\) : rest;/);
  assert.match(source, /\{cut \? <ViewAll count=\{section\.rows\.length\} noun="past viewings" onPress=\{\(\) => choose\("past"\)\} \/> : null\}/);
  // A new filter starts at the top of what it shows.
  assert.match(source, /const choose = \(next: ViewingFilter\) => \{\s*setFilter\(next\);\s*scroll\.current\?\.scrollTo\(\{ y: 0, animated: false \}\);\s*\};/);
  assert.match(source, /<ScrollView\s+ref=\{scroll\}/);
});

test("a row says when, which place and where, and the one thing to do", () => {
  const source = screen();
  const row = between(source, "function ScheduleRow(", "function Standing(");
  const standing = between(source, "function Standing(", "function ScheduleSkeleton(");

  assert.match(row, /<Thumb uri=\{viewing\.photo_url\} \/>/);
  assert.match(row, /\{when \? \(\s*<Type variant="bodyStrong" numberOfLines=\{1\} style=\{\[styles\.rowWhen, state\.group === "past" \? \{ color: MUTED \} : null\]\}>\{when\}<\/Type>/);
  assert.match(row, /<Type variant="bodyStrong" numberOfLines=\{2\} style=\{when \? styles\.rowHeadline : rowStyles\.rowTitle\}>\{viewing\.listing_headline\}<\/Type>/);
  assert.match(row, /\{placeOf\(viewing\) \|\| "Ghana"\}/);
  assert.match(row, /<Standing state=\{state\} \/>/);
  assert.match(row, /accessibilityLabel=\{`\$\{viewing\.listing_headline\}\. \$\{placeOf\(viewing\)\}\. \$\{when \?\? state\.line\}\. \$\{state\.callToAction \?\? "View details"\}\.`\}/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/viewing\/\[id\]", params: \{ id: viewing\.id \} \}\);/);

  // What waits on the tenant is kola and solid; anything else to do is a soft pill.
  assert.match(standing, /const act = state\.group === "action";/);
  assert.match(standing, /<Type variant="captionStrong" style=\{\[styles\.standingText, \{ color: act \? KOLA_DEEP : MUTED \}\]\}>\{state\.line\}<\/Type>/);
  assert.match(standing, /\{state\.callToAction \? \(\s*<View style=\{\[styles\.act, act \? null : styles\.actQuiet\]\}>/);
  // And on a small phone the pill drops under the line rather than cutting it.
  assert.match(source, /standing: \{\s*flexDirection: "row",\s*flexWrap: "wrap",/);
  assert.match(source, /standingLine: \{\s*flexGrow: 1,\s*flexShrink: 1,\s*flexBasis: 110,/);
  assert.match(source, /act: \{\s*marginLeft: "auto",/);

  const kit = code(read("src/components/portfolio/PortfolioList.tsx"));
  const thumb = between(kit, "export function Thumb(", "export function FilterGroup(");
  assert.match(thumb, /<Image source=\{\{ uri \}\} accessible=\{false\} resizeMode="cover" style=\{styles\.thumbImage\} \/>/);
  assert.match(thumb, /<Ionicons name="image-outline" size=\{18\} color=\{CHEVRON\} \/>/);
});

test("loading, nothing yet, a failure and an empty filter each say the right thing", () => {
  const source = screen();
  assert.match(source, /setViewings\(await listMyViewings\(\)\);/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /\{viewings === null \? \(\s*<ScheduleSkeleton \/>/);
  assert.match(between(source, "function ScheduleSkeleton(", "function dayTile("), /accessibilityRole="progressbar" accessibilityLabel="Loading your viewings"/);
  // Nothing yet is said large, with the way to a place to see — and not after a failure.
  assert.match(source, /: viewings\.length === 0 \? \(\s*error \? null : \(\s*<EmptyState\s+icon="calendar-outline"\s+hero\s+title="No viewings yet"/);
  assert.match(source, /label="Explore homes" onPress=\{\(\) => router\.push\("\/\(app\)\/\(tabs\)\/explore" as never\)\}/);
  assert.match(source, /<EmptyState icon=\{FILTER_ICON\[filter\]\} title=\{EMPTY\[filter\]\.title\} hint=\{EMPTY\[filter\]\.hint\} \/>/);
});
