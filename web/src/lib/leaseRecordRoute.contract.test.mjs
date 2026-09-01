/**
 * Leases, laid out the way Payments and Tenancy requests are.
 *
 * The third of three provider lists to get the same shape: counts across the
 * top, a search, the stages as filter pills, linked rows, and the record at its
 * own address. A provider should learn that once, not three times.
 *
 * This one was not a modal — it was a split view, with the first row of the
 * list always opened into the pane beside it. Better than a modal and still
 * wrong: arriving at Leases meant looking at somebody's agreement chosen by
 * sort order, and the terms two parties are bound by had no address.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const list = () => read("web/app/leases/page.tsx");

/**
 * The provider half only.
 *
 * The tenant half of this route has a split view of its own and keeps it — a
 * tenant reading their own agreements is a different job, and it was not part
 * of this change. Asserting against the whole file caught the tenant's
 * `explicit ?? suggested` and, worse, would have let the provider half lose
 * `useSearchParams` while the tenant's use of it kept the test green.
 */
const providerHalf = () => {
  const source = code(list());
  const at = source.indexOf("function ProviderLeases()");
  assert.notEqual(at, -1, "ProviderLeases is gone");
  return source.slice(at);
};
const detail = () => read("web/app/leases/[leaseId]/page.tsx");
const record = () => read("web/src/components/leases/LeaseRecord.tsx");
const meaning = () => read("web/src/lib/leaseMeaning.ts");
const css = () => read("web/src/styles/leases-workspace.css");

function rule(sheet, selector) {
  const at = sheet.indexOf(selector + " {");
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

test("an agreement opens at its own address", () => {
  assert.ok(existsSync(resolve(root, "web/app/leases/[leaseId]/page.tsx")), "needs a route");
  assert.match(code(detail()), /useParams<\{ leaseId: string \}>\(\)/);
  assert.match(code(detail()), /leases\?\.find\(\(row\) => row\.id === leaseId\)/);

  // The split pane and the record that lived in it are gone from the list.
  const body = providerHalf();
  assert.doesNotMatch(body, /provider-leases-split/);
  assert.doesNotMatch(body, /ProviderLeaseRecord/);
  assert.doesNotMatch(body, /selectedId/);
  assert.doesNotMatch(css(), /\.provider-leases-split/);
  assert.doesNotMatch(css(), /\.provider-lease-record/);

  // Rows are links.
  assert.match(body, /href=\{`\/leases\/\$\{lease\.id\}` as never\}/);
  assert.doesNotMatch(body, /<button type="button" className="lease-row"/);
  assert.match(rule(css(), ".lease-row"), /text-decoration: none/);
});

test("nobody's agreement is opened for them", () => {
  // The pane always showed `visible[0]` when nothing was chosen, so a provider
  // arriving at Leases was reading an agreement picked by sort order.
  const body = providerHalf();
  assert.doesNotMatch(body, /const suggested = visible\[0\]/);
  assert.doesNotMatch(body, /explicit \?\? suggested/);
});

test("an old #lease- link still reaches the agreement", () => {
  // Those links used to open the pane. They name a page now, so they are sent
  // there rather than landing on a list that quietly ignored them.
  const body = providerHalf();
  assert.match(body, /window\.location\.hash\.startsWith\("#lease-"\)/);
  assert.match(body, /router\.replace\(`\/leases\/\$\{window\.location\.hash\.slice\("#lease-"\.length\)\}`/);
});

test("the page is laid out the way Payments is", () => {
  const body = providerHalf();

  const order = ["leases-overview", "leases-search", "leases-filters", "leases-list"];
  let at = -1;
  for (const className of order) {
    const found = body.search(new RegExp(`className="${className}"`));
    assert.notEqual(found, -1, `${className} is not rendered`);
    assert.ok(found > at, `${className} is out of order`);
    at = found;
  }

  assert.match(rule(css(), ".leases-overview"), /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(rule(css(), ".leases-overview dd"), /font-family: var\(--font-display\)/);
  assert.match(rule(css(), ".leases-filters button"), /border-radius: 999px/);
  assert.match(css(), /\.leases-filters button\[aria-pressed="true"\][\s\S]{0,140}--color-kola-50/);
  assert.match(rule(css(), ".leases-search"), /width: min\(100%, 30rem\)/);

  // The tabs that shared a row with the search are gone.
  assert.doesNotMatch(css(), /\.leases-tab\b/);
  assert.doesNotMatch(css(), /\.leases-controls/);
});

test("the three counts say only what a status proves", () => {
  // Total, the state that means a tenancy is actually running, and the one
  // thing the provider is waiting on somebody else for.
  const body = code(meaning());
  assert.match(body, /total: leases\.length/);
  assert.match(body, /lease\.status === "active"/);
  assert.match(body, /lease\.status === "offered"/);

  // `awaiting_activation` is not folded into "Awaiting tenant": the tenant has
  // already accepted by then, and counting it would claim they had not.
  const awaiting = body.slice(body.indexOf("awaiting:"), body.indexOf("};", body.indexOf("awaiting:")));
  assert.doesNotMatch(awaiting, /awaiting_activation/);

  assert.match(providerHalf(), /leaseTotals\(leases \?\? \[\]\)/);
  assert.match(providerHalf(), /label="Awaiting tenant"/);
});

test("leaving an agreement and coming back lands where you left", () => {
  const body = providerHalf();
  assert.match(body, /useSearchParams\(\)/);
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(body, /LEASE_FILTERS\.find\(/);
  // The boundary search params need already wrapped this route before the
  // change — it sits above both halves, not inside the provider one.
  assert.match(code(list()), /<Suspense/);
});

test("moving the record did not move the authority", () => {
  const body = code(record());

  // One endpoint, three actions, unchanged.
  assert.match(body, /await leaseAction\(lease\.id, action, reason\.trim\(\), action === "end"\)/);

  // Which actions exist is still read from the status the server set.
  assert.match(body, /lease\.status === "draft" \|\| lease\.status === "ready" \?/);
  assert.match(body, /lease\.status === "offered" \?/);
  assert.match(body, /lease\.status === "active" \?/);

  // Ending a tenancy is still confirmed on a second screen, with a reason.
  assert.match(body, /title=\{\s*confirmation === "end"\s*\?\s*"End this tenancy\?"/);
  assert.match(body, /setConfirmation\("end"\)/);
  assert.match(body, /label="Reason \(optional\)"/);

  // The frozen agreement record still leads, and an older lease still renders.
  assert.match(body, /lease\.agreement\?\.terms/);
  assert.match(body, /title="Older agreement"/);
});

test("the words an agreement is described in are written once", () => {
  const body = code(meaning());
  for (const name of ["providerLeaseStage", "providerLeaseStatus", "providerLeaseTone", "formatLeaseDate"]) {
    assert.match(body, new RegExp(`export function ${name}\\(`));
  }
  assert.doesNotMatch(code(list()), /^function (providerLeaseStage|providerLeaseStatus|formatLeaseDate)\(/m);
  assert.doesNotMatch(code(record()), /^function (providerLeaseStatus|formatLeaseDate)\(/m);
  assert.match(code(list()), /from "@\/lib\/leaseMeaning"/);
  assert.match(code(record()), /from "@\/lib\/leaseMeaning"/);
});
