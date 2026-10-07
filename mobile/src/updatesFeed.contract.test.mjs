/**
 * Updates, read as work (owner, 2026-10-06), still not a log (2026-10-05).
 *
 * A reminder is deleted once read; activity keeps only the ten most recent;
 * management reads the full history in the audit log. What wants an answer
 * leads as cards to swipe through, each with its step; everything else is a
 * timeline by day, unread heavier and dotted. No filter sheet, no pages, no
 * summary card. `updatesWorkspace.contract.test.mjs` keeps the older promises.
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

test("not a log: what wants an answer first, then a timeline by day, with no filters and no pages", () => {
  const source = screen();
  assert.match(source, /const nowWaiting = fresh\.filter\(needsYou\);/);
  assert.match(source, /<GroupLabel count=\{waiting\.length\} tone=\{LATERITE\}>Wants an answer<\/GroupLabel>/);
  assert.match(source, /<AnswerCards items=\{waiting\} gutter=\{density\.pagePadding\} onOpen=\{open\} \/>/);
  assert.match(source, /timeline: byDay\(\[\.\.\.other, \.\.\.recent\]\.sort\(\(a, b\) => b\.created_at\.localeCompare\(a\.created_at\)\)\)/);
  const days = between(source, "function byDay(", "function shortTime(");
  assert.match(days, /"today" \? "Today" : key === "yesterday" \? "Yesterday" : key === "earlier" \? "Earlier"/);
  assert.doesNotMatch(source, /PAGE_SIZE|MobilePagination|<BottomSheet|FilterButton|selectView|SummaryPanel|FigureGrid/);
  assert.doesNotMatch(source, />\s*Updates\s*</);
});

test("a reminder leaves once read; only the ten most recent activities stay", () => {
  const source = screen();
  // The server says which a record is; the app never guesses from the kind.
  assert.match(read("src/notifications.ts"), /record: "informational" \| "activity";/);
  assert.match(source, /const RECENT_KEPT = 10;/);
  assert.match(source, /item\.record === "activity" && \(item\.is_read \|\| stale\(item\)\)\)\s*\.slice\(0, RECENT_KEPT\)/);
  // Weeks-old unread activity is past, not new, and New is capped.
  assert.match(source, /const STALE_DAYS = 14;/);
  assert.match(source, /const other = fresh\.filter\(\(item\) => !needsYou\(item\)\)\.slice\(0, RECENT_KEPT\);/);

  const open = between(source, "function open(item: Notification) {", "async function markAllRead(");
  assert.match(open, /filter\(\(row\) => !\(row\.id === item\.id && row\.record === "informational"\)\)/);
  assert.match(open, /void markRead\(\[item\.id\]\)\.catch\(\(\) => void load\(\)\);/);
  assert.match(open, /router\.push\(destination\(item, isProvider\) as never\);/);

  const all = between(source, "async function markAllRead(", "return (");
  assert.match(all, /filter\(\(item\) => item\.record !== "informational"\)/);
});

test("the briefing says what is new and marks everything read", () => {
  const source = screen();
  const briefing = between(source, "<Briefing", "{waiting.length ? (");
  assert.match(briefing, /title=\{listedNew \? `\$\{listedNew\} new \$\{listedNew === 1 \? "update" : "updates"\}` : "You’re all caught up"\}/);
  assert.match(briefing, /trailing=\{unread > 0 \? \(\s*<Pressable\s+onPress=\{\(\) => void markAllRead\(\)\}\s+disabled=\{markingAll\}/);
  assert.match(briefing, /accessibilityLabel="Mark all updates as read"/);
  // On the narrowest phones Read all keeps its glyph and its name for a screen reader.
  assert.match(briefing, /\{density\.veryCompact \? null : <Type variant="captionStrong" style=\{styles\.readAllText\}>Read all<\/Type>\}/);
});

test("an answer card and a timeline event each say where it came from, what happened and when", () => {
  const source = screen();
  const card = between(source, "function AnswerCards(", "function TimelineRow(");
  assert.match(card, /\{notificationSource\(item\.kind\)\.toUpperCase\(\)\}/);
  assert.match(card, /accessibilityLabel=\{`\$\{notificationSource\(item\.kind\)\}\. \$\{item\.title\}\. \$\{item\.body\}\. \$\{timeAgo\(item\.created_at\)\}\. Review\.`\}/);
  assert.match(card, />Review<\/Type>/);
  assert.match(card, /snapToInterval=\{cardWidth \+ space\[3\]\}/);

  const event = between(source, "function TimelineRow(", "function UpdatesSkeleton(");
  // Unread is said in words and weight, not only by the dot's colour.
  assert.match(event, /\$\{item\.is_read \? "Read" : "Unread"\}/);
  assert.match(event, /<Type variant=\{item\.is_read \? "body" : "bodyStrong"\}/);
  assert.match(event, /\{item\.is_read \? null : <View style=\{styles\.unreadDot\} \/>\}/);
  assert.match(between(source, "function tonePalette(", "const styles"), /critical: \{ fg: theme\.color\.laterite\["600"\], bg: theme\.color\.laterite\["100"\] \},/);
});

test("loading, all caught up and a failure each say the right thing", () => {
  const source = screen();
  assert.match(source, /\{items === null \? <UpdatesSkeleton \/> : null\}/);
  // Nothing at all: the bell, already crossed, so never struck twice.
  assert.match(source, /<Empty\s+icon="notifications-off-outline"\s+crossed=\{false\}\s+title="You’re all caught up"/);
  assert.match(source, /items !== null && !shown && !\(error && !items\.length\)/);
  // A failed refresh keeps what was on screen.
  const load = between(source, "const load = useCallback(", "useEffect(");
  assert.match(load, /setItems\(\(current\) => current \?\? \[\]\)/);
  assert.match(between(source, "function UpdatesSkeleton(", "function byDay("), /accessibilityRole="progressbar" accessibilityLabel="Loading updates"/);
  assert.match(source, /refreshControl=\{\(\s*<RefreshControl/);
});
