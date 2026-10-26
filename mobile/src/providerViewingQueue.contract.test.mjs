/**
 * A host's Viewings, read as a day to plan (owner, 2026-10-06).
 *
 * The visit to be at next leads on its own dark card, with how long until it
 * starts and — once the window opens — the check-in. Then what waits on the
 * host with the step on the row, the schedule as an agenda by day, the visits
 * waiting on a tenant to pick a time, and the past folded into one line. A week
 * strip is the only filter: a day shows that day. Most of these tests run the
 * meaning module itself (`viewingWork.ts`).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { actOf, countdown, dayKey, laneOf, lineOf, upNext, viewingWork, week } from "./viewingWork.ts";

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

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 6, 9, 0).getTime();
const at = (hours) => new Date(NOW + hours * HOUR).toISOString();
const viewing = (status, extra = {}) => ({
  id: extra.id ?? status, status, status_display: status, confirmed_starts_at: null, created_at: at(-48), slots: [], cancelled_by: null,
  ...extra,
  check_in: { can_validate: false, ...(extra.check_in ?? {}) },
  attendance: { can_respond: false, ...(extra.attendance ?? {}) },
});

test("every viewing lands in one lane, by whose move it is", () => {
  assert.equal(laneOf(viewing("requested")), "yours");
  assert.equal(laneOf(viewing("checked_in")), "yours");
  assert.equal(laneOf(viewing("confirmed", { check_in: { can_validate: true } })), "yours");
  assert.equal(laneOf(viewing("attendance_pending", { attendance: { can_respond: true } })), "yours");
  assert.equal(laneOf(viewing("confirmed")), "scheduled");
  assert.equal(laneOf(viewing("attendance_pending")), "scheduled");
  assert.equal(laneOf(viewing("offered")), "waiting");
  for (const status of ["completed", "declined", "withdrawn", "cancelled", "tenant_no_show"]) assert.equal(laneOf(viewing(status)), "past", status);
});

test("the host's step is on the row, in the record's own words", () => {
  assert.deepEqual(actOf(viewing("requested")), { label: "Offer times", icon: "time-outline", to: "record" });
  assert.deepEqual(actOf(viewing("confirmed", { check_in: { can_validate: true } })), { label: "Check in", icon: "qr-code-outline", to: "check-in" });
  assert.deepEqual(actOf(viewing("checked_in")), { label: "Mark completed", icon: "checkmark-done-outline", to: "record" });
  assert.deepEqual(actOf(viewing("attendance_pending", { attendance: { can_respond: true } })), { label: "Respond", icon: "chatbubble-ellipses-outline", to: "record" });
  assert.equal(actOf(viewing("confirmed")), null);
  // The record names that step "Mark Viewing completed"; the row says it shorter, never differently.
  assert.match(read("app/(app)/provider-viewing.tsx"), /label: "Mark Viewing completed"/);

  assert.equal(lineOf(viewing("offered", { slots: [{ is_past: false }, { is_past: false }, { is_past: true }] })), "2 times offered — tenant to pick");
  assert.equal(lineOf(viewing("cancelled", { cancelled_by: "host" })), "You cancelled");

  const source = screen();
  assert.match(source, /if \(act\?\.to === "check-in"\) router\.push\(\{ pathname: "\/\(app\)\/provider-viewing-check-in", params: \{ viewingId: viewing\.id \} \} as never\);/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/provider-viewing", params: \{ viewingId: viewing\.id \} \} as never\)/);
});

test("up next is the first booked visit not long since begun, with a countdown", () => {
  const list = [
    viewing("confirmed", { id: "late", confirmed_starts_at: at(-2) }),
    viewing("confirmed", { id: "soon", confirmed_starts_at: at(1.5) }),
    viewing("confirmed", { id: "later", confirmed_starts_at: at(26) }),
    viewing("offered", { id: "unbooked" }),
  ];
  assert.equal(upNext(list, NOW)?.id, "soon");
  assert.equal(upNext([viewing("confirmed", { id: "now", confirmed_starts_at: at(-0.5) })], NOW)?.id, "now");
  assert.equal(upNext([viewing("offered")], NOW), null);
  assert.equal(countdown(new Date(NOW + 95 * 60_000), NOW), "in 1h 35m");
  assert.equal(countdown(new Date(NOW + 2 * 60_000), NOW), "now");
  assert.equal(countdown(new Date(NOW + 50 * HOUR), NOW), "in 2 days");

  const source = screen();
  assert.match(source, /\{next && !searching \? <UpNext viewing=\{next\} onOpen=\{\(\) => openRecord\(next\)\} onAct=\{\(\) => runAct\(next\)\} \/> : null\}/);
  // The schedule never repeats the visit already on the card.
  assert.match(source, /const booked = work\.scheduled\.filter\(\(viewing\) => viewing\.id !== nextId && startsAt\(viewing\)\);/);
});

test("the week strip counts booked visits per day and is the only filter", () => {
  const today = new Date(NOW);
  const days = week([
    viewing("confirmed", { confirmed_starts_at: at(2) }),
    viewing("confirmed", { confirmed_starts_at: at(3) }),
    viewing("confirmed", { confirmed_starts_at: at(27) }),
    viewing("offered", { confirmed_starts_at: at(4) }),
    viewing("completed", { confirmed_starts_at: at(-30) }),
  ], today);
  assert.equal(days.length, 7);
  assert.equal(days[0].key, dayKey(today));
  assert.deepEqual(days.slice(0, 3).map((row) => row.count), [2, 1, 0]);

  const source = screen();
  assert.doesNotMatch(source, /<BottomSheet|<ListHead|<SummaryPanel|<ChoiceRow/);
  assert.match(source, /<WeekStrip days=\{days\} selected=\{day\} onChoose=\{chooseDay\} \/>/);
  assert.match(source, /setDay\(\(current\) => \(current === key \? null : key\)\);/);
  assert.match(source, /aria-selected=\{chosen\}/);
  // A chosen day with nothing in it is an absence, struck like any other.
  assert.match(source, /<Empty compact icon="calendar-clear-outline" title=\{entry\.title\}/);
});

test("lanes sort the way a host works them", () => {
  const lanes = viewingWork([
    viewing("confirmed", { id: "b", confirmed_starts_at: at(30) }),
    viewing("confirmed", { id: "a", confirmed_starts_at: at(5) }),
    viewing("requested", { id: "r" }),
    viewing("completed", { id: "old", confirmed_starts_at: at(-100) }),
    viewing("completed", { id: "recent", confirmed_starts_at: at(-10) }),
  ]);
  assert.deepEqual(lanes.scheduled.map((row) => row.id), ["a", "b"]);
  assert.deepEqual(lanes.yours.map((row) => row.id), ["r"]);
  assert.deepEqual(lanes.past.map((row) => row.id), ["recent", "old"]);

  const source = screen();
  // The visit on the Up next card is not offered a second time below it.
  assert.match(source, /const yours = work\.yours\.filter\(\(viewing\) => viewing\.id !== nextId\);/);
  assert.match(source, /out\.push\(\{ kind: "label", key: "label:yours", title: "Your move", count: yours\.length, tone: LATERITE, first: true \}\);/);
  assert.match(source, /out\.push\(\{ kind: "calm", key: "calm" \}\);/);
  assert.match(source, /title: "Waiting on a tenant"/);
  assert.match(source, /title="Past"/);
});

test("the Portfolio on screen, loading, nothing yet and a failure are each handled", () => {
  const source = screen();
  assert.match(source, /setItems\(null\);\s*try \{\s*setItems\(await listReceivedViewings\(false, preferred \? \{ organization: preferred \} : undefined\)\);/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
  assert.match(source, /refreshControl=\{<RefreshControl refreshing=\{refreshing\}/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(between(source, "function ViewingsSkeleton(", "function dayTitle("), /accessibilityRole="progressbar" accessibilityLabel="Loading viewings"/);
  assert.match(source, /<Empty\s+icon="calendar-outline"\s+title="No viewings yet"/);
  assert.match(source, /label="Your Properties" onPress=\{\(\) => router\.push\("\/\(app\)\/\(provider-tabs\)\/properties" as never\)\}/);
  assert.match(source, /<Empty icon="search-outline" title="No matching viewings"/);
});
