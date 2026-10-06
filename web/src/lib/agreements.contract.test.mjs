import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const webList = () => read("web/app/leases/page.tsx");
const webReview = () => read("web/src/components/tenant/AgreementRecord.tsx");
const webRecord = () => read("web/src/components/tenant/AgreementRecord.tsx");
const webListPage = () => read("web/app/leases/page.tsx");
const mobileList = () => read("mobile/app/(app)/leases.tsx");
const mobileReview = () => read("mobile/app/(app)/agreement/[id].tsx");

/** Source with comments removed, so quoted history is not read as behaviour. */
const rendered = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

/** The tenant half of a file that also holds the provider's side. */
function tenantHalf(source, from, to) {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `${from} is missing`);
  const end = source.indexOf(to, start);
  assert.notEqual(end, -1, `${to} is missing`);
  return source.slice(start, end);
}

/** Where a fragment first appears, asserted to exist. */
function at(source, needle, what) {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `${what ?? needle} is missing`);
  return index;
}

// The phone's provider-side `formatLeaseDate` moved to `providerLeaseMeaning.ts`;
// its tenant half now ends at the tenant's own date helper.
const tenantList = () => ({
  web: tenantHalf(webList(), "function TenantLeases()", "function ProviderLeases()"),
  mobile: tenantHalf(mobileList(), "function TenantLeasesScreen()", "function shortDate("),
});

test("what an agreement means is decided once, for both clients", () => {
  const strip = (source) => source.replace(/^\/\*\*[\s\S]*?\*\/\n/, "").trim();
  assert.equal(
    strip(read("web/src/lib/agreementMeaning.ts")),
    strip(read("mobile/src/agreementMeaning.ts")),
  );
});

test("the decision comes after the reading", () => {
  // The old screens offered "Accept agreement" and "Decline" above the money,
  // the dates, the conditions and the statutory advance notice — and then asked
  // the tenant to confirm they had read "the advance-rent notice below".
  for (const [source, decision] of [
    [webReview(), "<Decision lease={lease}"],
    [mobileReview(), "<Decision lease={lease}"],
  ]) {
    const decisionAt = at(source, decision, "the decision block");
    assert.ok(at(source, "advance_notice") < decisionAt, "the advance notice must precede the decision");
    assert.ok(at(source, "Conditions") < decisionAt, "the conditions must precede the decision");
    const moneyAt = source.includes("Move-in total")
      ? at(source, "Move-in total")
      : at(source, "to move in");
    assert.ok(moneyAt < decisionAt, "the money must precede the decision");
  }
  // And the checkbox no longer points at something further down the page.
  // Comments are stripped: both files quote the old wording to explain why.
  for (const source of [webReview(), mobileReview()]) {
    assert.doesNotMatch(rendered(source), /advance-rent notice below/);
    assert.match(source, /advance-rent notice at the top/);
  }
});

