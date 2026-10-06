/**
 * The tenant application history is a calm, durable record rather than a
 * miniature provider queue — but it lives in the same workspace as the
 * provider's pages: the shared head, the segmented stages, one quiet panel,
 * and the record in the shared sheet. Property and unit identity lead each
 * row, `standing()` supplies the one human-readable status, current and past
 * records remain visible, and controls appear only when they are useful. A row
 * opens the record over the list, kept in the address, while retaining its
 * durable link for deep links and modified clicks.
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

test("a tenant application opens over the list, kept in the address, and keeps its deep link", () => {
  assert.ok(existsSync(resolve(root, "web/app/applications/[requestId]/page.tsx")));
  assert.match(code(detail()), /applications\?\.find\(\(row\) => row\.id === requestId\)/);
  assert.match(code(detail()), /<ApplicationRecord/);

  const body = tenantHalf();
  assert.doesNotMatch(body, /applications-split/);
  assert.doesNotMatch(css(), /\.applications-split/);

  // The open record is part of the address, the way a provider's request is,
  // so Back, a refresh or a copied link return to it.
  assert.match(body, /search\.get\("application"\)/);
  assert.match(body, /setParams\(\{ application: applicationId \}\)/);
  assert.match(body, /<ApplicationSheet/);
  assert.match(body, /onClose=\{\(\) => setParams\(\{ application: "" \}\)\}/);

  // A plain click opens the sheet; any modified click is left to the link.
  assert.match(body, /event\.preventDefault\(\)/);
  assert.match(body, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(body, /href=\{`\/applications\/\$\{application\.id\}` as never\}/);
  assert.match(body, /aria-haspopup="dialog"/);
  assert.match(rule(css(), ".application-row"), /text-decoration: none/);

  // The sheet is the shared one, so it behaves exactly like every other modal.
  assert.match(code(record()), /<ModalSheet/);
  assert.match(code(record()), /className="request-sheet application-sheet"/);
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

test("the tenant page is the shared workspace, with controls that earn their space", () => {
  const body = tenantHalf();

  // The same frame as every provider list: head, stages, one panel.
  assert.match(body, /className="ws-page applications-workspace"/);
  assert.match(body, /<WorkspaceHead\s+icon="applications"\s+title="Applications"/);
  assert.match(body, /className=\{?"ws-panel applications-panel"/);
  assert.ok(body.indexOf("<SegmentedControl") < body.indexOf('className="ws-panel applications-panel"'), "the stages lead the panel");

  // No summary cards, no filter pills, no native selects.
  assert.doesNotMatch(body, /applications-overview/);
  assert.doesNotMatch(body, /applications-filters/);
  assert.doesNotMatch(body, /<select/);

  // Search earns its space only for a longer collection; the stages only once
  // applications sit in more than one of them.
  assert.match(body, /showSearch = \(applications\?\.length \?\? 0\) > 5 \|\| Boolean\(query\)/);
  assert.match(body, /showFilter = new Set\(rows\.map\(\(row\) => row\.bucket\)\)\.size > 1 \|\| filter !== "all"/);
  assert.match(body, /\{showFilter \? \(\s*<SegmentedControl/);
  assert.match(body, /\{showSearch \? \(\s*<div className="ws-panel-head">\s*<PanelSearch/);
  assert.match(body, /applicationFilters\.map\(\(option\) => \(\{ key: option\.id, label: option\.label, count: counts\[option\.id\] \}\)\)/);

  // Current and history are both visible by default, as workspace groups.
  assert.match(body, /<ApplicationGroup title="Current"/);
  assert.match(body, /<ApplicationGroup title="History"[\s\S]{0,140}historical/);
  assert.match(body, /className=\{`ws-group application-group/);
  assert.match(body, /className={`ws-group-heading/);

  assert.match(rule(css(), ".applications-list"), /container: application-list \/ inline-size/);
  assert.match(css(), /\.application-group\.is-history \.applications-list/);
  assert.match(css(), /\.application-row\.is-action::before/);
});

test("every state is designed inside the panel", () => {
  const body = tenantHalf();
  // Loading keeps the row's shape; failure, first use, no matches and an empty
  // stage each say what happened and offer the way on.
  assert.match(body, /loading \? <PanelSkeleton/);
  assert.match(body, /<PanelState\s+tone="error"[\s\S]{0,400}Try again/);
  assert.match(body, /title="Your rental journey starts here"[\s\S]{0,300}href="\/rentals"/);
  assert.match(body, /Nothing matches[\s\S]{0,200}Clear search/);
  assert.match(body, /Show all applications/);
  // A reload that fails over records already shown says so in place.
  assert.match(body, /error && rows\.length \? \(\s*<div className="ws-inline-error"/);
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
  assert.match(sheet, /@container application-list \(min-width: 40rem\)[\s\S]{0,420}min-height: 4\.5rem/);
  assert.match(sheet, /\.application-status-line i \{[\s\S]{0,300}box-shadow: 0 0 0 0 transparent/);
  assert.match(sheet, /\.application-row:hover \.application-status-line i/);
  // Only the status that asks something of them moves, and not under reduced motion.
  assert.match(sheet, /\.application-row\[data-tone="action"\] \.application-status-line i \{ animation: application-breathe/);
  assert.match(sheet, /prefers-reduced-motion[\s\S]*\.application-row\[data-tone="action"\] \.application-status-line i \{ animation: none; \}/);
});

test("actionable applications lead without inventing lifecycle meaning", () => {
  const body = tenantHalf();

  // The existing meaning layer still owns every bucket. The UI only ranks its
  // output, so an offered agreement leads and history remains last.
  assert.match(body, /action: 0,\s*open: 1,\s*approved: 2,\s*past: 3/);
  assert.match(body, /<ApplicationSummary counts=\{counts\}/);
  assert.match(body, /counts\.action === 1/);
  assert.doesNotMatch(body, /status_display/);

  // An agreement waiting for them is lifted above the list, in the unfiltered
  // view only, and goes straight to the agreement.
  assert.match(body, /const ready = rows\.filter\(\(row\) => row\.bucket === "action"\)/);
  assert.match(body, /unfilteredView && ready\.length \? \(\s*<NextUp/);
  assert.match(body, /`\/leases\/\$\{ready\[0\]!\.standing\.leaseId\}`/);

  // The colour is read from the meaning module, never decided beside it.
  const tone = code(record()).slice(code(record()).indexOf("export function applicationTone"));
  assert.match(tone, /applicationBucket\(application, leases\)/);
  assert.match(tone, /timeline\(application, leases\)\.at\(-1\)\?\.state === "stopped"/);
});

test("leaving an application and coming back lands where you left", () => {
  const body = tenantHalf();
  assert.match(body, /useSearchParams\(\)/);
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(body, /router\.replace\(/);
  // Both halves read the address, so both sit inside a boundary.
  assert.match(code(list()), /<TenantApplications \/>\s*<\/Suspense>/);
});

test("a reload never pulls the record out from under the sheet", () => {
  // Withdrawing reloads the list. Blanking it first unmounted the open record
  // mid-action; now a reload keeps what is shown and only replaces it.
  const body = tenantHalf();
  const load = body.slice(body.indexOf("const load = useCallback"), body.indexOf("useEffect(() => { void load(); }"));
  assert.doesNotMatch(load, /setApplications\(null\)/);
  assert.match(load, /setApplications\(\(current\) => current \?\? \[\]\)/);
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

test("withdrawing is still asked about, still irreversible, and says it happened", () => {
  const body = code(record());
  assert.match(body, /withdrawMyApplication\(application\.id, "No longer needed"\)/);
  assert.match(body, /Withdraw\? This cannot be undone\./);
  assert.match(body, /setConfirming\(true\)/);
  assert.match(body, /toast\(\{ tone: "success", title: "Application withdrawn"/);
  // Inside the sheet it leaves the sheet; on the record's own page it returns
  // to the list it came from.
  assert.match(body, /if \(onWithdrawn\) onWithdrawn\(\);\s*else router\.push\("\/applications"\)/);
});
