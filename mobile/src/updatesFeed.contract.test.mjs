/**
 * Updates, after the owner's call (2026-10-05): not a log.
 *
 * A reminder is deleted once read; activity keeps only the ten most recent;
 * management reads the full history in the audit log. So the screen is what is
 * new — what needs you first — then recent activity, with no filter sheet and
 * no pages. The feed keeps the review-era shape (2026-09-15): glass on the hub
 * ground, unread as a coloured rule, one toolbar with Read all, no summary card
 * and the shell's title not repeated. `updatesWorkspace.contract.test.mjs` keeps
 * the older promises; these hold this one's.
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

test("not a log: new first, then recent activity, with no filters and no pages", () => {
  const source = screen();
  assert.match(source, /title: "Needs your attention", urgent: true, data: waiting/);
  assert.match(source, /key: "new", title: "New", data: other/);
  assert.match(source, /title: "Recent activity"/);
  assert.doesNotMatch(source, /PAGE_SIZE|MobilePagination|<BottomSheet|FilterButton|selectView/);
  assert.doesNotMatch(source, /"This week"|"Earlier"|timeBucket/);
  assert.doesNotMatch(source, /SummaryPanel|FigureGrid/);
  assert.doesNotMatch(source, />\s*Updates\s*</);
  assert.match(source, /<IndexGround>\s*<SectionList/);
  assert.match(source, /<GroupLabel count=\{section\.data\.length\} tone=\{section\.urgent \? LATERITE : undefined\}>\{section\.title\}<\/GroupLabel>/);
});

test("a reminder leaves once read; only the ten most recent activities stay", () => {
  const source = screen();
  // The server says which a record is; the app never guesses from the kind.
  assert.match(read("src/notifications.ts"), /record: "informational" \| "activity";/);
  assert.match(source, /const RECENT_KEPT = 10;/);
  assert.match(source, /item\.record === "activity" && \(item\.is_read \|\| stale\(item\)\)\)\s*\.slice\(0, RECENT_KEPT\)/);
  // Weeks-old unread activity is past, not new, and New is capped (owner,
  // 2026-10-05: the tenant's Updates listed too many records).
  assert.match(source, /const STALE_DAYS = 14;/);
  assert.match(source, /const other = fresh\.filter\(\(item\) => !needsYou\(item\)\)\.slice\(0, RECENT_KEPT\);/);

  const open = between(source, "function open(item: Notification) {", "async function markAllRead(");
  assert.match(open, /filter\(\(row\) => !\(row\.id === item\.id && row\.record === "informational"\)\)/);
  assert.match(open, /void markRead\(\[item\.id\]\)\.catch\(\(\) => void load\(\)\);/);
  assert.match(open, /router\.push\(destination\(item, isProvider\) as never\);/);

  const all = between(source, "async function markAllRead(", "return (");
  assert.match(all, /filter\(\(item\) => item\.record !== "informational"\)/);
});

test("one toolbar says what is new and marks everything read", () => {
  const source = screen();
  const toolbar = between(source, "accessibilityRole=\"toolbar\"", "renderSectionHeader=");
  assert.match(toolbar, /\{unread > 0 \? \(\s*<Pressable\s+onPress=\{\(\) => void markAllRead\(\)\}\s+disabled=\{markingAll\}/);
  assert.match(toolbar, /accessibilityLabel="Mark all updates as read"/);
  assert.match(toolbar, /You’re all caught up/);
  // On the narrowest phones Read all keeps its glyph and its name for a screen reader.
  assert.match(toolbar, /\{density\.veryCompact \? null : <Type variant="captionStrong" style=\{styles\.readAllText\}>Read all<\/Type>\}/);
});

test("an update says where it came from, what happened and how it stands; unread is a rule", () => {
  const source = screen();
  const row = between(source, "function UpdateRow(", "function UpdatesSkeleton(");

  assert.match(row, /!item\.is_read && \{ borderLeftColor: palette\.fg, backgroundColor: palette\.wash \}/);
  assert.match(source, /row: \{[^}]*borderLeftWidth: 3,\s*borderLeftColor: "transparent",/);
  assert.match(row, /<Type variant=\{item\.is_read \? "body" : "bodyStrong"\} style=\{styles\.title\}>\{item\.title\}<\/Type>/);
  assert.match(row, /\{notificationSource\(item\.kind\)\.toUpperCase\(\)\}/);
  assert.match(row, /<Type variant="captionStrong" style=\{\[styles\.status, \{ color: palette\.fg \}\]\}>\{notificationStatus\(item\)\}<\/Type>/);
  // A weeks-old prompt shown in Recent is history, so it asks for nothing.
  assert.match(row, /const actionable = needsYou\(item\) && !past;/);
  // The separator is drawn over the row, so an unread rule runs unbroken down a group.
  assert.match(source, /<UpdateRow item=\{item\} past=\{section\.key === "recent"\} onPress=\{\(\) => open\(item\)\} \/>\s*\{\s*\}\s*\{index === 0 \? null : <View pointerEvents="none" style=\{styles\.rule\} \/>\}/);
  assert.match(between(source, "function tonePalette(", "const styles"), /critical: \{ fg: theme\.color\.laterite\["600"\], bg: theme\.color\.laterite\["100"\], wash: alpha\(theme\.color\.laterite\["600"\], 0\.05\) \},/);
});

test("loading, all caught up and a failure each say the right thing", () => {
  const source = screen();
  assert.match(source, /items === null \? \(\s*<UpdatesSkeleton \/>\s*\) : error && !items\.length \? null : \(\s*<EmptyState/);
  assert.match(source, /title="You’re all caught up"/);
  // A failed refresh keeps what was on screen.
  const load = between(source, "const load = useCallback(", "useEffect(");
  assert.match(load, /setItems\(\(current\) => current \?\? \[\]\)/);
  assert.match(between(source, "function UpdatesSkeleton(", "function iconFor("), /accessibilityRole="progressbar" accessibilityLabel="Loading updates"/);
  assert.match(source, /refreshControl=\{\(\s*<RefreshControl/);
});
