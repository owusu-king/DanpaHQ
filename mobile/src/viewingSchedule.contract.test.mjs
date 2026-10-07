/**
 * The tenant's viewings, read as where they have to be (owner, 2026-10-06).
 *
 * The next timed visit leads on its own card with the countdown and the one
 * thing to do there; then what waits on the tenant with its step on the row;
 * the rest of the schedule by day; the requests still waiting on a landlord;
 * and the past, folded. `standing()` is mirrored with web and decides every
 * word; these tests hold the layout's promises.
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

test("the next timed visit leads, and a request without a time never does", () => {
  const source = screen();
  assert.match(source, /const timed = upcoming\.filter\(\(row\) => row\.viewing\.confirmed_starts_at\);/);
  assert.match(source, /next: timed\[0\] \?\? null,/);
  assert.match(source, /waiting: upcoming\.filter\(\(row\) => !row\.viewing\.confirmed_starts_at\),/);
  assert.match(source, /\.sort\(\(a, b\) => bySoonest\(a\.viewing, b\.viewing\)\)/);
  const card = between(source, "function NextVisit(", "function VisitRow(");
  assert.match(card, /`UP NEXT · \$\{until\.toUpperCase\(\)\}`/);
  assert.match(card, /\{state\.callToAction \? \(/);
  assert.match(card, /<Image source=\{\{ uri: viewing\.photo_url \}\}/);
});

test("what waits on the tenant comes before the schedule, with its step on the row", () => {
  const source = screen();
  assert.match(source, /yours: rows\.filter\(\(row\) => row\.state\.group === "action"\),/);
  assert.match(source, /<GroupLabel count=\{lanes\.yours\.length\} tone=\{LATERITE\}>Needs you<\/GroupLabel>/);
  const row = between(source, "function VisitRow(", "function ScheduleSkeleton(");
  assert.match(row, /\{state\.callToAction && !past \? \(\s*<Acts>\s*<Act label=\{state\.callToAction\}/);
  // A visit with a time is green; one still waiting for a time is harmattan.
  assert.match(row, /viewing\.confirmed_starts_at \? KOLA_DEEP : HARMATTAN/);
  assert.match(source, />Coming up</);
  assert.match(source, />Waiting on a landlord</);
  assert.match(between(source, "function groupByDay(", "function countdown("), /whenLabel\(row\.viewing\.confirmed_starts_at\)/);
});

test("the past folds into one line", () => {
  const source = screen();
  assert.match(source, /title="Past"/);
  assert.match(source, /\{pastOpen \? \(/);
  assert.doesNotMatch(source, /<BottomSheet|<ListHead|<ChoiceRow|viewingFilters/);
});

test("loading, nothing yet and a failure each say the right thing", () => {
  const source = screen();
  assert.match(source, /accessibilityRole="progressbar" accessibilityLabel="Loading your viewings"/);
  assert.match(source, /<Empty\s+icon="calendar-outline"\s+title="No viewings yet"/);
  assert.match(source, /label="Explore homes" onPress=\{\(\) => router\.push\("\/\(app\)\/\(tabs\)\/explore" as never\)\}/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/viewing\/\[id\]", params: \{ id: viewing\.id \} \}\)/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
});
