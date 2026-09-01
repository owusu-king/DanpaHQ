/**
 * A tenant's own applications, laid out the way the provider's lists are.
 *
 * The fifth surface to take the shape, and the first on the tenant's side:
 * three counts, a search, the stages as pills, linked rows, and the record at
 * its own address.
 *
 * The split it replaced was a considered choice — *"an application record is a
 * thing somebody reads against the other applications they have out"* — and
 * that reading is preserved rather than discarded: the list is where the
 * comparison happens, because every row carries `standing()`, the one line that
 * says where an application stands. The record holds the detail behind one of
 * them. The phone has always given that detail a screen of its own, so this
 * brings web into line rather than away.
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

const list = () => read("web/app/applications/page.tsx");
const detail = () => read("web/app/applications/[requestId]/page.tsx");
const record = () => read("web/src/components/applications/ApplicationRecord.tsx");
const css = () => read("web/src/styles/applications-workspace.css");

/** The tenant half only; the provider half is asserted by its own contract. */
const tenantHalf = () => {
  const source = code(list());
  const start = source.indexOf("function TenantApplications()");
  assert.notEqual(start, -1, "TenantApplications is gone");
  const end = source.indexOf("function ProviderApplications()");
  assert.notEqual(end, -1, "the provider half is gone");
  return source.slice(start, end);
};

function rule(sheet, selector) {
  const at = sheet.indexOf(selector + " {");
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

test("a tenant's application opens at its own address", () => {
  assert.ok(existsSync(resolve(root, "web/app/applications/[requestId]/page.tsx")));
  assert.match(code(detail()), /applications\?\.find\(\(row\) => row\.id === requestId\)/);
  assert.match(code(detail()), /<ApplicationRecord/);

  const body = tenantHalf();
  assert.doesNotMatch(body, /applications-split/);
  assert.doesNotMatch(body, /ApplicationRecord/);
  assert.doesNotMatch(body, /openId/);
  assert.doesNotMatch(css(), /\.applications-split/);
  assert.doesNotMatch(css(), /\.applications-column/);

  assert.match(body, /href=\{`\/applications\/\$\{application\.id\}` as never\}/);
  assert.doesNotMatch(body, /<button\s+type="button"\s+className="application-row"/);
  assert.match(rule(css(), ".application-row"), /text-decoration: none/);
});

test("one address serves both sides, and branches the way the list does", () => {
  // "The application record that concerns me", read from whichever side this
  // account is on. A tenant landing on the provider's reading would call
  // endpoints they have no business calling.
  const body = code(detail());
  assert.match(body, /useSession\(\)/);
  assert.match(body, /capabilities\.active_workspace === "provider"/);
  assert.match(body, /asProvider \? <ProviderRequest \/> : <TenantApplication \/>/);
  // Each side uses its own loader.
  assert.match(body, /useProviderRequests/);
  assert.match(body, /listMyApplications/);
});

test("the page is laid out the way the provider's lists are", () => {
  const body = tenantHalf();

  const order = [
    "applications-overview",
    "applications-search",
    "applications-filters",
    "applications-list",
  ];
  let at = -1;
  for (const className of order) {
    const found = body.search(new RegExp(`className="${className}"`));
    assert.notEqual(found, -1, `${className} is not rendered`);
    assert.ok(found > at, `${className} is out of order`);
    at = found;
  }

  assert.match(rule(css(), ".applications-overview"), /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(rule(css(), ".applications-overview dd"), /font-family: var\(--font-display\)/);
  assert.match(rule(css(), ".applications-filters button"), /border-radius: 999px/);
  assert.match(css(), /\.applications-filters button\[aria-pressed="true"\][\s\S]{0,140}--color-kola-50/);
  assert.match(rule(css(), ".applications-search"), /width: min\(100%, 30rem\)/);

  // The stage is chosen by a pill, so a heading above each group would name it
  // twice — the groups are gone.
  assert.doesNotMatch(code(list()), /function ApplicationGroup\(/);
  assert.doesNotMatch(css(), /\.applications-group/);
});

test("approved and turned down count decisions, not departures", () => {
  // An application this tenant withdrew was not turned down by anybody, so the
  // three numbers do not sum to the total — the same rule the provider's side
  // holds for the very same records.
  const body = tenantHalf();
  assert.match(body, /row\.application\.status === "accepted"/);
  assert.match(body, /row\.application\.status === "rejected"/);
  assert.doesNotMatch(body, /"withdrawn"/);
  assert.match(body, /total: rows\.length/);
  assert.match(body, /label="Turned down"/);
});

test("leaving an application and coming back lands where you left", () => {
  const body = tenantHalf();
  assert.match(body, /useSearchParams\(\)/);
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(body, /router\.replace\(/);
  assert.match(code(list()), /<Suspense/);
});

test("what an application means is still decided by the mirrored module", () => {
  // `applicationMeaning.ts` is shared with the phone byte for byte. Moving the
  // record must not have started a second opinion about where an application
  // stands.
  const body = tenantHalf();
  assert.match(body, /standing\(application, leases\)/);
  assert.match(body, /applicationBucket\(application, leases\)/);
  assert.match(body, /matchesApplicationFilter\(row\.bucket, filter\)/);
  assert.match(code(record()), /from "@\/lib\/applicationMeaning"/);
  assert.doesNotMatch(code(list()), /^function (standing|applicationBucket)\(/m);
});

test("withdrawing is still asked about, and still irreversible", () => {
  const body = code(record());
  assert.match(body, /withdrawMyApplication\(application\.id, "No longer needed"\)/);
  assert.match(body, /Withdraw\? This cannot be undone\./);
  assert.match(body, /setConfirming\(true\)/);
  // The pane used to close itself; the page returns to the list it came from.
  assert.match(body, /router\.push\("\/applications"\)/);
});
