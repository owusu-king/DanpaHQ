/**
 * A tenant's own viewings, on the host's agenda.
 *
 * The same workspace, cards and record vocabulary as the provider's Viewings,
 * so both sides of one appointment look like one appointment: the date is a
 * card's face, the place its photograph, one lifecycle sentence its status.
 * The full record opens in the shared sheet, held in page state, and remains
 * at its durable `/viewings/<viewingId>` address.
 *
 * A viewing is the strongest case in the product for the record having an
 * address — it is a workflow that runs across a day, and the tenant half is
 * where somebody stands at a junction with a phone deciding whether to get in
 * a taxi. Hence the countdown: only for a booked visit, only when it is close.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// Line endings are mixed across this repo, and a slice looking for "}\n"
// silently runs to the end of a CRLF file instead of stopping at its function.
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const list = () => read("web/app/viewings/page.tsx");
const route = () => read("web/app/viewings/[viewingId]/page.tsx");
const record = () => code(read("web/src/components/tenant/ViewingRecord.tsx"));
const countdown = () => code(read("web/src/components/viewings/Countdown.tsx"));
const css = () => read("web/src/styles/viewings-tenant.css");

/** The tenant half only; the host half has its own contract. */
const tenantHalf = () => {
  const source = code(list());
  const start = source.indexOf("function TenantViewings()");
  const end = source.indexOf("function ProviderViewings()");
  assert.ok(start !== -1 && end > start, "failed to slice the tenant half");
  return source.slice(start, end);
};

/** The tenant half of the record route, which also holds the host's. */
const tenantRoute = () => {
  const source = code(route());
  const at = source.indexOf("function TenantViewing()");
  assert.notEqual(at, -1, "TenantViewing is gone");
  return source.slice(at);
};

test("a tenant's viewing opens over the schedule, held in page state, and at its own", () => {
  assert.ok(existsSync(resolve(root, "web/app/viewings/[viewingId]/page.tsx")));
  assert.match(tenantRoute(), /viewings\?\.find\(\(row\) => row\.id === viewingId\)/);
  assert.match(tenantRoute(), /<ViewingRecord/);
  assert.match(tenantRoute(), /mobileLabel: "Back to Viewings"/);

  const body = tenantHalf();
  assert.match(body, /useDeepLinkedModal\("viewing"\)/);
  assert.match(body, /<ViewingSheet viewing=\{opened\}/);
  assert.match(body, /onClose=\{\(\) => setOpenId\(""\)\}/);
  assert.match(body, /href=\{`\/viewings\/\$\{viewing\.id\}` as never\}/);
  assert.match(body, /event\.preventDefault\(\);\s*onOpen\(viewing\.id\)/);
  assert.match(record(), /<ModalSheet/);
  assert.match(record(), /className="host-viewing-sheet tenant-viewing-sheet"/);
});

test("one address serves both sides, and branches the way the list does", () => {
  const body = code(route());
  assert.match(body, /useSession\(\)/);
  assert.match(body, /capabilities\.active_workspace === "provider"/);
  assert.match(body, /asProvider \? <HostViewing \/> : <TenantViewing \/>/);
  assert.match(body, /listHostViewings/);
  assert.match(body, /listMyViewings/);
});

