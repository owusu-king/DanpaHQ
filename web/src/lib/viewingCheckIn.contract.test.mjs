import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("web viewing attendance uses a free QR/code check-in before completion", () => {
  const page = read("web/app/viewings/page.tsx");
  // The provider's record left the split pane for `/viewings/<viewingId>`.
  // Everything these assertions protect went with it and none of it changed.
  const providerRecord = read("web/src/components/viewings/ProviderViewingRecord.tsx");
  // The tenant's QR moved onto the viewing record when Viewings became a
  // schedule: a check-in code is not something to carry around all week.
  const record = read("web/src/components/tenant/ViewingRecord.tsx");
  const api = read("web/src/lib/console.ts");

  // The tenant shows a code; the provider reads one.
  assert.match(record, /react-qr-code/);
  assert.match(record, /Check in/);
  assert.match(providerRecord, /validateViewingCheckIn\(viewing\.id, \{ code \}\)/);
  // Being checked in is what decides which list a viewing is in; that decision
  // lives in the module the list and the record share.
  //
  // Read from inside `providerViewingView`, not from the whole file: the same
  // status is also mentioned by the summary line, so a file-wide match went
  // green with the routing decision gutted.
  const meaning = read("web/src/lib/providerViewings.ts").replaceAll("\r\n", "\n");
  const routing = meaning.slice(
    meaning.indexOf("export function providerViewingView"),
    meaning.indexOf("\n}", meaning.indexOf("export function providerViewingView")),
  );
  assert.match(routing, /viewing\.status === "checked_in"/);
  // Free, on every surface the workflow now touches.
  for (const source of [page, record, providerRecord]) {
    assert.doesNotMatch(source, /viewing_fee/);
  }
  assert.match(api, /\/check-in\//);
});
test("tenant viewing refreshes while a QR check-in is active", () => {
  const record = read("web/src/components/tenant/ViewingRecord.tsx");

  // The provider validates the QR in a separate session. While the credential
  // is live, the tenant record refreshes without requiring a manual reload.
  assert.match(record, /viewing\.status !== "confirmed" \|\| viewing\.check_in\.state !== "ready"/);
  assert.match(record, /window\.setInterval\([\s\S]*3_000\)/);
  assert.match(record, /addEventListener\("focus"/);
  assert.match(record, /addEventListener\("visibilitychange"/);
  assert.match(record, /viewing\.status === "checked_in"/);
  assert.match(record, /You are checked in/);
});