/**
 * Tenancy requests, laid out the way Payments is.
 *
 * They are the same job: a stack of things people have sent you, worked through
 * in an order, each row opening a record where a decision gets made. A provider
 * should learn that shape once — so the counts across the top, the search, the
 * filter pills and the linked rows are the same components in the same order,
 * and the record opens at its own address rather than in a layer.
 *
 * The counting is the part that needs guarding. "Accepted" and "Declined" are
 * decisions somebody took, and a request the requester withdrew is neither.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const list = () => read("web/app/applications/page.tsx");
const detail = () => read("web/app/applications/[requestId]/page.tsx");
const record = () => read("web/src/components/requests/RequestRecord.tsx");
const meaning = () => read("web/src/lib/tenancyRequests.ts");
const css = () => read("web/src/styles/tenancy-requests-workspace.css");
const paymentsCss = () => read("web/src/styles/payments-workspace.css");

/** The declarations inside one CSS rule, by selector. */
function rule(sheet, selector) {
  const at = sheet.indexOf(selector + " {");
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

test("a request opens at its own address, not in a layer", () => {
  assert.ok(
    existsSync(resolve(root, "web/app/applications/[requestId]/page.tsx")),
    "a request needs a route",
  );
  assert.match(code(detail()), /useParams<\{ requestId: string \}>\(\)/);
  assert.match(code(detail()), /requestRecordId\(row\) === requestId/);

  // The dialog and everything that drove it are gone.
  const body = code(list());
  assert.doesNotMatch(body, /RequestDetail/);
  assert.doesNotMatch(body, /selectedKey/);
  assert.doesNotMatch(body, /showModal/);
  assert.doesNotMatch(css(), /\.request-dialog/);

  // Rows are links, so a request can be opened in a new tab or sent to somebody.
  assert.match(body, /href=\{`\/applications\/\$\{requestRecordId\(item\)\}` as never\}/);
  assert.doesNotMatch(body, /<button type="button" className="request-row"/);
  assert.match(rule(css(), ".request-row"), /text-decoration: none/);
});

test("the page is laid out the way Payments is", () => {
  const body = code(list());

  // Three counts, a search, the stages as pills, then the list — in that order.
  //
  // Matched as whole class names inside a className attribute, not as bare
  // substrings: `indexOf("requests-search")` also finds `requests-searchX`, so
  // renaming the element out of the page left this passing.
  const order = ["requests-overview", "requests-search", "requests-filters", "requests-list"];
  let at = -1;
  for (const className of order) {
    const found = body.search(new RegExp(`className="${className}"`));
    assert.notEqual(found, -1, `${className} is not rendered`);
    assert.ok(found > at, `${className} is out of order`);
    at = found;
  }

  // The counts are drawn like the money facts: equal columns, display numerals.
  const overview = rule(css(), ".requests-overview");
  assert.match(overview, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(rule(css(), ".requests-overview dd"), /font-family: var\(--font-display\)/);
  assert.match(
    rule(paymentsCss(), ".payments-overview"),
    /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
    "Payments must keep its settlement-aware overview",
  );

  // The stages are pills, not underlined tabs: the same control Payments uses
  // for all/overdue/outstanding.
  assert.match(rule(css(), ".requests-filters button"), /border-radius: 999px/);
  assert.match(css(), /\.requests-filters button\[aria-pressed="true"\][\s\S]{0,140}--color-kola-50/);
  assert.doesNotMatch(css(), /\.requests-tab\b/);

  // Search gets its own line rather than sharing one with the tabs.
  assert.doesNotMatch(css(), /\.requests-controls/);
  assert.match(rule(css(), ".requests-search"), /width: min\(100%, 30rem\)/);
});

test("accepted and declined count decisions, not departures", () => {
  // A request the requester withdrew was not declined by anybody. Counting it
  // would put a decision in the provider's name that they never took, so the
  // three numbers do not sum to the total — and should not.
  const body = code(meaning());
  assert.match(body, /application\.status === "accepted"\) return "accepted"/);
  assert.match(body, /application\.status === "rejected"\) return "declined"/);
  assert.match(body, /request\.status === "approved"\) return "accepted"/);
  assert.match(body, /request\.status === "rejected"\) return "declined"/);
  assert.match(body, /return "open"/);

  // Neither "withdrawn" nor "cancelled" is treated as an outcome.
  assert.doesNotMatch(body, /"withdrawn".{0,40}(accepted|declined)/);
  assert.doesNotMatch(body, /"cancelled".{0,40}(accepted|declined)/);

  // And the page counts through that function rather than inventing its own.
  assert.match(code(list()), /requestOutcome\(item\) === "accepted"/);
  assert.match(code(list()), /requestOutcome\(item\) === "declined"/);
  assert.match(code(list()), /total: rows\.length/);
});

test("both kinds of request stay one list and one vocabulary", () => {
  // A public application and a private Unit request are separate tables with
  // separate status words. A provider is answering the same question either way.
  const body = code(meaning());
  assert.match(body, /kind: "application"/);
  assert.match(body, /kind: "private"/);
  for (const name of ["requestStage", "requestStatus", "requestWho", "requestWhere"]) {
    assert.match(body, new RegExp(`export function ${name}\\(`));
  }
  // Written once: the list and the record both say it.
  assert.match(code(list()), /from "@\/lib\/tenancyRequests"/);
  assert.match(code(record()), /from "@\/lib\/tenancyRequests"/);
  assert.doesNotMatch(code(list()), /^function requestStage\(/m);
  assert.doesNotMatch(code(record()), /^function requestStatus\(/m);
});

test("leaving a request and coming back lands where you left", () => {
  const body = code(list());
  assert.match(body, /useSearchParams\(\)/);
  assert.match(body, /search\.get\("show"\)/);
  assert.match(body, /search\.get\("q"\)/);
  assert.match(body, /router\.replace\(/);
  assert.match(body, /<Suspense/);
  // Only stages the page knows are honoured.
  assert.match(body, /REQUEST_FILTERS\.find\(/);
});

test("moving the record did not move the authority", () => {
  const body = code(record());
  // Every decision still goes to the endpoint it always did.
  assert.match(body, /applicationAction\(application\.id, "accept", note\)/);
  assert.match(body, /applicationAction\(application\.id, "reject", note\)/);
  assert.match(body, /decidePropertyJoinRequest\(request!\.id, true, ""\)/);
  assert.match(body, /decidePropertyJoinRequest\(request!\.id, false, note\)/);

  // `can_manage` is the server's answer and still gates both buttons.
  assert.match(body, /disabled=\{request \? !request\.can_manage : false\}/);
  assert.match(body, /disabled=\{busy \|\| Boolean\(request && !request\.can_manage\)\}/);
  assert.match(body, /title="View only"/);

  // Declining is still confirmed rather than fired from one press.
  assert.match(body, /title="Decline this request\?"/);
  assert.match(body, /setConfirmingDecline\(true\)/);
});
