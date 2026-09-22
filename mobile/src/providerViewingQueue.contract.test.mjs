/**
 * A host's Viewings, refined on review (2026-09-15).
 *
 * Today leads — visits in hand, what needs the host, when the next one is and how
 * many wait on a tenant. Then one virtualised queue in the order it is worked:
 * what needs action, what is coming by day, and the latest of what is done. One
 * green Filter and a search replace the three tabs. These tests hold what a row
 * tells the host, not only where it sits.
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
const screen = () => code(read("app/(app)/provider-viewings.tsx"));

test("today leads: visits in hand, what needs the host, the next visit and who is waiting", () => {
  const source = screen();
  assert.match(
    source,
    /const visitsToday = all\.filter\(\(item\) => item\.confirmed_starts_at && \["confirmed", "checked_in"\]\.includes\(item\.status\)\s*&& dayKeyOf\(new Date\(item\.confirmed_starts_at\)\) === today\)\.length;/,
  );
  assert.match(source, /\.filter\(\(item\) => item\.status === "confirmed" && item\.confirmed_starts_at && new Date\(item\.confirmed_starts_at\)\.getTime\(\) >= Date\.now\(\) - 60 \* 60 \* 1000\)/);
  assert.match(source, /const waiting = all\.filter\(\(item\) => item\.status === "offered"\)\.length;/);
  assert.match(source, /<SummaryPanel\s+label="Visits today"\s+value=\{String\(visitsToday\)\}/);
  assert.match(source, /note=\{counts\.action \? \{ text: `\$\{counts\.action\} \$\{counts\.action === 1 \? "needs" : "need"\} action`, tone: "alert" \} : \{ text: "Nothing needs you", tone: "calm" \}\}/);
  assert.match(source, /\{ label: "Next visit", value: next\?\.confirmed_starts_at \? nextVisitLabel\(next\.confirmed_starts_at, density\.veryCompact\) : "None booked" \},\s*\{ label: "Waiting for tenant", value: String\(waiting\) \},/);

  // The next visit is a figure that is never cut: a time today, and a weekday on the narrowest phones.
  const label = between(source, "function nextVisitLabel(", "const styles = StyleSheet.create(");
  assert.match(label, /if \(day === "Today"\) return time;/);
  assert.match(label, /if \(day === "Tomorrow" && !compact\) return `\$\{day\} \$\{time\}`;/);
  assert.match(label, /return `\$\{new Date\(iso\)\.toLocaleDateString\("en-GH", \{ weekday: "short" \}\)\} \$\{time\}`;/);
});

test("one queue in the order a host works it, under one green Filter", () => {
  const source = screen();
  const entries = between(source, "function entriesFor(", "function ViewingRow(");

  assert.match(source, /<FlatList\s+ref=\{list\}\s+data=\{entries\}/);
  assert.doesNotMatch(source, /accessibilityRole="tab"|accessibilityRole="tablist"|function ViewingTab\(/);
  assert.match(source, /const \[view, setView\] = useState<Show>\("all"\);/);
  assert.match(source, /<ListHead title=\{TITLE\[view\]\} count=\{visible\.length\} filters=\{view === "all" \? 0 : 1\} filterTone="kola" onFilter=\{\(\) => setFiltering\(true\)\} \/>/);
  assert.match(source, /<SearchField label="Search viewings" placeholder="Tenant, Property or location" value=\{query\} onChangeText=\{setQuery\} \/>/);

  // Needs action, then Upcoming by day, then the latest of History.
  assert.match(entries, /for \(const view of show === "all" \? \(\["action", "upcoming", "history"\] as const\) : \[show\]\)/);
  assert.match(entries, /tone: view === "action" \? LATERITE : undefined/);
  assert.match(entries, /if \(view === "upcoming"\) \{\s*for \(const \[day, visits\] of byDay\(group\)\) \{\s*out\.push\(\{ kind: "day", key: `day:\$\{day\}`, title: dayTitle\(day\) \}\);/);
  assert.match(source, /const HISTORY_SHOWN = 3;/);
  assert.match(entries, /view === "history" && show === "all" && group\.length > HISTORY_SHOWN/);
  assert.match(entries, /frame\(group\.slice\(0, HISTORY_SHOWN\), view, true\);\s*out\.push\(\{ kind: "more", key: "more:history", count: group\.length \}\);/);
  assert.match(source, /<ViewAll count=\{entry\.count\} noun="in history" onPress=\{\(\) => choose\("history"\)\} \/>/);
  assert.match(source, /const key = viewing\.confirmed_starts_at \? dayKeyOf\(new Date\(viewing\.confirmed_starts_at\)\) : "open";/);
  assert.match(source, /\(a === "open" \? 1 : b === "open" \? -1 : a\.localeCompare\(b\)\)/);
  assert.match(between(source, "function dayTitle(", "function nextVisitLabel("), /if \(day === "open"\) return "Times offered";[\s\S]*return "Today";[\s\S]*return "Tomorrow";/);

  // The sheet: every view with its count, closing on what it will show.
  for (const [label, value] of [["All viewings", "all"], ["Needs action", "action"], ["Upcoming", "upcoming"], ["History", "history"]]) {
    assert.match(source, new RegExp(`label="${label}" count=\\{counts\\.${value}\\} selected=\\{view === "${value}"\\} onPress=\\{\\(\\) => choose\\("${value}"\\)\\}`), label);
  }
  assert.match(source, /onReset=\{\(\) => \{ choose\("all"\); setQuery\(""\); \}\}/);
  assert.match(source, /results=\{visible\.length\}/);
  assert.match(source, /const choose = \(next: Show\) => \{\s*setView\(next\);\s*list\.current\?\.scrollToOffset\(\{ offset: 0, animated: false \}\);\s*\};/);
});

test("a row says who, how it stands, where, and the one detail that matters", () => {
  const source = screen();
  const row = between(source, "function ViewingRow(", "function QueueEmpty(");

  assert.match(row, /accessibilityLabel=\{`\$\{viewing\.tenant_name\}\. \$\{viewing\.listing_headline\}\. \$\{summary\.label\}\. \$\{viewingMoment\(viewing\)\}\. Open viewing\.`\}/);
  assert.match(row, /end=\{<Type variant="caption" numberOfLines=\{1\} style=\{\[rowStyles\.rowStatus, \{ color: tone\.text \}\]\}>\{summary\.label\}<\/Type>\}/);
  assert.match(row, /const detail = \[placeOf\(viewing\), viewingDetail\(viewing\)\]\.filter\(Boolean\)\.join\(" · "\);/);
  // On the narrowest phones the name keeps its whole line and the status moves under it.
  assert.match(source, /<ViewingRow viewing=\{entry\.viewing\} narrow=\{density\.veryCompact\} onPress=\{\(\) => open\(entry\.viewing\)\} \/>/);
  assert.match(row, /\{narrow \? <Type variant="caption" style=\{\[rowStyles\.rowStatus, \{ color: tone\.text \}\]\}>\{`\$\{summary\.label\}\$\{detail \? " · " : ""\}`\}<\/Type> : null\}/);

  // The tile: the time of a visit in hand, the date of one that is done.
  const tile = between(source, "function timeTile(", "function viewingSort(");
  assert.match(tile, /if \(viewingView\(viewing\) === "history"\) \{\s*return \{ top: String\(at\.getDate\(\)\), bottom: at\.toLocaleDateString\("en-GH", \{ month: "short" \}\)\.toUpperCase\(\) \};/);
  assert.match(tile, /\.toLocaleTimeString\("en-GH", \{ hour: "numeric", minute: "2-digit" \}\)\.split\(" "\);/);
  const detail = between(source, "function viewingDetail(", "function timeTile(");
  assert.match(detail, /if \(viewing\.confirmed_starts_at\) return "";/);
  assert.match(detail, /if \(viewing\.status === "requested"\) return `Asked \$\{timeAgo\(viewing\.created_at\)\}`;/);

  // What waits on the host is laterite; somebody else, harmattan; a visit in hand, kola.
  const summary = between(source, "function viewingSummary(", "function viewingMoment(");
  for (const line of [
    /viewing\.status === "requested"\) return \{ label: "Needs a reply", tone: "attention"/,
    /viewing\.status === "offered"\) return \{ label: "Waiting for tenant", tone: "waiting"/,
    /viewing\.status === "confirmed" && viewing\.check_in\.can_validate\) return \{ label: "Ready for check-in", tone: "attention"/,
    /viewing\.status === "checked_in"\) return \{ label: "Checked in", tone: "attention"/,
    /viewing\.status === "attendance_pending" && viewing\.attendance\.can_respond\) return \{ label: "Response needed", tone: "attention"/,
  ]) {
    assert.match(summary, line);
  }
  assert.match(source, /attention: \{ text: LATERITE, ink: LATERITE, wash: theme\.color\.laterite\["100"\] \},/);
  assert.match(source, /waiting: \{ text: HARMATTAN, ink: HARMATTAN, wash: theme\.color\.harmattan\["100"\] \},/);

  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/provider-viewing", params: \{ viewingId: viewing\.id \} \} as never\);/);
  assert.match(
    between(source, "function viewingView(", "function viewingSummary("),
    /viewing\.status === "requested" \|\|\s*viewing\.status === "checked_in" \|\|\s*\(viewing\.status === "attendance_pending" && viewing\.attendance\.can_respond\) \|\|\s*\(viewing\.status === "confirmed" && viewing\.check_in\.can_validate\)\s*\) return "action";/,
  );
});

test("the Portfolio on screen, loading, nothing yet and a failure are each handled", () => {
  const source = screen();
  assert.match(source, /setItems\(null\);\s*try \{\s*setItems\(\s*await listReceivedViewings\(false, preferred \? \{ organization: preferred \} : undefined\),/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /ListEmptyComponent=\{items === null \? <QueueSkeleton \/> : error \? null : \(/);
  assert.match(between(source, "function QueueSkeleton(", "function viewingView("), /accessibilityRole="progressbar" accessibilityLabel="Loading viewings"/);

  const empty = between(source, "function QueueEmpty(", "function QueueSkeleton(");
  assert.match(empty, /if \(searching\) return <EmptyState icon="search-outline" title="No matching viewings"/);
  assert.match(empty, /hero\s+title="No viewings yet"/);
  assert.match(empty, /label="Your Properties" onPress=\{onProperties\}/);
  assert.match(empty, /action=\{upcoming \? <View style=\{styles\.emptyAction\}><QuietAction icon="calendar-outline" label="Upcoming visits" onPress=\{onUpcoming\} \/><\/View> : undefined\}/);
  assert.match(source, /onUpcoming=\{\(\) => choose\("upcoming"\)\}/);
  assert.match(source, /onProperties=\{\(\) => router\.push\("\/\(app\)\/\(provider-tabs\)\/properties" as never\)\}/);
});