test("the schedule is the host's agenda: shared workspace, date-faced cards, one record vocabulary", () => {
  const body = tenantHalf();
  assert.match(body, /className="ws-page viewings-workspace tenant-viewings"/);
  assert.match(body, /<WorkspaceHead\s+icon="viewings"\s+title="Viewings"/);
  assert.match(body, /<SegmentedControl\s+label="Viewing stage"/);
  assert.match(body, /className="ws-panel-body viewings-agenda tenant-viewings-agenda"/);
  assert.match(body, /<ul className="viewings-list">/);
  assert.match(body, /className="viewing-row tenant-viewing-row"/);
  assert.match(body, /className="viewing-row-day"/);
  assert.doesNotMatch(body, /role="menuitemradio"|tenant-viewing-filter-trigger/);
  // The record is drawn in the host's `vr-*` words.
  assert.match(record(), /className="vr-hero" data-tone=\{tone\}/);
  assert.match(record(), /className="vr-date"/);
  // The tenant's sheet no longer redeclares the host's list.
  assert.doesNotMatch(css(), /^\.viewings-list \{/m);
});

test("what waits on the tenant leads; otherwise the next booked visit does", () => {
  const body = tenantHalf();
  assert.match(body, /unfilteredView && firstAction \? \(\s*<NextUp/);
  assert.match(body, /\) : unfilteredView && nextBooked \? \(\s*<NextVisit/);
  assert.match(body, /row\.viewing\.status === "confirmed" && row\.viewing\.confirmed_starts_at/);
  // "All" is one grid, as the host's agenda draws it, so rows fill.
  assert.match(body, /<ViewingGroup title="All viewings" quiet rows=\{\[\.\.\.waiting, \.\.\.upcoming, \.\.\.history\]\}/);
});

test("a countdown appears only for a booked visit that is close, and ticks finely only at the end", () => {
  const clock = countdown();
  assert.match(clock, /export const COUNTDOWN_WINDOW_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(clock, /return left > 0 && left <= COUNTDOWN_WINDOW_MS/);
  // Every second only within the hour; the tab stays quiet otherwise.
  assert.match(clock, /left > 0 && left <= HOUR \? 1000 : 30_000/);
  // The clock is read in an effect, never during render.
  const render = clock.slice(clock.indexOf("export function Countdown"));
  assert.doesNotMatch(render, /Date\.now\(\)/);
  // Cards and the record both gate it on a confirmed appointment.
  assert.match(tenantHalf(), /viewing\.status === "confirmed" \? <SoonChip target=\{viewing\.confirmed_starts_at\} \/>/);
  assert.match(record(), /const counting = viewing\.status === "confirmed" && countsDown\(viewing\.confirmed_starts_at, now\)/);
  // Tabular cells, so ticking never moves the line, and it is spoken, not read digit by digit.
  assert.match(css(), /\.viewing-countdown-cell strong \{[\s\S]{0,200}font-variant-numeric: tabular-nums/);
  assert.match(clock, /aria-label=\{spoken\}/);
});

test("every state is designed inside the panel", () => {
  const body = tenantHalf();
  assert.match(body, /loading \? <PanelSkeleton/);
  assert.match(body, /<PanelState\s+tone="error"[\s\S]{0,400}Try again/);
  assert.match(body, /title="No viewings yet"/);
  assert.match(body, /Nothing matches[\s\S]{0,200}Clear search/);
  assert.match(body, /Show all viewings/);
  const load = body.slice(body.indexOf("const load = useCallback"), body.indexOf("useEffect(() => { void load(); }"));
  assert.doesNotMatch(load, /setViewings\(\[\]\)/);
});

test("the collection stays calm and discloses more on request", () => {
  const body = tenantHalf();
  assert.match(body, /const pageSize = 8/);
  assert.match(body, /rows\.slice\(0, limit\)/);
  assert.match(body, /className="tenant-viewing-load-more"/);
  assert.match(body, /initialLimit=\{8\}/);
  assert.match(body, /<TenantViewingSummary counts=\{counts\}/);
});

test("a reminder still points straight at one appointment", () => {
  const body = tenantHalf();
  assert.match(body, /window\.location\.hash\.startsWith\("#viewing-"\)/);
  assert.match(body, /router\.replace\(`\/viewings\/\$\{window\.location\.hash\.slice\("#viewing-"\.length\)\}`/);
});

test("the card is a link, and nothing inside it pretends to be a button", () => {
  const body = tenantHalf();
  assert.doesNotMatch(body, /className=\{state\.callToAction \? "viewing-primary"/);
  assert.doesNotMatch(css(), /\.viewing-primary/);
  // The call to action is the mirrored module's and goes into the accessible
  // name, which is what the phone already does.
  assert.match(body, /state\.callToAction \?\? "View details"/);
  assert.match(
    read("mobile/app/(app)/viewings.tsx"),
    /state\.callToAction \?\? "View details"/,
    "the phone reads it this way too",
  );
});

test("what a viewing means is still decided by the mirrored module", () => {
  const body = tenantHalf();
  assert.match(body, /standing\(viewing\)/);
  assert.match(body, /matchesViewingFilter\(row\.state\.group, filter\)/);
  assert.match(body, /bySoonest\(left\.viewing, right\.viewing\)/);
  assert.doesNotMatch(code(list()), /^function (standing|whenLabel|bySoonest)\(/m);
  const tone = record().slice(record().indexOf("export function tenantViewingTone"));
  assert.match(tone, /const state = standing\(viewing\)/);
});

test("leaving a viewing and coming back lands where you left", () => {
  const body = tenantHalf();
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(body, /viewingFilters\.map/);
  assert.match(code(list()), /<TenantViewings \/>\s*<\/Suspense>/);
});
