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
  assert.match(source, /item.record === "informational" && !item.is_read/);
  assert.match(source, /<GroupLabel count=\{waiting\.length\} tone=\{LATERITE\}>Alerts<\/GroupLabel>/);
  assert.match(source, /<AnswerCards items=\{waiting\} gutter=\{density\.pagePadding\} onOpen=\{open\} onDismiss=\{acknowledge\} \/>/);
  assert.match(source, /const timeline = byDay\(recent\)/);
  const days = between(source, "function byDay(", "function shortTime(");
  assert.match(days, /"today" \? "Today" : key === "yesterday" \? "Yesterday" : key === "earlier" \? "Earlier"/);
  assert.doesNotMatch(source, /PAGE_SIZE|MobilePagination|<BottomSheet|FilterButton|selectView|SummaryPanel|FigureGrid/);
  assert.doesNotMatch(source, />\s*Updates\s*</);
});

test("alerts clear on acknowledgement while every activity remains reachable", () => {
  const source = screen();
  assert.match(source, /const RECENT_SHOWN = 5;/);
  assert.match(source, /activity.slice\(0, RECENT_SHOWN\)/);
  assert.match(source, /activity.slice\(RECENT_SHOWN\)/);
  assert.match(source, /item.record === "informational" && !item.is_read/);
  assert.match(source, /onDismiss=\{acknowledge\}/);
  assert.match(source, /void markRead\(\[item.id\]\)/);
  assert.match(source, /router.push\(destination\(item, isProvider\) as never\)/);
  assert.doesNotMatch(source, /const seen|RECENT_KEPT|STALE_DAYS/);
});

test("the briefing says what is new and marks everything read", () => {
  const source = screen();
  const briefing = between(source, "<Briefing", "{waiting.length ? (");
  assert.match(briefing, /title=\{listedNew \? `\$\{listedNew\} new \$\{listedNew === 1 \? "update" : "updates"\}` : "Activity"\}/);
  assert.match(briefing, /trailing=\{unread > 0 \? \(\s*<Pressable\s+onPress=\{\(\) => void markAllRead\(\)\}\s+disabled=\{markingAll\}/);
  assert.match(briefing, /accessibilityLabel="Mark all updates as read"/);
  // On the narrowest phones Read all keeps its glyph and its name for a screen reader.
  assert.match(briefing, /\{density\.veryCompact \? null : <Type variant="captionStrong" style=\{styles\.readAllText\}>Read all<\/Type>\}/);
});

test("an answer card and a timeline event each say where it came from, what happened and when", () => {
  const source = screen();
  const card = between(source, "function AnswerCards(", "function TimelineRow(");
  assert.match(card, /\{notificationSource\(item\.kind\)\.toUpperCase\(\)\}/);
  assert.match(card, /accessibilityLabel=\{`Dismiss \$\{item.title\}`\}/);
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
  assert.match(source, /all caught up!/);
  assert.match(source, /items !== null && !waiting\.length && !\(error && !items\.length\)/);
  // A failed refresh keeps what was on screen.
  const load = between(source, "const load = useCallback(", "useEffect(");
  assert.match(load, /setItems\(\(current\) => current \?\? \[\]\)/);
  assert.match(between(source, "function UpdatesSkeleton(", "function byDay("), /accessibilityRole="progressbar" accessibilityLabel="Loading updates"/);
  assert.match(source, /refreshControl=\{\(\s*<RefreshControl/);
});
