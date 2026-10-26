import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const api = readFileSync(resolve(root, "src/viewings.ts"), "utf8");
const tenant = readFileSync(resolve(root, "app/(app)/viewings.tsx"), "utf8");
// The tenant's own controls moved onto the viewing record when Viewings became
// a schedule; the list is now where and when, and one way in.
const tenantRecord = readFileSync(resolve(root, "app/(app)/viewing/[id].tsx"), "utf8");
const provider = readFileSync(resolve(root, "app/(app)/provider-viewings.tsx"), "utf8");
const providerDetail = readFileSync(resolve(root, "app/(app)/provider-viewing.tsx"), "utf8");

test("mobile keeps withdrawal, cancellation, and attendance resolution separate", () => {
  assert.match(api, /"decline" \| "withdraw"/);
  assert.match(api, /\/cancel\//);
  assert.match(api, /\/attendance-report\//);
  assert.match(api, /\/attendance-response\//);
});

test("tenant and provider mobile surfaces preserve schedule and attendance history", () => {
  for (const source of [tenantRecord, providerDetail]) {
    assert.match(source, /Appointment history/);
    // Cancelling and contesting an attendance report both survive; the tenant's
    // wording is now plainer than the provider's.
    assert.match(source, /[Cc]ancel (appointment|this viewing)/);
  }
  assert.match(providerDetail, /Dispute report/);
  assert.match(tenantRecord, /No, I was there/);
  assert.match(tenantRecord, /Withdraw the request/);
  assert.match(tenantRecord, /Suggest another time/);
  assert.match(providerDetail, /Offer different times/);
  // The schedule itself carries none of it.
  assert.doesNotMatch(tenant, /Appointment history|Withdraw the request|Dispute/);
});

test("provider mobile Viewings separates the scalable queue from one workflow", () => {
  assert.match(provider, /<FlatList/);
  // Read as a day to plan (owner, 2026-10-06): your move, the schedule, the tenant's turn, the past.
  assert.match(provider, /title: "Your move"/);
  assert.match(provider, /title: "Schedule"/);
  assert.match(provider, /title="Past"/);
  assert.match(provider, /provider-viewing/);
  assert.match(providerDetail, /getViewing/);
  assert.match(providerDetail, /<EntityHeader/);
  assert.doesNotMatch(provider, /offerViewingSlots|cancelViewing|recordProviderViewingOutcome/);
});
