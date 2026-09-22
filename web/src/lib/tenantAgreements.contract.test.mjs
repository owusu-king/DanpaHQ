/**
 * Tenant Agreements stays a compact index with one authoritative, readable
 * record behind every row. These contracts protect meaning and interaction,
 * not a frozen screenshot of the old summary-card layout.
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

test("a normal tenant click opens the agreement modal while the durable route remains", () => {
  assert.ok(existsSync(resolve(root, "web/app/leases/[leaseId]/page.tsx")));
  assert.match(tenantRoute(), /<AgreementRecord/);
  const body = tenantHalf();
  assert.match(body, /<AgreementDetailModal/);
  assert.match(body, /event\.preventDefault\(\)[\s\S]{0,100}onOpen\(lease\)/);
  assert.match(body, /href=\{`\/leases\/\$\{lease\.id\}` as never\}/);
  assert.doesNotMatch(body, /tenant-agreements-split|openId/);
});

test("the index uses one compact toolbar and no summary-card or pill-bar preamble", () => {
  const body = tenantHalf();
  const order = ["agreements-tools", "agreements-results", "agreements-list"];
  let at = -1;
  for (const className of order) {
    const found = body.indexOf(className);
    assert.ok(found > at, `${className} is missing or out of order`);
    at = found;
  }
  assert.doesNotMatch(body, /agreements-overview|agreements-filters|AgreementCount/);
  assert.match(body, /agreementSummary\(counts, rows\.length\)/);
  assert.match(rule(css(), ".agreement-row"), /min-height: 4\.375rem/);
});

test("filters are compact, understandable and keep their state in the URL", () => {
  const body = tenantHalf();
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(body, /aria-haspopup="menu"/);
  assert.match(body, /role="menuitemradio"/);
  assert.match(body, /Current agreements/);
  assert.match(body, /Agreement history/);
  assert.match(body, /document\.addEventListener\("pointerdown"/);
  assert.match(body, /event\.key !== "Escape"/);
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

test("a row is recognition only: home, Unit, standing, important date and action", () => {
  const body = row();
  assert.match(body, /terms\.propertyTitle/);
  assert.match(body, /terms\.unitLabel/);
  assert.match(body, /agreement-row-standing/);
  assert.match(body, /agreementDate\(lease, state\)/);
  assert.match(body, /state\.decisionOpen \? "Review" : "View"/);
  assert.doesNotMatch(body, /terms\.landlordName|moveInTotalMinor|termMonths|decline_reason/);
});

test("the modal is a stable header, scrolling reading body and fixed footer", () => {
  const component = code(record());
  const sheet = css();
  assert.match(component, /<header className="tenant-agreement-record-head">/);
  assert.match(component, /className="tenant-agreement-record-body"/);
  assert.match(component, /<footer className="tenant-agreement-record-footer">/);
  assert.match(component, /agreement-modal-close/);
  assert.match(sheet, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
  assert.match(sheet, /\.agreement-modal \.tenant-agreement-record-body \{[^}]*overflow-y: auto/);
  assert.match(rule(sheet, ".tenant-agreement-record-body"), /display: grid/);
  assert.doesNotMatch(rule(sheet, ".tenant-agreement-record-body"), /overflow-y: auto/);
  assert.match(component, /<Icon name="download" \/>Download/);
  assert.match(component, /<Icon name="print" \/>Print/);
});

test("supporting record precedes At a glance and the document finishes the reading body", () => {
  const body = code(record());
  const evidenceAt = body.indexOf("agreement-evidence");
  const glanceAt = body.indexOf("agreement-glance-row");
  const documentAt = body.indexOf("agreement-document-reader");
  const footerAt = body.indexOf('<footer className="tenant-agreement-record-footer">');
  assert.match(body, /<p>At a glance<\/p>/);
  assert.match(body, /className="agreement-glance-row"/);
  assert.ok(evidenceAt < glanceAt && glanceAt < documentAt);
  assert.doesNotMatch(body.slice(documentAt, footerAt), /agreement-evidence|<RentSoFar/);
  assert.match(body, /<TenantAgreementDocument document=\{rendered\}/);
  assert.match(body, /accepted_by/);
  assert.match(body, /content_hash/);
  assert.match(body, /not an electronic signature/);
  assert.match(body, /lease\.agreement\?\.final_pdf_url/);
});

test("old agreement links and both workspace identities remain supported", () => {
  const body = tenantHalf();
  assert.match(body, /window\.location\.hash\.startsWith\("#agreement-"\)/);
  assert.match(body, /search\.get\("open"\)/);
  const routeBody = code(route());
  assert.match(routeBody, /capabilities\.active_workspace === "provider"/);
  assert.match(routeBody, /asProvider \? <ProviderLease \/> : <TenantAgreement \/>/);
});

test("acceptance remains irreversible and advance acknowledgement remains required", () => {
  const body = code(record());
  assert.match(body, /You are accepting \{money\(terms\.moveInTotalMinor/);
  assert.match(body, /cannot be changed afterwards/);
  assert.match(body, /Yes, accept it/);
  assert.match(body, /advance-rent notice at the top/);
  assert.match(body, /agreedTerms\(lease\)/);
  assert.match(body, /This is an older agreement/);
});