/**
 * Updates, refined on review (2026-09-15).
 *
 * The feed stands on the hub ground as glass, and the rail of filter chips became
 * one toolbar: what is showing and how many, Read all, and one green Filter whose
 * sheet holds the same vocabulary with its counts. It is still a log — attention
 * first, then the timeline, ten to a page, no summary card, and the shell's title
 * not repeated. `updatesWorkspace.contract.test.mjs` keeps the older promises;
 * these hold the refinement's.
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
const screen = () => code(read("app/(app)/notifications.tsx"));

test("one toolbar says what is showing, marks everything read and opens the one Filter", () => {
  const source = screen();
  const toolbar = between(source, "accessibilityRole=\"toolbar\" accessibilityLabel=\"Filter updates\"", "renderSectionHeader=");

  assert.doesNotMatch(source, /horizontal|<ScrollView|function FilterButton\(/);
  assert.match(toolbar, /\{view === "all" \|\| view === "unread" \|\| view === "action" \? VIEW_TITLE\[view\] : CATEGORY_LABEL\[view\]\}/);
  assert.match(source, /all: "All",\s*unread: "Unread",\s*action: "Action needed",/);
  assert.match(toolbar, /<Type variant="caption" style=\{styles\.toolbarCount\}>\{visible\.length\}<\/Type>/);
  assert.match(toolbar, /\{unread > 0 \? \(\s*<Pressable\s+onPress=\{\(\) => void markAllRead\(\)\}\s+disabled=\{markingAll\}/);
  assert.match(toolbar, /accessibilityLabel="Mark all updates as read"/);
  // On the narrowest phones Read all keeps its glyph and its name for a screen reader.
  assert.match(toolbar, /\{density\.veryCompact \? null : <Type variant="captionStrong" style=\{styles\.readAllText\}>Read all<\/Type>\}/);
  assert.match(toolbar, /<FilterButton count=\{view === "all" \? 0 : 1\} tone="kola" onPress=\{\(\) => setFiltering\(true\)\} \/>/);
});

test("the sheet holds the same vocabulary, and a topic with nothing in it takes no line", () => {
  const source = screen();
  assert.match(source, /<BottomSheet\s+visible=\{filtering\}\s+onClose=\{\(\) => setFiltering\(false\)\}\s+title="Filter"\s+hideTitle\s+closeLabel="Close filter"/);
  assert.match(source, /label="All" count=\{items\?\.length \?\? 0\} selected=\{view === "all"\} onPress=\{\(\) => selectView\("all"\)\}/);
  assert.match(source, /label="Unread" count=\{counts\.unread\} selected=\{view === "unread"\} onPress=\{\(\) => selectView\("unread"\)\}/);
  assert.match(source, /label="Action needed" count=\{counts\.action\} selected=\{view === "action"\} onPress=\{\(\) => selectView\("action"\)\}/);
  assert.match(source, /const topics = \(Object\.keys\(CATEGORY_LABEL\) as NotificationCategory\[\]\)\.filter\(\(category\) => counts\[category\] > 0\);/);
  assert.match(source, /\{topics\.length \? \(\s*<FilterGroup title="Topic">\s*\{topics\.map\(\(category, index\) => \(/);
  assert.match(source, /count=\{counts\[category\]\}\s*selected=\{view === category\}\s*onPress=\{\(\) => selectView\(category\)\}/);
  assert.match(source, /canReset=\{view !== "all"\}\s*onReset=\{\(\) => selectView\("all"\)\}\s*results=\{visible\.length\}/);
  assert.match(source, /function selectView\(next: Filter\) \{\s*setView\(next\);\s*setPage\(1\);\s*\}/);
});

test("still a log: attention first, the timeline after, ten to a page, and no summary card", () => {
  const source = screen();
  assert.doesNotMatch(source, /SummaryPanel|FigureGrid/);
  assert.doesNotMatch(source, />\s*Updates\s*</);
  assert.match(source, /<IndexGround>\s*<SectionList/);
  assert.match(source, /const sections = useMemo\(\(\) => groupUpdates\(paged, view === "all"\), \[paged, view\]\);/);
  assert.match(source, /if \(action\.length\) groups\.push\(\{ key: "attention", title: "Needs your attention", urgent: true, data: action \}\);/);
  assert.match(source, /<GroupLabel count=\{section\.data\.length\} tone=\{section\.urgent \? LATERITE : undefined\}>\{section\.title\}<\/GroupLabel>/);
  assert.match(source, /ListFooterComponent=\{visible\.length > PAGE_SIZE \? \(\s*<MobilePagination/);
  assert.match(between(source, "function MobilePagination(", "function PageButton("), /<Type variant="captionStrong" style=\{styles\.pageNumber\}>\{page\} \/ \{pages\}<\/Type>/);
  assert.match(source, /pagination: \{[^}]*borderRadius: PANEL_RADIUS,[^}]*backgroundColor: GLASS,/);
});

test("an update says where it came from, what happened and how it stands; unread is a rule", () => {
  const source = screen();
  const row = between(source, "function UpdateRow(", "function UpdatesSkeleton(");

  assert.match(row, /!item\.is_read && \{ borderLeftColor: palette\.fg, backgroundColor: palette\.wash \}/);
  assert.match(source, /row: \{[^}]*borderLeftWidth: 3,\s*borderLeftColor: "transparent",/);
  assert.match(row, /<Type variant=\{item\.is_read \? "body" : "bodyStrong"\} style=\{styles\.title\}>\{item\.title\}<\/Type>/);
  assert.match(row, /\{notificationSource\(item\.kind\)\.toUpperCase\(\)\}/);
  assert.match(row, /<Type variant="captionStrong" style=\{\[styles\.status, \{ color: palette\.fg \}\]\}>\{notificationStatus\(item\)\}<\/Type>/);
  assert.match(row, /\{actionable \? \(\s*<View style=\{styles\.review\}>\s*<Type variant="captionStrong" style=\{styles\.reviewText\}>Review now<\/Type>/);
  assert.match(row, /const actionable = needsYou\(item\);/);
  // The separator is drawn over the row, so an unread rule runs unbroken down a group.
  assert.match(source, /<UpdateRow item=\{item\} onPress=\{\(\) => open\(item\)\} \/>\s*\{\s*\}\s*\{index === 0 \? null : <View pointerEvents="none" style=\{styles\.rule\} \/>\}/);
  assert.match(source, /rule: \{\s*position: "absolute",\s*top: 0,\s*left: 14,/);
  // Every tone keeps its ink and well; the unread wash is faint glass, not a solid ground.
  assert.match(between(source, "function tonePalette(", "function groupUpdates("), /critical: \{ fg: theme\.color\.laterite\["600"\], bg: theme\.color\.laterite\["100"\], wash: alpha\(theme\.color\.laterite\["600"\], 0\.05\) \},/);
});

test("opening one navigates at once; loading, nothing yet and a failure each say the right thing", () => {
  const source = screen();
  const open = between(source, "function open(item: Notification) {", "async function markAllRead(");
  assert.match(open, /setItems\(\(current\) => current\?\.map\(\(row\) => row\.id === item\.id \? \{ \.\.\.row, is_read: true \} : row\) \?\? null\);/);
  assert.match(open, /void markRead\(\[item\.id\]\)\.catch\(\(\) => void load\(\)\);/);
  assert.match(open, /router\.push\(destination\(item, isProvider\) as never\);/);

  assert.match(source, /items === null \? \(\s*<UpdatesSkeleton \/>\s*\) : error \? null : items\.length === 0 \? \(\s*<EmptyState\s+icon="notifications-outline"\s+hero\s+title="Nothing here yet"/);
  assert.match(source, /title=\{view === "action" \? "Nothing needs your attention" : "Nothing in this view"\}/);
  assert.match(between(source, "function UpdatesSkeleton(", "function iconFor("), /accessibilityRole="progressbar" accessibilityLabel="Loading updates"/);
  assert.match(source, /refreshControl=\{\(\s*<RefreshControl/);
});
