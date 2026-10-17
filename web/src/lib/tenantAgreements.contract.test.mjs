/**
 * Tenant Agreements stays a compact index with one authoritative, readable
 * record behind every row — on the shared workspace, like Applications: the
 * head, the segmented stages, one panel, and the record in the shared sheet,
 * held in page state. These contracts protect meaning and interaction, not a
 * frozen screenshot.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const list = () => read("web/app/leases/page.tsx");
const route = () => read("web/app/leases/[leaseId]/page.tsx");
const record = () => read("web/src/components/tenant/AgreementRecord.tsx");
const css = () => read("web/src/styles/agreements-workspace.css");

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(start, -1, `${startNeedle} is missing`);
  assert.ok(end > start, `${endNeedle} is missing after ${startNeedle}`);
  return source.slice(start, end);
}

const tenantHalf = () => between(code(list()), "function TenantLeases()", "function ProviderLeases()");
const row = () => between(code(list()), "function AgreementRow(", "function ProviderLeases()");
const tenantRoute = () => {
  const source = code(route());
  const at = source.indexOf("function TenantAgreement()");
  assert.notEqual(at, -1, "TenantAgreement is gone");
  return source.slice(at);
};

function rule(sheet, selector) {
  const at = sheet.indexOf(selector + " {");
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

test("a plain click opens the agreement over the list, held in page state; the route remains", () => {
  assert.ok(existsSync(resolve(root, "web/app/leases/[leaseId]/page.tsx")));
  assert.match(tenantRoute(), /<AgreementRecord/);
  assert.match(tenantRoute(), /<EntityPath/);
  assert.match(tenantRoute(), /mobileLabel: "Back to Agreements"/);
  const body = tenantHalf();
  assert.match(body, /useDeepLinkedModal\("agreement"\)/);
  assert.match(body, /setOpenId\(lease\.id\)/);
  assert.match(body, /<AgreementSheet lease=\{opened\}/);
  assert.match(body, /event\.preventDefault\(\);\s*onOpen\(lease\)/);
  assert.match(body, /href=\{`\/leases\/\$\{lease\.id\}` as never\}/);
  assert.doesNotMatch(body, /tenant-agreements-split/);
  // The sheet is the shared one, so it behaves exactly like every other modal.
  assert.match(code(record()), /<ModalSheet/);
  assert.match(code(record()), /className="request-sheet agreement-sheet"/);
});

test("the index is the shared workspace, with controls that earn their space", () => {
  const body = tenantHalf();
  assert.match(body, /className="ws-page agreements-workspace"/);
  assert.match(body, /<WorkspaceHead\s+icon="leases"\s+title="Agreements"/);
  assert.ok(body.indexOf("<SegmentedControl") < body.indexOf('className="ws-panel agreements-panel"'), "the stages lead the panel");
  assert.doesNotMatch(body, /agreements-overview|agreements-filters|AgreementCount|<select|role="menuitemradio"/);
  assert.match(body, /<AgreementSummary counts=\{counts\}/);
  assert.match(body, /showSearch = \(leases\?\.length \?\? 0\) > 5 \|\| Boolean\(query\)/);
  assert.match(body, /showFilter = new Set\(rows\.map\(\(row\) => row\.state\.stage\)\)\.size > 1 \|\| filter !== "all"/);
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(rule(css(), ".agreement-row"), /min-height: 4\.375rem/);
});

test("an agreement waiting for an answer is lifted above the list", () => {
  const body = tenantHalf();
  assert.match(body, /const waiting = rows\.filter\(\(row\) => row\.state\.decisionOpen\)/);
  assert.match(body, /unfilteredView && waiting\[0\] && first \? \(\s*<NextUp/);
  assert.match(body, /action=\{\{ label: "Review & decide", onClick: \(\) => open\(waiting\[0\]!\.lease\) \}\}/);
});

test("every state is designed inside the panel", () => {
  const body = tenantHalf();
  assert.match(body, /loading \? <PanelSkeleton/);
  assert.match(body, /<PanelState\s+tone="error"[\s\S]{0,400}Try again/);
  assert.match(body, /title="No agreement yet"/);
  assert.match(body, /Nothing matches[\s\S]{0,200}Clear search/);
  assert.match(body, /Show all agreements/);
  assert.match(body, /error && rows\.length \? \(\s*<div className="ws-inline-error"/);
  // A reload keeps the open record instead of blanking the list under it.
  const load = body.slice(body.indexOf("const load = useCallback"), body.indexOf("useEffect(() => { void load(); }"));
  assert.doesNotMatch(load, /setLeases\(null\)/);
});

test("no view renders more than five agreement rows initially", () => {
  const body = tenantHalf();
  assert.match(body, /initialLimit=\{5\}/);
  assert.match(body, /history\.length \? 4 : 5/);
  assert.match(body, /Math\.max\(0, 5 - initialCurrentLimit\)/);
  assert.match(body, /const pageSize = 5/);
  assert.match(body, /rows\.slice\(0, limit\)/);
  assert.match(body, /className="agreement-load-more"/);
});

test("a row is recognition only: home, Unit, standing, one date and its rent", () => {
  const body = row();
  assert.match(body, /terms\.propertyTitle/);
  assert.match(body, /terms\.unitLabel/);
  assert.match(body, /agreement-row-standing/);
  assert.match(body, /agreementDate\(lease, state\)/);
  assert.match(body, /className="agreement-row-arrow"/);
  assert.doesNotMatch(body, /terms\.landlordName|moveInTotalMinor|termMonths|decline_reason/);
  // The colour is read from `standing()`, never decided beside it.
  const tone = code(record()).slice(code(record()).indexOf("export function agreementTone"));
  assert.match(tone, /const state = standing\(lease\)/);
});

test("the record reads money, then the agreement, then who accepted, and answers last", () => {
  const body = code(record());
  const at = (needle) => {
    const index = body.indexOf(needle, body.indexOf("export function AgreementRecord"));
    assert.notEqual(index, -1, `${needle} is missing`);
    return index;
  };
  assert.ok(at("lease.advance_notice ?") < at('className="ag-glance"'));
  assert.ok(at('className="ag-glance"') < at("<AgreementDocumentSection"));
  assert.ok(at("<AgreementDocumentSection") < at('className="ag-evidence"'));
  assert.ok(at('className="ag-evidence"') < at("<Decision lease={lease}"));
  // While a decision is due, the agreement is open for reading.
  assert.match(body, /<details className="lr-doc-read" open=\{reading \|\| undefined\}>/);
  assert.match(body, /reading=\{state\.decisionOpen\}/);
  assert.match(body, /<TenantAgreementDocument document=\{rendered\}/);
  assert.match(body, /accepted_by/);
  assert.match(body, /content_hash/);
  assert.match(body, /not an electronic signature/);
  assert.match(body, /lease\.agreement\?\.final_pdf_url/);
  assert.match(body, /<Icon name="download" \/>Download/);
  assert.match(body, /<Icon name="print" \/>Print/);
  // The answer stays in reach at the sheet's foot.
  assert.match(body, /className="rq-actions ag-decision"/);
  assert.match(read("web/src/styles/request-sheet.css"), /\.request-sheet \.rq-actions \{[\s\S]{0,60}position: sticky/);
});

test("old agreement links and both workspace identities remain supported", () => {
  const body = tenantHalf();
  assert.match(body, /window\.location\.hash\.startsWith\("#agreement-"\)/);
  assert.match(body, /search\.get\("open"\)/);
  const routeBody = code(route());
  assert.match(routeBody, /capabilities\.active_workspace === "provider"/);
  assert.match(routeBody, /asProvider \? <ProviderLease \/> : <TenantAgreement \/>/);
});

test("acceptance remains irreversible, acknowledged where required, and confirmed", () => {
  const body = code(record());
  assert.match(body, /You are accepting \{money\(terms\.moveInTotalMinor/);
  assert.match(body, /cannot be changed afterwards/);
  assert.match(body, /Yes, accept it/);
  assert.match(body, /advance-rent notice at the top/);
  assert.match(body, /disabled=\{mustAcknowledge && !acknowledged\}/);
  assert.match(body, /agreedTerms\(lease\)/);
  assert.match(body, /This is an older agreement/);
  assert.match(body, /title: "Agreement accepted"/);
  assert.match(body, /title: "Agreement declined"/);
});
