/**
 * A tenant's own viewings, laid out the way every other list is.
 *
 * The seventh surface and the last of the split views: three counts, a search,
 * the stages as pills, linked rows, and the record at its own address.
 * `/viewings/<viewingId>` branches on session exactly as `/viewings` does.
 *
 * A viewing is the strongest case in the product for the record having an
 * address — it is a workflow that runs across a day, and the tenant half is
 * where somebody stands at a junction with a phone deciding whether to get in
 * a taxi.
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

function rule(sheet, selector) {
  const at = sheet.indexOf(selector + " {");
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

test("a tenant's viewing opens at its own address", () => {
  assert.ok(existsSync(resolve(root, "web/app/viewings/[viewingId]/page.tsx")));
  assert.match(tenantRoute(), /viewings\?\.find\(\(row\) => row\.id === viewingId\)/);
  assert.match(tenantRoute(), /<ViewingRecord/);

  const body = tenantHalf();
  assert.doesNotMatch(body, /tenant-viewings-split/);
  assert.doesNotMatch(body, /<ViewingRecord/);
  assert.doesNotMatch(body, /openId/);
  assert.doesNotMatch(css(), /\.tenant-viewings-split/);
  assert.doesNotMatch(css(), /\.viewing-record-back/);

  assert.match(body, /href=\{`\/viewings\/\$\{viewing\.id\}` as never\}/);
});

test("one address serves both sides, and branches the way the list does", () => {
  const body = code(route());
  assert.match(body, /useSession\(\)/);
  assert.match(body, /capabilities\.active_workspace === "provider"/);
  assert.match(body, /asProvider \? <HostViewing \/> : <TenantViewing \/>/);
  assert.match(body, /listHostViewings/);
  assert.match(body, /listMyViewings/);
});

test("the page is laid out the way every other list is", () => {
  const body = tenantHalf();

  const order = [
    "tenant-viewings-overview",
    "tenant-viewings-search",
    "tenant-viewings-filters",
    "tenant-viewings-list",
  ];
  let at = -1;
  for (const className of order) {
    const found = body.search(new RegExp(`className="${className}"`));
    assert.notEqual(found, -1, `${className} is not rendered`);
    assert.ok(found > at, `${className} is out of order`);
    at = found;
  }

  assert.match(rule(css(), ".tenant-viewings-overview"), /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(rule(css(), ".tenant-viewings-overview dd"), /font-family: var\(--font-display\)/);
  assert.match(rule(css(), ".tenant-viewings-filters button"), /border-radius: 999px/);
  assert.match(css(), /\.tenant-viewings-filters button\[aria-pressed="true"\][\s\S]{0,140}--color-kola-50/);
  assert.match(rule(css(), ".tenant-viewings-search"), /width: min\(100%, 30rem\)/);

  // The stage is a pill, so a heading above each group would name it twice.
  assert.doesNotMatch(code(list()), /function ViewingGroupSection\(/);
  assert.doesNotMatch(css(), /\.viewings-group/);
});

test("this sheet no longer names a class the host's sheet already owns", () => {
  // Both declared `.viewings-list`, and this one loads second — so the host's
  // list had been taking its `display: grid` from the tenant's stylesheet.
  // Prefixing the tenant's furniture clears a collision nobody had noticed.
  assert.doesNotMatch(css(), /^\.viewings-list \{/m);
  assert.match(css(), /\.tenant-viewings-list \{/);
  assert.match(read("web/src/styles/viewings-workspace.css"), /\.viewings-list \{/);
});

test("the counts are narrower than the pills beside them", () => {
  const body = tenantHalf();
  assert.match(body, /total: rows\.length/);
  assert.match(body, /row\.viewing\.status === "confirmed"/);
  assert.match(body, /row\.viewing\.status === "completed"/);
  // Not the stage groups, which are what the pills already count.
  const totals = body.slice(body.indexOf("const totals ="), body.indexOf("const visible ="));
  assert.doesNotMatch(totals, /state\.group/);
});

test("a reminder still points straight at one appointment", () => {
  const body = tenantHalf();
  assert.match(body, /window\.location\.hash\.startsWith\("#viewing-"\)/);
  assert.match(body, /router\.replace\(`\/viewings\/\$\{window\.location\.hash\.slice\("#viewing-"\.length\)\}`/);
});

test("the row is a link, and nothing inside it pretends to be a button", () => {
  // It carried a span painted as a control reading the call to action. The row
  // is the link; the chevron says where it goes.
  const body = tenantHalf();
  assert.doesNotMatch(body, /className=\{state\.callToAction \? "viewing-primary"/);
  assert.doesNotMatch(css(), /\.viewing-primary/);
  assert.doesNotMatch(css(), /\.viewing-secondary/);

  // The call to action itself is the mirrored module's and is not thrown away:
  // it goes into the accessible name, which is what the phone already does.
  assert.match(body, /state\.callToAction \?\? "View details"/);
  assert.match(body, /aria-label=/);
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
  // Soonest first. A schedule ordered by when the request was made is not one.
  assert.match(body, /bySoonest\(a\.viewing, b\.viewing\)/);
  assert.doesNotMatch(code(list()), /^function (standing|whenLabel|bySoonest)\(/m);
});

test("leaving a viewing and coming back lands where you left", () => {
  const body = tenantHalf();
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(body, /viewingFilters\.map/);
  assert.match(code(list()), /<Suspense/);
});
