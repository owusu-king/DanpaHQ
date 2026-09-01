import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const web = () => read("web/app/applications/page.tsx");
// The tenant's record left the split pane for `/applications/<id>`; the page
// keeps the list. Both are read where they now live.
const webRecord = () => read("web/src/components/applications/ApplicationRecord.tsx");
const webRoute = () => read("web/app/applications/[requestId]/page.tsx");
/** The tenant half of the page, which also holds the provider's list. */
const webTenant = () => {
  const page = web();
  const start = page.indexOf("function TenantApplications");
  const end = page.indexOf("function ProviderApplications");
  assert.ok(start !== -1 && end > start, "failed to slice the tenant half");
  return page.slice(start, end);
};
const list = () => read("mobile/app/(app)/applications.tsx");
const record = () => read("mobile/app/(app)/application/[id].tsx");

/** One function's body. The web page also holds the provider's side. */
function body(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} was not found`);
  const rest = source.slice(start);
  const end = rest.indexOf("\n}\n");
  assert.notEqual(end, -1, `${name} did not close at the top level`);
  return rest.slice(0, end);
}

test("what an application means is decided once, for both clients", () => {
  // Two clients answering "where does this stand" differently is how a tenant
  // is told one thing on the phone and another on the laptop.
  const strip = (source) => source.replace(/^\/\*\*[\s\S]*?\*\/\n/, "").trim();
  assert.equal(
    strip(read("web/src/lib/applicationMeaning.ts")),
    strip(read("mobile/src/applicationMeaning.ts")),
  );
});

test("acceptance is not the end of the story, so the lease is read too", () => {
  // "Accepted" alone never says whether an agreement is waiting for you.
  const meaning = read("web/src/lib/applicationMeaning.ts");
  assert.match(meaning, /Agreement ready for you/);
  assert.match(meaning, /Agreement being prepared/);
  assert.match(meaning, /case "offered"/);
  for (const source of [web(), list()]) assert.match(source, /listMyLeases/);
});

test("a row is a photograph, a place and one line", () => {
  const rows = [body(web(), "ApplicationRow"), body(list(), "Row")];
  for (const row of rows) {
    assert.match(row, /photo_url/);
    assert.match(row, /placeOf\(application\)/);
    // The old cards carried a status word *and* a sentence explaining that
    // status word. One line replaces both.
    assert.doesNotMatch(row, /status_display/);
    // And the claim set is not on the row at all.
    assert.doesNotMatch(row, /guarantor|occupation|income_band/);
  }
  for (const source of [web(), list()]) {
    assert.doesNotMatch(source, /Sent\. Waiting for the landlord to look at it/);
    assert.doesNotMatch(source, /they may still say yes/);
  }
});

test("application history is filter-driven and visible by default", () => {
  const meaning = read("web/src/lib/applicationMeaning.ts");

  // The buckets are lifecycle meaning, not labels independently invented in
  // each UI. All is the default and gives every outcome a visible section.
  assert.match(meaning, /export type ApplicationFilter = "all" \| "action" \| "open" \| "approved" \| "past"/);
  assert.match(meaning, /export function applicationBucket\(/);
  for (const label of ["All", "Needs you", "In progress", "Approved", "Past"]) {
    assert.match(meaning, new RegExp(`label: "${label}"`));
  }

  // The phone still keeps its filter in state; web moved it to the address so
  // returning from a record lands on the same filter.
  assert.match(list(), /useState<ApplicationFilter>\("all"\)/);
  assert.match(webTenant(), /search\.get\("show"\)/);
  for (const source of [webTenant(), list()]) {
    assert.match(source, /applicationFilters\.map/);
    assert.doesNotMatch(source, /Past applications \(/);
  }

  // History is neither a web disclosure nor a mobile expand/collapse button.
  assert.doesNotMatch(webTenant(), /<details className="applications-past"/);
  assert.doesNotMatch(list(), /showPast|accessibilityState=\{\{ expanded:/);
});

test("the claim set is one disclosure behind the record", () => {
  // Occupation, employer, guarantor and the covering message are things the
  // tenant wrote. They are there to be checked, not scanned.
  for (const source of [webRecord(), record()]) {
    assert.match(source, /What you told them/);
    assert.match(source, /guarantor_name/);
  }
});

test("withdrawing asks first", () => {
  // It cannot be undone and it releases the Unit. The old screens withdrew on
  // one tap, straight from the list.
  for (const source of [webRecord(), record()]) {
    assert.match(source, /cannot be undone/);
    assert.match(source, /confirming/);
  }
  assert.doesNotMatch(list(), /withdrawApplication/);
});

test("an application record is a place, not an overlay", () => {
  // It was a `<dialog showModal()>` on web and a sheet on mobile. An
  // application is read *against* the other applications somebody has out, and
  // a modal hid exactly the context that makes it legible — then closed itself
  // on a stray click part-way through reading.
  const page = read("web/app/applications/page.tsx");
  const css = read("web/src/styles/applications-workspace.css");

  // Both sides are pages now. It was a dialog, then a pane; the pane could not
  // be linked to either, and the phone had already given this record a screen.
  assert.doesNotMatch(page, /showModal\(\)/);
  assert.doesNotMatch(page, /application-dialog/);
  assert.doesNotMatch(css, /\.application-dialog/);
  assert.match(webRoute(), /<ApplicationRecord/);
  assert.match(webTenant(), /href=\{`\/applications\/\$\{application\.id\}`/);

  const layout = read("mobile/app/(app)/_layout.tsx");
  const line = layout.split(/\r?\n/).find((row) => row.includes('name="application/[id]"'));
  assert.ok(line && !line.includes("presentation"), "mobile opens a screen, not a sheet");

  // Withdrawal keeps its confirmation, which is the one thing here that a
  // lightweight, focused prompt genuinely suits — and it is inline, so it
  // cannot bury the record it is about.
  assert.match(webRecord(), /Withdraw\? This cannot be undone\./);
  assert.match(webRecord(), /application-confirm/);
});

test("the comparison happens in the list, which is why the record can leave it", () => {
  // This replaces two tests that asserted the split pane. Their premise was
  // sound — *"an application record is a thing somebody reads against the other
  // applications they have out"* — and the pane is not what delivered it. The
  // list does: every row carries `standing()`, the one line that says where an
  // application stands, so four of them can be compared without opening any.
  //
  // What the record adds is the detail behind one row, and that is a record,
  // with an address. The phone had always treated it that way.
  const css = read("web/src/styles/applications-workspace.css");

  assert.match(webTenant(), /standing\(application, leases\)/);
  // The stage is part of the class, so the row states it visually too.
  assert.match(webTenant(), /application-standing is-\$\{state\.stage\}/);
  // The rendered line, not the row's aria-label — `${state.line}` in the label
  // contains `{state.line}`, so the bare form matched while the visible line
  // was gone.
  assert.match(webTenant(), /\n\s+\{state\.line\}\n/);
  assert.match(css, /\.application-standing\.is-action/);

  // Nothing is opened for anybody: the pane used to fall back to the first row.
  assert.doesNotMatch(webTenant(), /const suggested = visibleRows\[0\]/);
  assert.doesNotMatch(webTenant(), /data-open=/);
  assert.doesNotMatch(css, /\.applications-split/);
  assert.doesNotMatch(css, /\.application-detail-back/);

  // And the way back is the breadcrumb the other record pages use.
  //
  // Read from the tenant half of that route, not the whole file: it holds the
  // provider's reading too, and a file-wide match for `<EntityPath` stayed
  // green with the tenant's breadcrumb gone.
  const route = webRoute();
  const tenantRoute = route.slice(route.indexOf("function TenantApplication()"));
  assert.ok(tenantRoute.length > 400, "failed to slice the tenant route");
  assert.match(tenantRoute, /<EntityPath/);
  assert.match(tenantRoute, /mobileLabel: "Back to Applications"/);
});

test("a wait looks like what is coming", () => {
  // Both clients replaced a bare "Loading…" line, which moved the page under
  // the reader when the data landed.
  const mobile = read("mobile/app/(app)/applications.tsx");
  assert.match(mobile, /<ApplicationSkeleton \/>/);
  assert.match(mobile, /accessibilityRole="progressbar"/);
  assert.doesNotMatch(mobile, /variant="caption">Loading…/);
});

test("the record shows the journey, not just where it stopped", () => {
  const meaning = read("web/src/lib/applicationMeaning.ts");
  assert.match(meaning, /export function timeline\(/);

  // Both clients draw the same steps from the same function, so the row and
  // the record can never describe one application differently.
  assert.match(webRecord(), /timeline\(application, leases\)/);
  assert.match(read("mobile/app/(app)/application/[id].tsx"), /timeline\(application, leases\)/);

  // A withdrawn application is two steps, not four greyed-out ones implying
  // the person failed at each.
  assert.match(meaning, /if \(application\.status === "withdrawn"\)/);
  assert.match(meaning, /label: "You withdrew this", state: "stopped"/);

  // Dates come only from the two the record actually carries.
  assert.match(meaning, /when: application\.created_at/);
  assert.match(meaning, /when: application\.decided_at/);
  assert.doesNotMatch(meaning, /Date\.now\(\)|new Date\(\)/);
});

test("a step is never told apart by colour alone", () => {
  const css = read("web/src/styles/applications-workspace.css");
  const native = read("mobile/src/components/applications/ApplicationTimeline.tsx");

  // Web: the mark changes fill, the current one gains an inset ring, and the
  // label changes weight.
  assert.match(css, /\[data-state="current"\] \.application-timeline-mark \{[\s\S]{0,160}box-shadow: inset/);
  assert.match(css, /\[data-state="current"\] \.application-timeline-text strong \{ font-weight: 700/);
  assert.match(css, /\[data-state="waiting"\] \.application-timeline-text strong \{ color/);

  // Mobile: a different glyph per state, and the weight moves too.
  assert.match(native, /if \(state === "done"\) return "checkmark-circle"/);
  assert.match(native, /if \(state === "current"\) return "radio-button-on"/);
  assert.match(native, /if \(state === "stopped"\) return "close-circle"/);
  assert.match(native, /variant=\{step\.state === "current" \? "bodyStrong" : "body"\}/);
});

test("the agreement link opens the agreement, not the list of them", () => {
  // It pointed at /leases and /(app)/leases — the whole list — when the
  // application already knows which agreement it became.
  // The agreement has an address of its own now, so the link names it rather
  // than asking the list to open something.
  assert.match(webRecord(), /`\/leases\/\$\{state\.leaseId\}`/);
  assert.match(
    read("mobile/app/(app)/application/[id].tsx"),
    /pathname: "\/\(app\)\/agreement\/\[id\]"/,
  );

  // And the destination honours it. Without this the link lands on the list
  // with nothing open, which is a dead deep link dressed as a working one.
  // And links already sent out with `?open=` still arrive somewhere real: the
  // list forwards them to the record instead of showing a list with nothing
  // open, which is a dead deep link dressed as a working one.
  const leases = read("web/app/leases/page.tsx");
  assert.match(leases, /search\.get\("open"\)/);
  assert.match(leases, /router\.replace\(`\/leases\/\$\{requested\}`/);
  // `useSearchParams` suspends, so the page that reads it needs a boundary.
  assert.match(leases, /<Suspense fallback=/);
});

test("a row fits the column it is in, not the one it was drawn for", () => {
  const css = read("web/src/styles/applications-workspace.css");

  // These rows were built for a full-width list and then put in the 20rem list
  // column of the list/detail split. 6rem + 13rem + two gaps + padding is 360px
  // of fixed width in a 320px column: the flexible identity track was crushed
  // to zero and the title wrapped to five lines. Measured, not guessed.
  //
  // So the narrow case is the default and the three-track form is the opt-in,
  // keyed to the list rather than the window — the same viewport gives this
  // column two very different widths depending on whether the panel is beside
  // it.
  assert.match(css, /\.applications-list \{[\s\S]{0,220}container-type: inline-size/);
  assert.match(css, /container-name: application-list/);
  assert.match(css, /\.application-row \{[\s\S]{0,120}grid-template-columns: 4rem minmax\(0, 1fr\)/);
  assert.match(css, /@container application-list \(min-width: 38rem\)/);
  assert.match(
    css,
    /@container application-list[\s\S]{0,200}grid-template-columns: 6rem minmax\(0, 1fr\) minmax\(0, 13rem\)/,
  );

  // Across the full width the standing is one line with the time at the far
  // end; stacked it read as three short rows and made every item 200px tall.
  assert.match(css, /\.application-row \.application-standing \{[\s\S]{0,200}display: flex/);
  assert.match(css, /\.application-row \.application-standing em \{ margin-left: auto/);
  // And the stacked form gets its own metrics back, not the strip's.
  assert.match(css, /@container application-list[\s\S]{0,600}align-items: normal;\s*\n\s*gap: 2px/);

  // A list is scanned; a name that runs to five lines stops being scannable.
  assert.match(css, /-webkit-line-clamp: 2/);
});
