/**
 * A Portfolio's repairs, read as work (owner, 2026-10-06).
 *
 * How many repairs wait to be started leads, with how long the oldest has
 * waited; then the lanes in the order a landlord works them — to start, being
 * fixed, waiting on a tenant — each repair with the four stops it walks and the
 * provider's step in the record's own words. Fixed repairs fold away. The
 * tenant's side of Maintenance is unchanged (`maintenanceMobile.contract.test.mjs`).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { laneOf, lineOf, repairWork, stepOf, stopsDone } from "./maintenanceWork.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const screen = () => code(read("src/components/maintenance/ProviderMaintenance.tsx"));

const repair = (id, status, extra = {}) => ({
  id, status, reopen_count: 0, created_at: "2026-10-01T09:00:00Z", status_changed_at: extra.at ?? "2026-10-02T09:00:00Z",
  started_at: null, fixed_reported_at: null, completed_at: null,
  permissions: { start: false, report_fixed: false, confirm: false, reopen: false, ...(extra.permissions ?? {}) },
  ...extra,
});

test("every repair lands in one lane, and the provider's step uses the record's words", () => {
  assert.deepEqual(["submitted", "reopened", "in_progress", "awaiting_tenant_confirmation", "completed"].map((status) => laneOf({ status })), ["start", "start", "fixing", "confirming", "done"]);
  // What the provider may do is the server's answer.
  assert.deepEqual(stepOf(repair("a", "submitted", { permissions: { start: true } })), { label: "Start work", icon: "construct-outline" });
  assert.deepEqual(stepOf(repair("b", "in_progress", { permissions: { report_fixed: true } })), { label: "Mark as fixed", icon: "checkmark-circle-outline" });
  assert.equal(stepOf(repair("c", "submitted")), null);
  const record = read("app/(app)/maintenance-request.tsx");
  assert.match(record, /label="Start work"/);
  assert.match(record, /label="Mark as fixed"/);

  assert.equal(lineOf({ status: "reopened", reopen_count: 2 }), "Reopened 2 times — still not fixed");
  assert.equal(stopsDone(repair("d", "in_progress", { started_at: "2026-10-02T09:00:00Z" })), 1);
  assert.equal(stopsDone(repair("e", "completed")), 4);
});

test("the oldest wait leads each live lane; the newest fix leads the fold", () => {
  const work = repairWork([
    repair("new", "submitted", { at: "2026-10-05T09:00:00Z" }),
    repair("old", "submitted", { at: "2026-10-01T09:00:00Z" }),
    repair("back", "reopened", { at: "2026-10-03T09:00:00Z" }),
    repair("fixed-early", "completed", { at: "2026-09-01T09:00:00Z" }),
    repair("fixed-late", "completed", { at: "2026-10-04T09:00:00Z" }),
  ]);
  assert.deepEqual(work.start.map((row) => row.id), ["old", "back", "new"]);
  assert.deepEqual(work.done.map((row) => row.id), ["fixed-late", "fixed-early"]);
});

test("the provider's Maintenance is a briefing, lanes and a fold, with no Filter sheet", () => {
  const source = screen();
  assert.match(code(read("app/(app)/maintenance.tsx")), /return provider \? <ProviderMaintenanceScreen \/> : <TenantMaintenanceScreen \/>;/);
  assert.doesNotMatch(source, /<BottomSheet|<ListHead|<SummaryPanel|<ChoiceRow/);
  assert.match(source, /for \(const lane of \["start", "fixing", "confirming"\] as const\)/);
  assert.match(source, /<Segments total=\{4\} done=\{stopsDone\(request\)\} tone=\{look\.ink\}/);
  assert.match(source, /<Act label=\{step\.label\} icon=\{step\.icon\} primary onPress=\{onOpen\} \/>/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/maintenance-request", params: \{ id: request\.id \} \} as never\)/);
  assert.match(source, /title="Fixed"/);
  // Nothing at all, nothing found: each its own glyph, struck.
  assert.match(source, /<Empty\s+icon="construct-outline"\s+title="No repairs reported"/);
  assert.match(source, /<Empty icon="search-outline" title="No matching repairs"/);
  assert.match(source, /accessibilityRole="progressbar" accessibilityLabel="Loading maintenance"/);
});
