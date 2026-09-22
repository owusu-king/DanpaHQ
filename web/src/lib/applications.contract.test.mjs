import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const web = () => read("web/app/applications/page.tsx");
// The tenant reads the record in context from the list, while `/applications/<id>` remains
// the durable deep link. Both presentations reuse the same record component.
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

test("a row is a photograph, a Property and Unit, and one status line", () => {
  const webRow = body(web(), "ApplicationRow");
  const mobileRow = body(list(), "Row");

  for (const row of [webRow, mobileRow]) {
    assert.match(row, /photo_url/);
    // The old cards carried a status word and a sentence explaining it.
    assert.doesNotMatch(row, /status_display/);
    // The tenant's claim set belongs in the record, not the scan.
    assert.doesNotMatch(row, /guarantor|occupation|income_band/);
  }

  // Web uses the durable names the API already supplies. Mobile keeps its
  // shared compact place line until that surface is redesigned separately.
  assert.match(webRow, /application\.property_title/);
  assert.match(webRow, /application\.unit_label/);
  assert.match(webRow, /application\.locality_name/);
  assert.match(mobileRow, /placeOf\(application\)/);

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
  assert.doesNotMatch(list(), /showPast|aria-expanded=/);
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

test("a tenant record opens in context without surrendering its address", () => {
  const record = webRecord();
  const css = read("web/src/styles/applications-workspace.css");

  // Ordinary clicks stay with the comparison list, while the real href remains
  // available for copied links, modified clicks and direct navigation.
  assert.match(webTenant(), /<ApplicationDetailModal/);
  assert.match(webTenant(), /event\.preventDefault\(\)/);
  assert.match(webTenant(), /href=\{`\/applications\/\$\{application\.id\}`/);
  assert.match(webRoute(), /<ApplicationRecord/);

  // Native dialog semantics provide focus trapping and scroll locking. Closing
  // restores the row, and every dismissal path shares the animated close.
  assert.match(record, /<dialog/);
  assert.match(record, /showModal\(\)/);
  assert.match(record, /aria-labelledby="application-modal-title"/);
  assert.match(record, /onCancel=/);
  assert.match(record, /opener\?\.focus/);
  assert.match(css, /\.application-modal::backdrop/);
  assert.match(css, /\.application-modal\.is-leaving/);
  assert.match(css, /\.application-modal \{[\s\S]{0,220}width: min\(54rem[\s\S]{0,140}height: var\(--application-modal-height, auto\)[\s\S]{0,100}max-height: min\(38rem/);
  assert.match(record, /style\.setProperty\("--application-modal-height"[\s\S]{0,140}offsetHeight/);
  assert.match(css, /\.application-modal-surface \{[\s\S]{0,180}overflow: hidden/);
  assert.match(css, /\.application-modal \.application-detail-body \{[\s\S]{0,300}overflow-y: auto[\s\S]{0,180}scrollbar-gutter: stable/);
  assert.match(css, /\.application-modal \.application-detail-body::-webkit-scrollbar-thumb/);
  assert.match(css, /\.application-modal \.application-detail \{[\s\S]{0,180}grid-template-rows: auto minmax\(0, 1fr\) auto[\s\S]{0,120}height: 100%/);
  assert.match(css, /\.application-modal \.application-detail-head \{[\s\S]{0,100}position: sticky[\s\S]{0,80}top: 0/);
  assert.match(record, /data-body-scrolled=\{bodyScrolled \|\| undefined\}/);
  assert.match(css, /data-body-scrolled="true"[\s\S]{0,180}box-shadow:/);
  assert.match(css, /\.application-modal \.application-detail-foot \{[\s\S]{0,100}position: relative/);
  assert.match(record, /application-detail-context-actions[\s\S]{0,420}View listing/);
  assert.match(css, /@media \(max-width: 42rem\)[\s\S]{0,240}max-height: calc\(100dvh - \.75rem\)/);

  // Mobile keeps its established dedicated screen; this request is web-only.
  const layout = read("mobile/app/(app)/_layout.tsx");
  const line = layout.split(/\r?\n/).find((row) => row.includes('name="application/[id]"'));
  assert.ok(line && !line.includes("presentation"), "mobile opens a screen, not a sheet");

  assert.match(record, /Withdraw\? This cannot be undone\./);
  assert.match(record, /application-confirm/);
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
  assert.match(webTenant(), /<strong>\{state\.line\}<\/strong>/);
  assert.match(css, /\.application-standing\.is-action/);

  // Nothing opens by default: the modal is selected only by an explicit row action.
  assert.doesNotMatch(webTenant(), /const suggested = visibleRows\[0\]/);
  assert.match(webTenant(), /useState<string \| null>\(null\)/);
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
  assert.match(css, /\[data-state="current"\] \.application-timeline-text strong \{[\s\S]{0,100}font-weight: 7/);
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

test("a row responds to its reclaimed content width", () => {
  const css = read("web/src/styles/applications-workspace.css");

  // The list responds to the space the global shell gives it, including when
  // the sidebar collapses. It does not infer that space from viewport width.
  assert.match(css, /\.applications-list \{[\s\S]{0,500}container: application-list \/ inline-size/);
  assert.match(css, /\.application-row \{[\s\S]{0,180}grid-template-columns: 4\.25rem minmax\(0, 1fr\) 2rem/);
  assert.match(css, /@container application-list \(min-width: 44rem\)/);
  assert.match(css, /@container application-list \(min-width: 68rem\)/);
  assert.match(
    css,
    /@container application-list \(min-width: 68rem\)[\s\S]{0,300}grid-template-columns: 4\.5rem minmax\(14rem, 1\.15fr\)/,
  );

  // Property and Unit stay one-line scan anchors; metadata gets its own area
  // instead of squeezing the identity column.
  assert.match(css, /\.application-identity strong \{[\s\S]{0,240}text-overflow: ellipsis;[\s\S]{0,80}white-space: nowrap/);
  assert.match(css, /\.application-row-meta \{[\s\S]{0,120}grid-area: meta/);
});
