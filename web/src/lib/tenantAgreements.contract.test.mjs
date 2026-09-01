/**
 * A tenant's own agreements, laid out the way every other list is.
 *
 * The sixth surface to take the shape, and the last of the split views: three
 * counts, a search, the stages as pills, linked rows, and the record at its own
 * address. `/leases/<leaseId>` branches on session exactly as `/leases` does.
 *
 * This record is the most consequential in the product from the tenant's side —
 * it is the terms they are being asked to be bound by, and accepting is
 * irreversible. That is the argument for it having an address, not against it:
 * somebody reading an agreement wants to leave, check something, and come back
 * to the same place.
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

const list = () => read("web/app/leases/page.tsx");
const route = () => read("web/app/leases/[leaseId]/page.tsx");
const record = () => read("web/src/components/tenant/AgreementRecord.tsx");
const css = () => read("web/src/styles/agreements-workspace.css");

/** The tenant half only; the provider half has its own contract. */
const tenantHalf = () => {
  const source = code(list());
  const start = source.indexOf("function TenantLeases()");
  const end = source.indexOf("function ProviderLeases()");
  assert.ok(start !== -1 && end > start, "failed to slice the tenant half");
  return source.slice(start, end);
};

/** The tenant half of the record route, which also holds the provider's. */
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

test("a tenant's agreement opens at its own address", () => {
  assert.ok(existsSync(resolve(root, "web/app/leases/[leaseId]/page.tsx")));
  assert.match(tenantRoute(), /leases\?\.find\(\(row\) => row\.id === leaseId\)/);
  assert.match(tenantRoute(), /<AgreementRecord/);

  const body = tenantHalf();
  assert.doesNotMatch(body, /tenant-agreements-split/);
  assert.doesNotMatch(body, /AgreementRecord/);
  assert.doesNotMatch(body, /openId/);
  assert.doesNotMatch(css(), /\.tenant-agreements-split/);
  assert.doesNotMatch(css(), /\.tenant-agreement-record-back/);

  assert.match(body, /href=\{`\/leases\/\$\{lease\.id\}` as never\}/);
  assert.doesNotMatch(body, /<button\s+type="button"\s+className=\{`agreement-row/);
});

test("the agreement document leaves scrolling to its detail page", () => {
  const body = rule(css(), ".tenant-agreement-record-body");

  // These belonged to the retired split pane. On a full detail page they
  // intercept wheel and touch gestures that begin over the legal document.
  assert.doesNotMatch(body, /overflow-y:\s*auto/);
  assert.doesNotMatch(body, /overscroll-behavior:\s*contain/);
});

test("one address serves both sides, and branches the way the list does", () => {
  const body = code(route());
  assert.match(body, /useSession\(\)/);
  assert.match(body, /capabilities\.active_workspace === "provider"/);
  assert.match(body, /asProvider \? <ProviderLease \/> : <TenantAgreement \/>/);
  // Each side reads its own endpoint; neither is authorised by the id.
  assert.match(body, /listGrantedLeases/);
  assert.match(body, /listMyLeases/);
});

test("the page is laid out the way every other list is", () => {
  const body = tenantHalf();

  const order = ["agreements-overview", "agreements-search", "agreements-filters", "agreements-list"];
  let at = -1;
  for (const className of order) {
    const found = body.search(new RegExp(`className="${className}"`));
    assert.notEqual(found, -1, `${className} is not rendered`);
    assert.ok(found > at, `${className} is out of order`);
    at = found;
  }

  assert.match(rule(css(), ".agreements-overview"), /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(rule(css(), ".agreements-overview dd"), /font-family: var\(--font-display\)/);
  assert.match(rule(css(), ".agreements-filters button"), /border-radius: 999px/);
  assert.match(css(), /\.agreements-filters button\[aria-pressed="true"\][\s\S]{0,140}--color-kola-50/);
  assert.match(rule(css(), ".agreements-search"), /width: min\(100%, 30rem\)/);

  // The stage is a pill, so a heading above each group would name it twice.
  assert.doesNotMatch(code(list()), /function AgreementGroup\(/);
  assert.doesNotMatch(css(), /\.agreements-group/);
});

test("the counts are narrower than the pills beside them", () => {
  // "Active" as a stage also holds an agreement accepted but not started;
  // "Past" holds one the tenant declined and one the landlord withdrew. The
  // cards count only what actually happened, so they never restate a pill.
  const body = tenantHalf();
  assert.match(body, /total: rows\.length/);
  assert.match(body, /row\.lease\.status === "active"/);
  assert.match(body, /row\.lease\.status === "ended"/);
  assert.match(body, /label="In place"/);
  assert.match(body, /label="Ended"/);
  // Not the stage buckets, which are what the pills already count.
  const totals = body.slice(body.indexOf("const totals ="), body.indexOf("const visible ="));
  assert.doesNotMatch(totals, /state\.stage/);
});

test("an old agreement link still reaches the agreement", () => {
  // `#agreement-<id>` selected a row into the pane, and the application record
  // deep-linked with `?open=<id>`. Both name a page now.
  const body = tenantHalf();
  assert.match(body, /window\.location\.hash\.startsWith\("#agreement-"\)/);
  assert.match(body, /search\.get\("open"\)/);
  assert.match(body, /router\.replace\(`\/leases\/\$\{requested\}`/);
});

test("leaving an agreement and coming back lands where you left", () => {
  const body = tenantHalf();
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(body, /agreementFilters\.map/);
  assert.match(code(list()), /<Suspense/);
});

test("accepting is still the same irreversible decision", () => {
  const body = code(record());
  // The record kept everything it held; only its container changed.
  assert.match(body, /You are accepting \{money\(terms\.moveInTotalMinor/);
  assert.match(body, /cannot be changed afterwards/);
  assert.match(body, /Yes, accept it/);
  // The acknowledgement in front of an advance-rent agreement stays.
  assert.match(body, /advance-rent notice/);
  // And the frozen terms still lead, with the older-agreement fallback.
  assert.match(body, /agreedTerms\(lease\)/);
  assert.match(body, /This is an older agreement/);
});

test("what an agreement means is still decided by the mirrored module", () => {
  // `agreementMeaning.ts` is shared with the phone byte for byte.
  const body = tenantHalf();
  assert.match(body, /standing\(lease\)/);
  assert.match(body, /matchesAgreementFilter\(row\.state\.stage, filter\)/);
  assert.match(code(record()), /from "@\/lib\/agreementMeaning"/);
  assert.doesNotMatch(code(list()), /^function (standing|agreedTerms)\(/m);
});

test("the row says why an agreement ended", () => {
  // The recorded reason was lost in the rewrite that gave the record its own
  // address — left commented out — and nothing failed, because every assertion
  // in the suite was about the page's shape rather than what a row tells
  // somebody.
  //
  // The money line is **not** asserted here. It was removed deliberately to
  // keep the row clean, and an earlier version of this test locked in a
  // restoration that was never mine to make. What a row chooses to show is a
  // design decision; what it must not silently lose is a contract.
  const body = tenantHalf();

  assert.match(body, /lease\.decline_reason \? \(/);
  assert.match(body, /className="agreement-reason"/);

  // The questions the row does answer.
  assert.match(body, /homeOf\(terms\)/);
  assert.match(body, /terms\.landlordName/);
  assert.match(body, /months\(terms\.termMonths\)/);
  assert.match(body, /agreement-standing is-\$\{state\.stage\}/);
});
