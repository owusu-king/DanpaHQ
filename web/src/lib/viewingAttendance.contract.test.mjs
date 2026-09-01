import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const api = readFileSync(resolve(here, "console.ts"), "utf8");
const page = readFileSync(resolve(here, "../../app/viewings/page.tsx"), "utf8");
// The tenant's own controls moved onto the viewing record when Viewings became
// a schedule; the provider's queue stayed on the page.
const record = readFileSync(resolve(here, "../components/tenant/ViewingRecord.tsx"), "utf8");
// The provider's record left the split pane for `/viewings/<viewingId>`.
// Everything these assertions protect went with it and none of it changed.
const providerRecord = readFileSync(
  resolve(here, "../components/viewings/ProviderViewingRecord.tsx"),
  "utf8",
);
const providerMeaning = readFileSync(resolve(here, "providerViewings.ts"), "utf8");

test("web uses distinct withdrawal, cancellation, and attendance endpoints", () => {
  assert.match(api, /\/withdraw\//);
  assert.match(api, /\/cancel\//);
  assert.match(api, /\/attendance-report\//);
  assert.match(api, /\/attendance-response\//);
  assert.match(api, /ViewingCancellationReason/);
});

test("web encourages rescheduling and exposes counterparty attendance response", () => {
  // Cancelling points at rescheduling first, on both sides.
  assert.match(providerRecord, /Could a new time work\?/);
  assert.match(record, /suggest one instead/);
  assert.match(record, /Withdraw the request/);
  assert.match(record, /Appointment history/);
  // The tenant can accept the report or contest it; both are recorded.
  assert.match(record, /Yes, I could not attend/);
  assert.match(record, /No, I was there/);
  assert.match(record, /respondMyViewingAttendance\(viewing\.id, "dispute"/);
});

test("provider web Viewings is a scalable queue with contextual detail", () => {
  assert.match(page, /className="viewings-search"/);
  // The stage words moved to the module the list and the record share.
  for (const label of ["Needs action", "Upcoming", "History"]) {
    assert.ok(providerMeaning.includes(label), `${label} must still be a stage`);
  }
  // The queue links to the record rather than opening it into a pane.
  assert.match(page, /className="viewings-filters"/);
  assert.match(page, /href=\{`\/viewings\/\$\{viewing\.id\}`/);
  assert.match(providerRecord, /export function ProviderViewingRecord/);
  assert.doesNotMatch(page, /ProviderViewingDialog/);
  assert.doesNotMatch(page, /dialog\.showModal\(\)/);
  assert.doesNotMatch(page, /Show finished ones too/);
});
