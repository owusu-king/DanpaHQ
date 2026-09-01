import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const webList = () => read("web/app/viewings/page.tsx");
const webDetail = () => read("web/src/components/tenant/ViewingRecord.tsx");
const webRecord = () => read("web/src/components/tenant/ViewingRecord.tsx");
const webListPage = () => read("web/app/viewings/page.tsx");
const mobileList = () => read("mobile/app/(app)/viewings.tsx");
const mobileDetail = () => read("mobile/app/(app)/viewing/[id].tsx");
const mobileStack = () => read("mobile/app/(app)/_layout.tsx");

/** Source with comments removed, so quoted history is not read as behaviour. */
const rendered = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

/** The tenant half of the web page, which also holds the provider's side. */
function tenantWebList() {
  const source = webList();
  const start = source.indexOf("function TenantViewings()");
  assert.notEqual(start, -1, "TenantViewings is missing");
  // `formatViewingTime` moved to `providerViewings.ts`; the provider half
  // now begins at its own component.
  const end = source.indexOf("function ProviderViewings()", start);
  assert.notEqual(end, -1, "the provider half is missing");
  return source.slice(start, end);
}

test("what a viewing means is decided once, for both clients", () => {
  const strip = (source) => source.replace(/^\/\*\*[\s\S]*?\*\/\n/, "").trim();
  assert.equal(
    strip(read("web/src/lib/viewingMeaning.ts")),
    strip(read("mobile/src/viewingMeaning.ts")),
  );
});

test("a row is a place and a time", () => {
  // "Today · 3:30 PM" is what makes this a schedule. A raw timestamp and a
  // status word make it a table.
  const meaning = read("web/src/lib/viewingMeaning.ts");
  assert.match(meaning, /`Today . \$\{time\}`/);
  assert.match(meaning, /`Tomorrow . \$\{time\}`/);

  for (const source of [tenantWebList(), mobileList()]) {
    assert.match(source, /whenLabel\(viewing\.confirmed_starts_at\)/);
    assert.match(source, /photo_url/);
    assert.match(source, /placeOf\(viewing\)/);
    // Soonest first. A schedule ordered by when the request was made is not
    // a schedule.
    assert.match(source, /bySoonest/);
  }
});

test("the schedule opens on every viewing and history is filter-driven", () => {
  const meaning = read("web/src/lib/viewingMeaning.ts");
  assert.match(meaning, /export type ViewingFilter = "all" \| ViewingGroup/);
  for (const label of ["All", "Upcoming", "Needs you", "Past"]) {
    assert.match(meaning, new RegExp(`label: "${label}"`));
  }

  // The phone still writes its section headings; web renders the same labels
  // from `viewingFilters`, so they are in the module rather than the page.
  assert.match(tenantWebList(), /viewingFilters\.map/);
  for (const source of [mobileList()]) {
    const upcoming = source.indexOf("Upcoming");
    const needs = source.indexOf("Needs you");
    assert.notEqual(upcoming, -1, "Upcoming is missing");
    assert.notEqual(needs, -1, "Needs you is missing");
    assert.ok(upcoming < needs, "Upcoming must come before Needs you");
    assert.match(source, /useState<ViewingFilter>\("all"\)/);
    assert.match(source, /viewingFilters\.map/);
    assert.match(source, /visibleSections\.map/);
    assert.doesNotMatch(source, /Past viewings \(/);
    assert.doesNotMatch(source, /showPast/);
  }
});

test("the machine is not on every row", () => {
  // The old cards carried the slot picker, the exact directions, the contact
  // number, the check-in, the follow-up, the attendance panel and three quiet
  // buttons — all rendered at once, on every row, forever.
  for (const source of [tenantWebList(), mobileList()]) {
    const body = rendered(source);
    assert.doesNotMatch(body, /viewing_directions/);
    assert.doesNotMatch(body, /check_in\.|issueViewingCheckInCredential|QRCode/);
    assert.doesNotMatch(body, /viewing\.contact/);
    assert.doesNotMatch(body, /post_viewing\.available/);
    assert.doesNotMatch(body, /can_reschedule|can_cancel|can_withdraw/);
    assert.doesNotMatch(body, /appointments/);
  }
});

test("a control is drawn only while the lifecycle allows it", () => {
  // Every tool is gated on the server's own per-reader answer, never on a
  // status string the client re-derives.
  for (const source of [webDetail(), mobileDetail()]) {
    assert.match(source, /viewing\.check_in\.can_issue \?/);
    assert.match(source, /viewing\.attendance\.can_report \?/);
    assert.match(source, /viewing\.attendance\.can_respond \?/);
    assert.match(source, /viewing\.post_viewing\.available \?/);
    assert.match(source, /viewing\.actions\.can_reschedule/);
    assert.match(source, /viewing\.actions\.can_cancel/);
    assert.match(source, /viewing\.actions\.can_withdraw/);
    // Directions render only when the backend released them.
    assert.match(source, /viewing_directions/);
  }
});

test("nothing explains how viewings work in general", () => {
  // Standing instructions on a schedule are furniture. What is left is
  // situational: the sentence that belongs to the one action on screen.
  for (const source of [tenantWebList(), mobileList()]) {
    const body = rendered(source);
    assert.doesNotMatch(body, /The landlord offers times, you pick one/);
    assert.doesNotMatch(body, /Contact details are released once a time is confirmed/);
    assert.doesNotMatch(body, /only then do you exchange numbers/);
  }
});

test("a substantial viewing record gets a workspace or a dedicated screen", () => {
  // A viewing can include slot selection, directions, check-in, attendance,
  // follow-up and lifecycle actions. That is a record, not a quick dialog.
  for (const source of [webRecord(), webListPage()]) {
    assert.doesNotMatch(rendered(source), /<main/);
    assert.doesNotMatch(rendered(source), /<dialog/);
    assert.doesNotMatch(source, /showModal\(\)/);
  }
  // The tenant's record is a page too now, so it is no longer an aside beside
  // a list. It kept everything it held; only its container changed.
  assert.match(webRecord(), /className="viewing-record"/);
  assert.doesNotMatch(webRecord(), /<aside/);
  assert.match(read("web/app/viewings/[viewingId]/page.tsx"), /<ViewingRecord/);

  // The provider's half took the other option in this test's title: a dedicated
  // screen. A split pane always opened somebody's appointment whether or not it
  // was asked for, and a workflow that runs across a day had no address.
  assert.doesNotMatch(webListPage(), /ProviderViewingDialog/);
  assert.doesNotMatch(webListPage(), /provider-viewings-split/);
  assert.match(webListPage(), /href=\{`\/viewings\/\$\{viewing\.id\}`/);
  const providerRoute = read("web/app/viewings/[viewingId]/page.tsx");
  assert.match(providerRoute, /<ProviderViewingRecord/);
  assert.doesNotMatch(rendered(providerRoute), /<dialog/);
  assert.doesNotMatch(providerRoute, /showModal\(\)/);

  const stack = mobileStack();
  const route = stack.match(/<Stack\.Screen\s+name="viewing\/\[id\]"[\s\S]*?\/>/)?.[0];
  assert.ok(route, "the mobile viewing record route is missing");
  assert.doesNotMatch(route, /presentation: "modal"/);
});

test("withdrawal is confirmed in context instead of firing from one tap", () => {
  for (const source of [webDetail(), mobileDetail()]) {
    assert.match(source, /mode === "withdraw"/);
    assert.match(source, /Withdraw this request\?/);
    assert.match(source, /Yes, withdraw it/);
  }
});
