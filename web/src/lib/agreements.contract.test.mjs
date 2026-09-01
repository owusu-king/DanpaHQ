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

const tenantList = () => ({
  web: tenantHalf(webList(), "function TenantLeases()", "/** Provider-side date formatting"),
  mobile: tenantHalf(mobileList(), "function TenantLeasesScreen()", "function formatLeaseDate"),
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
    assert.ok(at(source, "to move in") < decisionAt, "the money must precede the decision");
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
    // Accepting and declining moved to the review screen entirely.
    assert.doesNotMatch(source, /acceptMyLease|acceptLease\(/);
    assert.doesNotMatch(source, /declineMyLease|declineLease\(/);
    // But the row still answers which home, with whom, how much, how long.
    assert.match(source, /homeOf\(terms\)/);
    assert.match(source, /terms\.landlordName/);
    assert.match(source, /to move in/);
    assert.match(source, /months\(terms\.termMonths\)/);
  }
});

test("agreement history is filter-driven and visible by default", () => {
  // The phone still keeps its filter in state; web moved it to the address so
  // returning from a record lands on the same filter.
  assert.match(tenantList().mobile, /useState<AgreementFilter>\("all"\)/);
  assert.match(tenantList().web, /search\.get\("show"\)/);
  for (const source of [tenantList().web, tenantList().mobile]) {
    assert.match(source, /agreementFilters\.map/);
    assert.doesNotMatch(source, /Past agreements \(/);
  }
  assert.doesNotMatch(tenantList().web, /<details className="agreements-past"/);
  assert.doesNotMatch(tenantList().mobile, /showPast|accessibilityState=\{\{ expanded:/);

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

test("a substantial agreement gets a workspace or a dedicated screen", () => {
  // Terms, evidence, rent context and irreversible decisions make this a
  // resumable record, not a quick dialog.
  for (const source of [webRecord(), webListPage()]) {
    assert.doesNotMatch(rendered(source), /<main/);
    assert.doesNotMatch(rendered(source), /<dialog/);
    assert.doesNotMatch(source, /showModal\(\)/);
  }
  // Both halves took the other option in this test's title: a dedicated screen.
  // A split pane always opened somebody's agreement whether or not it was asked
  // for, and the terms two parties are bound by had no address.
  //
  // The tenant's record still holds everything it held; only its container
  // changed, and the phone had already given it a screen of its own.
  assert.match(webRecord(), /className="tenant-agreement-record"/);
  assert.doesNotMatch(webRecord(), /<aside/);
  assert.doesNotMatch(webListPage(), /tenant-agreements-split/);
  const agreementRoute = read("web/app/leases/[leaseId]/page.tsx");
  assert.match(agreementRoute, /<AgreementRecord/);
  assert.match(webListPage(), /href=\{`\/leases\/\$\{lease\.id\}`/);
  assert.doesNotMatch(webListPage(), /ProviderLeaseDialog/);
  assert.doesNotMatch(webListPage(), /provider-leases-split/);
  assert.match(webListPage(), /href=\{`\/leases\/\$\{lease\.id\}`/);
  const leaseRoute = read("web/app/leases/[leaseId]/page.tsx");
  assert.match(leaseRoute, /<LeaseRecord/);
  assert.doesNotMatch(rendered(leaseRoute), /<dialog/);
  assert.doesNotMatch(leaseRoute, /showModal\(\)/);

  const stack = read("mobile/app/(app)/_layout.tsx");
  const route = stack.match(/<Stack\.Screen\s+name="agreement\/\[id\]"[\s\S]*?\/>/)?.[0];
  assert.ok(route, "the mobile agreement record route is missing");
  assert.doesNotMatch(route, /presentation: "modal"/);
});
