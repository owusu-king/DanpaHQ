/**
 * The tenant's Applications, refined on review (2026-09-15).
 *
 * Glass groups instead of a tab strip, one green Filter, a row that draws how far
 * its journey has come above the one line that says it in words, and the
 * agreement one tap away once it is ready — beside the row, so the row still
 * opens the application. The past shows its latest few. The web contracts still
 * hold the row's words and the mirrored meaning; these hold the layout's promises.
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
const screen = () => code(read("app/(app)/applications.tsx"));

test("one green Filter over Needs you, In progress, Approved and Past", () => {
  const source = screen();
  assert.match(source, /const FILTER_TITLE: Record<ApplicationFilter, string> = \{\s*all: "All applications",\s*action: "Needs you",\s*open: "In progress",\s*approved: "Approved",\s*past: "Past",\s*\};/);
  let at = -1;
  for (const id of ["action", "open", "approved", "past"]) {
    const found = source.indexOf(`{ id: "${id}", label: FILTER_TITLE.${id}, rows: rows.filter((row) => row.bucket === "${id}") },`);
    assert.notEqual(found, -1, `the ${id} group is missing`);
    assert.ok(found > at, `the ${id} group is out of order`);
    at = found;
  }
  assert.match(source, /state: standing\(application, leases\),\s*bucket: applicationBucket\(application, leases\),/);

  assert.doesNotMatch(source, /accessibilityRole="tab"|accessibilityRole="tablist"|function ApplicationFilters\(/);
  assert.match(source, /<ListHead title=\{FILTER_TITLE\[filter\]\} count=\{counts\[filter\]\} filters=\{filter === "all" \? 0 : 1\} filterTone="kola" onFilter=\{\(\) => setFiltering\(true\)\} \/>/);
  assert.match(source, /\{filter === "all" \? \(\s*<GroupLabel count=\{section\.rows\.length\} tone=\{section\.id === "action" \? KOLA_DEEP : undefined\}>\{section\.label\}<\/GroupLabel>/);

  assert.equal((source.match(/<BottomSheet/g) ?? []).length, 1, "the Filter is the page's one sheet");
  assert.match(source, /<BottomSheet\s+visible=\{filtering\}\s+onClose=\{\(\) => setFiltering\(false\)\}\s+title="Filter"\s+hideTitle\s+closeLabel="Close filter"/);
  assert.match(source, /\{applicationFilters\.map\(\(option, index\) => \(/);
  assert.match(source, /count=\{counts\[option\.id\]\}/);
  assert.match(source, /onPress=\{\(\) => choose\(option\.id\)\}/);
  assert.match(source, /results=\{counts\[filter\]\}/);
  assert.match(source, /onReset=\{\(\) => choose\("all"\)\}/);
});

test("a row draws how far its journey has come, and says where it stands in words", () => {
  const source = screen();
  const row = between(source, "function Row(", "function Journey(");
  const journey = between(source, "function Journey(", "const styles = StyleSheet.create(");

  assert.match(source, /steps=\{timeline\(row\.application, leases\)\}/);
  assert.match(row, /<Thumb uri=\{application\.photo_url\} size=\{64\} \/>/);
  assert.match(row, /<Type variant="bodyStrong" numberOfLines=\{2\} style=\{rowStyles\.rowTitle\}>\{application\.listing_headline\}<\/Type>/);
  assert.match(row, /<Type variant="caption" numberOfLines=\{2\} style=\{rowStyles\.rowSub\}>\{placeOf\(application\)\}<\/Type>/);
  // The rent only when there is one: never a lone "/ month".
  assert.match(row, /\{application\.rent_formatted \? \(\s*<Type variant="caption" numberOfLines=\{1\} style=\{rowStyles\.rowMeta\}>\s*<Type variant="bodyStrong" style=\{rowStyles\.rowAmount\}>\{application\.rent_formatted\}<\/Type>\s*\{" \/ month"\}/);
  assert.match(row, /<Journey steps=\{steps\} stage=\{state\.stage\} \/>\s*<StandingLine standing=\{state\} trailing=\{timeAgo\(application\.created_at\)\} \/>/);
  assert.match(row, /const short = shortfallNote\(application\);/);
  assert.match(row, /\{short \? <Type variant="caption" style=\{styles\.short\}>\{short\}<\/Type> : null\}/);
  assert.match(row, /accessibilityLabel=\{`\$\{application\.listing_headline\}\. \$\{placeOf\(application\)\}\. \$\{state\.line\}\. Applied \$\{timeAgo\(application\.created_at\)\}\.`\}/);

  // One segment per step, in the standing dot's colour while it moves, laterite
  // where it stopped — and hidden from a screen reader, which hears the line.
  assert.match(journey, /done: KOLA,\s*current: stage === "action" \? KOLA : HARMATTAN,\s*waiting: alpha\(INK, 0\.1\),\s*stopped: LATERITE,/);
  assert.match(journey, /<View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style=\{styles\.journey\}>/);
  assert.match(journey, /\{steps\.map\(\(step\) => \(\s*<View key=\{step\.id\} style=\{\[styles\.segment, \{ backgroundColor: tone\[step\.state\] \}\]\} \/>/);
});

test("an agreement waiting is one tap away, beside the row rather than inside it", () => {
  const source = screen();
  const row = between(source, "function Row(", "function Journey(");
  assert.match(row, /const agreement = state\.stage === "action" \? state\.leaseId : null;/);
  // The row's own button closes before the agreement's opens: two buttons, never one inside the other.
  assert.match(row, /<\/Pressable>\s*\{agreement \? \(\s*<Pressable\s+accessibilityRole="button"\s+accessibilityLabel=\{`Review the agreement for \$\{application\.listing_headline\}`\}\s+onPress=\{\(\) => onAgreement\(agreement\)\}/);
  assert.match(row, />Review the agreement<\/Type>/);
  assert.match(source, /const review = \(leaseId: string\) =>\s*router\.push\(\{ pathname: "\/\(app\)\/agreement\/\[id\]", params: \{ id: leaseId \} \}\);/);
  assert.match(source, /onAgreement=\{review\}/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/application\/\[id\]", params: \{ id: application\.id \} \}\);/);
});

test("the past shows its latest few, and View all turns the Filter to it", () => {
  const source = screen();
  assert.match(source, /const PAST_SHOWN = 3;/);
  assert.match(source, /const cut = section\.id === "past" && filter === "all" && section\.rows\.length > PAST_SHOWN;/);
  assert.match(source, /const shown = cut \? section\.rows\.slice\(0, PAST_SHOWN\) : section\.rows;/);
  assert.match(source, /\{cut \? <ViewAll count=\{section\.rows\.length\} noun="past applications" onPress=\{\(\) => choose\("past"\)\} \/> : null\}/);
  assert.match(source, /const choose = \(next: ApplicationFilter\) => \{\s*setFilter\(next\);\s*scroll\.current\?\.scrollTo\(\{ y: 0, animated: false \}\);\s*\};/);
  assert.match(source, /<ScrollView\s+ref=\{scroll\}/);
});

test("loading, nothing yet, a failure and an empty filter each say the right thing", () => {
  const source = screen();
  assert.match(source, /listMyApplications\(\),\s*listMyLeases\(\)\.catch\(\(\) => \[\] as Lease\[\]\),/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /\{items === null \? \(\s*<ApplicationSkeleton \/>/);
  assert.match(between(source, "function ApplicationSkeleton(", "function Row("), /<View accessibilityRole="progressbar" accessibilityLabel="Loading your applications"/);
  assert.match(source, /: items\.length === 0 \? \(\s*error \? null : \(\s*<EmptyState\s+icon="document-text-outline"\s+hero\s+title="No applications yet"/);
  assert.match(source, /label="Explore homes" onPress=\{\(\) => router\.push\("\/\(app\)\/\(tabs\)\/explore" as never\)\}/);
  assert.match(source, /<EmptyState icon=\{FILTER_ICON\[filter\]\} title=\{EMPTY\[filter\]\.title\} hint=\{EMPTY\[filter\]\.hint\} \/>/);
});
