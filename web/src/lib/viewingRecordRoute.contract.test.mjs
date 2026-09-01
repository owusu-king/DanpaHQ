/**
 * Viewings, laid out the way Payments, Tenancy requests and Leases are.
 *
 * The fourth and last of the provider lists to take the shape: counts across
 * the top, a search, the stages as filter pills, linked rows, and the record at
 * its own address.
 *
 * A viewing is the strongest case for the record having an address. It is a
 * workflow that happens over hours — a host offers times in the morning and
 * checks somebody in that afternoon, often from a different device — and it
 * lived in a pane that could not be linked to or returned to.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// Line endings are mixed across this repo, and a slice that looks for "}\n"
// silently runs to the end of a CRLF file rather than stopping at the function
// it meant to read. Normalise once, here.
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const list = () => read("web/app/viewings/page.tsx");
const detail = () => read("web/app/viewings/[viewingId]/page.tsx");
const record = () => read("web/src/components/viewings/ProviderViewingRecord.tsx");
const meaning = () => read("web/src/lib/providerViewings.ts");
const css = () => read("web/src/styles/viewings-workspace.css");

/**
 * The provider half only.
 *
 * The tenant half of this route keeps its own reading and its own layout — a
 * tenant deciding whether to get in a taxi is a different job. Asserting
 * against the whole file would let the provider half lose things the tenant
 * half happens to keep.
 */
const providerHalf = () => {
  const source = code(list());
  const at = source.indexOf("function ProviderViewings()");
  assert.notEqual(at, -1, "ProviderViewings is gone");
  return source.slice(at);
};

function rule(sheet, selector) {
  const at = sheet.indexOf(selector + " {");
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

test("a viewing opens at its own address", () => {
  assert.ok(existsSync(resolve(root, "web/app/viewings/[viewingId]/page.tsx")), "needs a route");
  assert.match(code(detail()), /useParams<\{ viewingId: string \}>\(\)/);
  assert.match(code(detail()), /viewings\?\.find\(\(row\) => row\.id === viewingId\)/);
  assert.match(code(detail()), /<ProviderViewingRecord/);

  const body = providerHalf();
  assert.doesNotMatch(body, /provider-viewings-split/);
  assert.doesNotMatch(body, /selectedId/);
  assert.doesNotMatch(css(), /\.provider-viewings-split/);
  assert.doesNotMatch(css(), /\.provider-viewing-record/);

  assert.match(body, /href=\{`\/viewings\/\$\{viewing\.id\}` as never\}/);
  assert.doesNotMatch(body, /<button type="button" className="viewing-row"/);
  assert.match(rule(css(), ".viewing-row"), /text-decoration: none/);
});

test("nobody's viewing is opened for them", () => {
  // The pane fell back to `visible[0]`, so arriving at Viewings meant reading
  // an appointment picked by sort order.
  const body = providerHalf();
  assert.doesNotMatch(body, /explicit \?\? visible\[0\]/);
  assert.doesNotMatch(body, /const explicit =/);
});

test("the page is laid out the way Payments is", () => {
  const body = providerHalf();

  const order = ["viewings-overview", "viewings-search", "viewings-filters", "viewings-list"];
  let at = -1;
  for (const className of order) {
    const found = body.search(new RegExp(`className="${className}"`));
    assert.notEqual(found, -1, `${className} is not rendered`);
    assert.ok(found > at, `${className} is out of order`);
    at = found;
  }

  assert.match(rule(css(), ".viewings-overview"), /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(rule(css(), ".viewings-overview dd"), /font-family: var\(--font-display\)/);
  assert.match(rule(css(), ".viewings-filters button"), /border-radius: 999px/);
  assert.match(css(), /\.viewings-filters button\[aria-pressed="true"\][\s\S]{0,140}--color-kola-50/);
  assert.match(rule(css(), ".viewings-search"), /width: min\(100%, 30rem\)/);

  assert.doesNotMatch(css(), /\.viewings-tab\b/);
  assert.doesNotMatch(css(), /\.viewings-controls/);
});

test("the three counts do not repeat the pills below them", () => {
  // The cards say what happened; the pills say what stage the work is at.
  // Saying the same number twice on one screen is how a page stops being read.
  const body = code(meaning());
  assert.match(body, /total: viewings\.length/);
  assert.match(body, /viewing\.status === "confirmed"/);
  assert.match(body, /viewing\.status === "completed"/);

  const totals = body.slice(body.indexOf("export function viewingTotals"), body.indexOf("}\n", body.indexOf("export function viewingTotals")));
  for (const stage of ["action", "upcoming", "history"]) {
    assert.doesNotMatch(totals, new RegExp(`"${stage}"`), `the cards must not restate the ${stage} pill`);
  }

  assert.match(providerHalf(), /viewingTotals\(all\)/);
  assert.match(providerHalf(), /label="Confirmed"/);
  assert.match(providerHalf(), /label="Completed"/);
});

test("leaving a viewing and coming back lands where you left", () => {
  const body = providerHalf();
  assert.match(body, /useSearchParams\(\)/);
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(body, /PROVIDER_VIEWING_FILTERS\.find\(/);
  assert.match(body, /router\.replace\(/);
  assert.match(code(list()), /<Suspense/);
});

test("moving the record did not move the authority", () => {
  const body = code(record());

  // Every action still goes to the endpoint it did before.
  for (const call of [
    "viewingAction(",
    "offerSlots(",
    "rescheduleViewing(",
    "cancelViewingAppointment(",
    "validateViewingCheckIn(",
    "reportViewingNoShow(",
    "respondViewingAttendance(",
    "recordViewingOutcome(",
  ]) {
    assert.ok(body.includes(call), `${call} must still be the way this happens`);
  }

  // What is drawn is still read from what the server computed per-reader.
  //
  // Named one by one, not as `viewing.actions.` — that matched any single
  // surviving use, so gutting a gate left the test green. Each of these decides
  // whether a control the host can press is drawn at all.
  for (const gate of [
    "viewing.actions.can_confirm_slot",
    "viewing.actions.can_decline",
    "viewing.actions.can_cancel",
    "viewing.check_in.can_validate",
    "viewing.attendance.can_report",
    "viewing.attendance.can_respond",
  ]) {
    assert.ok(body.includes(gate), `${gate} must still decide whether its control is drawn`);
  }
});

test("the words a viewing is described in are written once", () => {
  const body = code(meaning());
  for (const name of [
    "providerViewingView",
    "providerViewingSummary",
    "providerViewingMoment",
    "formatViewingTime",
  ]) {
    assert.match(body, new RegExp(`export function ${name}\\(`));
  }
  assert.doesNotMatch(code(list()), /^function (providerViewingView|providerViewingSummary|formatViewingTime)\(/m);
  assert.doesNotMatch(code(record()), /^function (providerViewingSummary|formatViewingTime)\(/m);
  assert.match(providerHalf(), /from "@\/lib\/providerViewings"|providerViewingSummary/);
  assert.match(code(record()), /from "@\/lib\/providerViewings"/);

  // The tenant's mirrored module is left alone: this is the host's reading and
  // has no mobile counterpart.
  assert.doesNotMatch(read("web/src/lib/viewingMeaning.ts"), /providerViewing/);
});