test("a row offers one action, not the whole agreement", () => {
  for (const source of [tenantList().web, tenantList().mobile]) {
    assert.doesNotMatch(source, /acceptMyLease|acceptLease\(/);
    assert.doesNotMatch(source, /declineMyLease|declineLease\(/);
  }

  // Web follows the compact Applications pattern: recognition and standing in
  // the row, with financial/legal detail reserved for the reading modal.
  const web = tenantList().web;
  const webRow = web.slice(web.indexOf("function AgreementRow("));
  assert.match(webRow, /terms\.propertyTitle/);
  assert.match(webRow, /terms\.unitLabel/);
  assert.match(webRow, /agreement-row-standing/);
  assert.doesNotMatch(webRow, /terms\.landlordName|moveInTotalMinor|termMonths|decline_reason/);

  // Mobile keeps its current dedicated-screen composition in this web-only
  // redesign.
  const mobile = tenantList().mobile;
  assert.match(mobile, /homeOf\(terms\)/);
  assert.match(mobile, /terms\.landlordName/);
  assert.match(mobile, /to move in/);
  assert.match(mobile, /months\(terms\.termMonths\)/);
});

test("agreement history is filter-driven, previewed rather than unfolded", () => {
  // The phone still keeps its filter in state; web moved it to the address so
  // returning from a record lands on the same filter.
  assert.match(tenantList().mobile, /useState<AgreementFilter>\("all"\)/);
  assert.match(tenantList().web, /search\.get\("show"\)/);
  for (const source of [tenantList().web, tenantList().mobile]) {
    assert.match(source, /agreementFilters\.map/);
    assert.doesNotMatch(source, /Past agreements \(/);
  }
  assert.doesNotMatch(tenantList().web, /<details className="agreements-past"/);
  // Still not a disclosure on either client: the way to the rest of history is
  // the filter both readers already have, so there is one way to be in it.
  assert.doesNotMatch(tenantList().mobile, /showPast|aria-expanded=/);

  // On the phone the whole list stacks its stages, so the closed one gives two
  // and says how many there are — history grows forever and is the group
  // nobody opened the page for. Filtering to it shows all of them. Both
  // readers' screens live in the one file, so this reads all of it.
  const phone = mobileList();
  assert.match(phone, /const HISTORY_SHOWN = 2;/);
  assert.match(phone, /stage === "past" && filter === "all" && group\.length > HISTORY_SHOWN/);
  assert.match(phone, /stage === "history" && view === "all" && group\.length > HISTORY_SHOWN/);
  assert.match(phone, /<ViewAll count=\{section\.total\} noun="past agreements" onPress=\{\(\) => setFilter\("past"\)\}/);
  assert.match(phone, /<ViewAll count=\{section\.total\} noun="in history" onPress=\{\(\) => setView\("history"\)\}/);
  // The group's count is the whole stage, so the fold never hides the number.
  assert.match(phone, /<GroupLabel count=\{section\.total\}/);
  assert.doesNotMatch(phone, /<GroupLabel count=\{section\.data\.length\}/);
  // And the last row before the fold does not round off, or the panel would
  // close above the way out of it.
  assert.match(phone, /last=\{section\.data\.length === section\.total && index === section\.data\.length - 1\}/);

  const meaning = read("web/src/lib/agreementMeaning.ts");
  assert.match(meaning, /export type AgreementFilter = "all" \| AgreementStage/);
  for (const label of ["All", "Needs you", "Active", "Past"]) {
    assert.match(meaning, new RegExp(`label: "${label}"`));
  }

  // Every status the backend can produce resolves to one of the three. The web
  // page used to filter on offered/active/history and silently drop
  // `awaiting_activation` — a lease in that state appeared nowhere at all.
  for (const status of ["offered", "awaiting_activation", "active", "declined", "cancelled", "ended"]) {
    assert.match(meaning, new RegExp(`case "${status}":`));
  }
});

test("the frozen snapshot is what is shown", () => {
  // A lease carries its terms twice: live columns, and the frozen copy whose
  // bytes produced the hash both parties accepted. The snapshot wins, and both
  // clients get there the same way instead of falling back field by field.
  for (const source of [tenantList().web, tenantList().mobile, webReview(), mobileReview()]) {
    assert.match(source, /agreedTerms\(lease\)/);
    assert.doesNotMatch(rendered(source), /terms\?\.money/);
    assert.doesNotMatch(rendered(source), /lease\.agreement\?\.terms\./);
  }
});

test("who accepted, and when, is on the record", () => {
  // The serializer has carried `accepted_by` all along; neither client showed
  // it, on a record whose whole purpose is who pressed accept and when.
  for (const source of [webReview(), mobileReview()]) {
    assert.match(source, /accepted_by/);
    assert.match(source, /accepted on/);
    // The hash is shown without claiming it is a signature.
    assert.match(source, /not an electronic signature/);
  }
});

test("accepting says what is being accepted", () => {
  // Not "this is important" — the actual figures, at the moment of agreeing.
  for (const source of [webReview(), mobileReview()]) {
    assert.match(source, /You are accepting \{money\(terms\.moveInTotalMinor/);
    assert.match(source, /cannot be changed afterwards/);
    assert.match(source, /Yes, accept it/);
  }
});

test("a substantial tenant agreement opens in context and keeps its dedicated address", () => {
  const record = webRecord();
  const list = webListPage();
  const css = read("web/src/styles/agreements-workspace.css");

  // A normal list click keeps comparison context, while the same immutable
  // record remains addressable for refresh, modified clicks and shared links.
  // It opens in the shared sheet, and the open record is in the address.
  assert.match(record, /export function AgreementSheet/);
  assert.match(record, /<ModalSheet/);
  assert.match(list, /<AgreementSheet/);
  assert.match(list, /search\.get\("agreement"\)/);
  assert.match(list, /event\.preventDefault\(\);\s*onOpen\(lease\)/);
  assert.match(list, /href=\{`\/leases\/\$\{lease\.id\}`/);
  assert.doesNotMatch(list, /tenant-agreements-split/);

  // The sheet scrolls as one reading surface; the decision bar stays pinned
  // at its foot while the agreement scrolls under it.
  assert.match(css, /\.agreement-sheet \.doc-modal-body \{[^}]*overflow-y: auto/);
  assert.match(record, /className="rq-actions ag-decision"/);
  assert.match(record, /<Icon name="download" \/>Download/);
  assert.match(record, /<Icon name="print" \/>Print/);

  const agreementRoute = read("web/app/leases/[leaseId]/page.tsx");
  assert.match(agreementRoute, /<AgreementRecord/);
  assert.match(agreementRoute, /<LeaseRecord/);
  assert.doesNotMatch(list, /ProviderLeaseDialog/);
  assert.doesNotMatch(list, /provider-leases-split/);

  // Mobile keeps its comfortable dedicated agreement screen.
  const stack = read("mobile/app/(app)/_layout.tsx");
  const route = stack.match(/<Stack\.Screen\s+name="agreement\/\[id\]"[\s\S]*?\/>/)?.[0];
  assert.ok(route, "the mobile agreement record route is missing");
  assert.doesNotMatch(route, /presentation: "modal"/);
});
