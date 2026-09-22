/**
 * The tenant application history is a calm, durable record rather than a
 * miniature provider queue. Property and unit identity lead each row,
 * `standing()` supplies the shared human-readable status, current and past
 * records remain visible, and a single lifecycle control appears only when it
 * is useful. A row opens the shared record in context while retaining its
 * durable address for deep links and modified clicks.
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

test("a tenant application opens in context and keeps its deep link", () => {
  assert.ok(existsSync(resolve(root, "web/app/applications/[requestId]/page.tsx")));
  assert.match(code(detail()), /applications\?\.find\(\(row\) => row\.id === requestId\)/);
  assert.match(code(detail()), /<ApplicationRecord/);

  const body = tenantHalf();
  assert.doesNotMatch(body, /applications-split/);
  assert.doesNotMatch(css(), /\.applications-split/);
  assert.doesNotMatch(css(), /\.applications-column/);

  assert.match(body, /<ApplicationDetailModal/);
  assert.match(body, /selectedApplicationId/);
  assert.match(body, /event\.preventDefault\(\)/);
  assert.match(body, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(body, /href=\{`\/applications\/\$\{application\.id\}` as never\}/);
  assert.doesNotMatch(body, /<button\s+type="button"\s+className="application-row"/);
  assert.match(rule(css(), ".application-row"), /text-decoration: none/);
  assert.match(record(), /<dialog/);
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

test("the tenant page uses one restrained control and a structured history", () => {
  const body = tenantHalf();
  const sheet = css();

  // Summary cards and filter pills no longer delay the records.
  assert.doesNotMatch(body, /applications-overview/);
  assert.doesNotMatch(body, /applications-filters/);
  assert.doesNotMatch(sheet, /\.applications-filters/);

  // Search earns its space only for a longer collection. Lifecycle filtering is
  // one compact, grouped chooser; the active view and its count stay visible.
  assert.match(body, /showSearch = \(applications\?\.length \?\? 0\) > 5 \|\| Boolean\(query\)/);
  assert.doesNotMatch(body, /<select/);
  assert.match(body, /aria-haspopup="menu"/);
  assert.match(body, /application-filter-label[\s\S]{0,120}All applications[\s\S]{0,80}selectedLabel/);
  assert.match(body, /role="menuitemradio"/);
  assert.match(body, /Active journey/);
  assert.match(body, /<ApplicationGroup title="Current"/);
  assert.match(body, /<ApplicationGroup title="History"[\s\S]{0,140}historical/);

  assert.match(rule(sheet, ".applications-list"), /container: application-list \/ inline-size/);
  assert.match(sheet, /\.application-group\.is-history \.applications-list/);
  assert.match(sheet, /\.application-row\.is-action::before/);
});

test("large histories progressively disclose records instead of rendering all at once", () => {
  const body = tenantHalf();

  // No lifecycle view renders more than five records initially. In All, the
  // two visible groups share that allowance so history remains discoverable.
  assert.match(body, /const initialCurrentLimit = Math\.min\(current\.length, history\.length \? 4 : 5\)/);
  assert.match(body, /const initialHistoryLimit = Math\.min\(history\.length, Math\.max\(0, 5 - initialCurrentLimit\)\)/);
  assert.match(body, /title="Current"[\s\S]{0,120}initialLimit=\{initialCurrentLimit\}/);
  assert.match(body, /title="History"[\s\S]{0,140}initialLimit=\{initialHistoryLimit\}/);
  assert.match(body, /key=\{`\$\{filter\}:\$\{query\}`\}[\s\S]{0,240}initialLimit=\{5\}/);
  assert.match(body, /const shown = rows\.slice\(0, limit\)/);
  assert.match(body, /currentLimit \+ pageSize/);
  assert.match(body, /const pageSize = 5/);
});

test("dense rows keep status calm until interaction", () => {
  const sheet = css();
  assert.match(sheet, /@container application-list \(min-width: 44rem\)[\s\S]{0,420}min-height: 4\.625rem/);
  assert.match(sheet, /\.application-status-line i \{[\s\S]{0,300}box-shadow: 0 0 0 0 transparent/);
  assert.match(sheet, /\.application-row:hover \.application-status-line i/);
  assert.match(sheet, /\.application-row-action \.portal-icon[\s\S]{0,180}rotate\(-90deg\)/);
});

test("actionable applications lead without inventing lifecycle meaning", () => {
  const body = tenantHalf();

  // The existing meaning layer still owns every bucket. The UI only ranks its
  // output, so an offered agreement leads and history remains last.
  assert.match(body, /action: 0,\s*open: 1,\s*approved: 2,\s*past: 3/);
  assert.match(body, /applicationSummary\(counts, rows\.length\)/);
  assert.match(body, /counts\.action === 1/);
  assert.match(body, /state\.stage === "action" \? "Review" : "View"/);
  assert.doesNotMatch(body, /status_display/);
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
