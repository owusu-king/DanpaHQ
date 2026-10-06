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
 *
 * Since then the list itself moved: a lease is a document, so the provider's
 * Leases became the Leases view of Documents (`/documents?view=leases`), and a
 * row opens the agreement over that page. The record kept its own address —
 * the row is still a link to it — so everything below about the record holds.
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
const view = () => read("web/src/components/documents/LeasesView.tsx");
const page = () => read("web/app/documents/page.tsx");

/**
 * The provider's list, which is now the Leases view of Documents. The tenant
 * half of `/leases` keeps its own list and is not part of this.
 */
const providerHalf = () => code(view());

/** What is left of the provider half of `/leases`: a redirect into Documents. */
const redirect = () => {
  const source = code(list());
  const at = source.indexOf("function ProviderLeases()");
  assert.notEqual(at, -1, "ProviderLeases is gone");
  return source.slice(at);
};
const detail = () => read("web/app/leases/[leaseId]/page.tsx");
const record = () => read("web/src/components/leases/LeaseRecord.tsx");
const meaning = () => read("web/src/lib/leaseMeaning.ts");
const css = () => read("web/src/styles/documents-workspace.css");

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

  // Rows are links to the record. A plain press opens it over the page; a new
  // tab or a copied address still reaches the record page.
  assert.match(body, /href=\{`\/leases\/\$\{lease\.id\}` as never\}/);
  assert.match(body, /event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey/);
  assert.match(body, /<LeaseModal/);
  assert.match(rule(css(), ".docs-lease-row"), /text-decoration: none/);
});

test("nobody's agreement is opened for them", () => {
  // The pane always showed `visible[0]` when nothing was chosen, so a provider
  // arriving at Leases was reading an agreement picked by sort order.
  const body = providerHalf();
  assert.doesNotMatch(body, /const suggested = visible\[0\]/);
  assert.doesNotMatch(body, /explicit \?\? suggested/);
});

test("an old #lease- link still reaches the agreement", () => {
  // Those links used to open the pane. `/leases` now hands a provider to
  // Documents, and the hash becomes the lease that opens there.
  const body = redirect();
  assert.match(body, /window\.location\.hash\.startsWith\("#lease-"\)/);
  assert.match(body, /next\.set\("lease", window\.location\.hash\.slice\("#lease-"\.length\)\)/);
  assert.match(body, /router\.replace\(`\/documents\?\$\{next\.toString\(\)\}`/);
});

test("the list is laid out the way the other workspaces are", () => {
  // Counts in the head's summary, then one panel: search and the stages in its
  // toolbar, the rows beneath. The same shape as Units, Tenants and Payments.
  const body = providerHalf();
  const order = ["ws-panel docs-leases", "ws-panel-head docs-leases-head", "docs-lease-rows"];
  let at = -1;
  for (const className of order) {
    const found = body.search(new RegExp(`className="${className}"`));
    assert.notEqual(found, -1, `${className} is not rendered`);
    assert.ok(found > at, `${className} is out of order`);
    at = found;
  }
  assert.match(body, /<PanelSearch label="Search leases" placeholder="Search tenant, Property or Unit"/);
  assert.match(body, /<SegmentedControl\s+inline\s+label="Agreement stage"/);
  assert.match(code(page()), /<SegmentedControl\s+label="Documents"/);
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

  assert.match(providerHalf(), /leaseTotals\(leases\)/);
  assert.match(code(page()), /\{totals\.awaiting\} awaiting tenant/);
});

test("leaving an agreement and coming back lands where you left", () => {
  // The view, stage, search and open lease are all in the address.
  const body = code(page());
  assert.match(body, /useSearchParams\(\)/);
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(body, /search\.get\("lease"\)/);
  assert.match(body, /LEASE_FILTERS\.find\(/);
  assert.match(body, /<Suspense/);
  // An old /leases address keeps its stage and search on the way across.
  assert.match(redirect(), /search\.get\("show"\)/);
  assert.match(redirect(), /search\.get\("q"\)/);
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
  assert.doesNotMatch(providerHalf(), /^function (providerLeaseStage|providerLeaseStatus|formatLeaseDate)\(/m);
  assert.doesNotMatch(code(record()), /^function (providerLeaseStatus|formatLeaseDate)\(/m);
  assert.match(providerHalf(), /from "@\/lib\/leaseMeaning"/);
  assert.match(code(record()), /from "@\/lib\/leaseMeaning"/);
});
