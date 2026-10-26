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
const detail = () => read("web/app/record/application/page.tsx");
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
    existsSync(resolve(root, "web/app/record/application/page.tsx")),
    "a request needs a route",
  );
  assert.match(code(detail()), /useSearchParams\(\)\.get\("requestId"\)/);
  assert.match(code(detail()), /requestRecordId\(row\) === requestId/);

  // The dialog and everything that drove it are gone.
  const body = code(list());
  assert.doesNotMatch(body, /RequestDetail/);
  assert.doesNotMatch(body, /selectedKey/);
  assert.doesNotMatch(body, /showModal/);
  assert.doesNotMatch(css(), /\.request-dialog/);

  // Rows are links, so a request can be opened in a new tab or sent to somebody.
  assert.match(body, /href=\{`\/record\/application\?requestId=\$\{requestRecordId\(item\)\}` as never\}/);
  assert.doesNotMatch(body, /<button type="button" className="request-row"/);
  assert.match(rule(css(), ".request-row"), /text-decoration: none/);
});

test("the page is the shared workspace, with the counts as rings", () => {
  const body = code(list());
  const provider = body.slice(body.indexOf("function ProviderApplications()"));

  // The rings, the stages, then one panel of rows — in that order.
  //
  // Matched as whole class names inside a className attribute, not as bare
  // substrings, so renaming an element out of the page cannot leave this passing.
  const order = ["requests-overview", "ws-panel requests-panel", "requests-list"];
  let at = -1;
  for (const className of order) {
    const found = provider.search(new RegExp(`className="${className}"`));
    assert.notEqual(found, -1, `${className} is not rendered`);
    assert.ok(found > at, `${className} is out of order`);
    at = found;
  }
  assert.ok(provider.indexOf("<SegmentedControl") > provider.indexOf('className="requests-overview"'), "the stages follow the counts");
  assert.ok(provider.indexOf("<SegmentedControl") < provider.indexOf('className="ws-panel requests-panel"'), "the stages lead the panel");
  assert.match(provider, /<PanelSearch label="Search tenancy requests" placeholder="Search person, Property or Unit"/);

  // Three rings: where every request stands, then each decision as a share of
  // the decisions made — so a withdrawn request never counts against anyone.
  assert.match(provider, /<DonutRing/);
  assert.match(provider, /\{ value: counts\.action, tone: "harmattan" \}/);
  assert.match(provider, /<OutcomeFigure label="Accepted" tone="accepted"/);
  assert.match(provider, /<OutcomeFigure label="Declined" tone="declined"/);
  assert.match(provider, /const decided = outcomes\.accepted \+ outcomes\.declined;/);
  assert.match(rule(css(), ".requests-overview"), /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(rule(css(), ".requests-figure-value"), /font-family: var\(--font-display\)/);

  // The legend is also a way in: each segment filters the list to its stage.
  assert.match(provider, /onPick=\{\(\) => chooseStage\("action"\)\}/);
  assert.match(
    rule(paymentsCss(), ".payments-overview"),
    /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
    "Payments must keep its settlement-aware overview",
  );
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

test("a request opens in a sheet, and the agreement is prepared in the same sheet", () => {
  const list = code(read("web/app/applications/page.tsx"));
  const modal = code(read("web/src/components/requests/RequestModal.tsx"));
  const wizard = code(read("web/src/components/leases/LeaseWizard.tsx"));
  const entry = code(read("web/src/components/property/SpaceTenantAccess.tsx"));

  // A plain click reads the request over the list, held in page state; the
  // row is still a link, so a new tab lands on the request's own page.
  assert.match(list, /useDeepLinkedModal\("request"\)/);
  assert.match(list, /<RequestModal item=\{opened\}/);
  assert.match(list, /event\.preventDefault\(\);\s*onPeek\(\)/);

  // One sheet: preparing widens it into the wizard rather than stacking a dialog.
  assert.match(modal, /className=\{`request-sheet\$\{spec \? " is-wizard" : ""\}`\}/);
  assert.match(modal, /<LeaseWizard/);
  // Preparing is a deeper view of the sheet, with Back to the request.
  assert.match(modal, /onPrepareAgreement=\{nav\.push\}/);

  // The wizard sends the same payload to the same endpoints as the builder did,
  // and sending stays a separate press after the agreement is rendered.
  assert.match(wizard, /draftLease\(\{/);
  assert.match(wizard, /updateLease\(current\.id, payload\)/);
  assert.match(wizard, /leaseAction\(current\.id, "ready"\)/);
  assert.match(wizard, /leaseAction\(lease\.id, "offer"\)/);
  assert.match(wizard, /workflow_version: "canonical_v1"/);

  // Preparing no longer navigates away from the request.
  assert.doesNotMatch(entry, /router\.push\(`\/leases\/new/);
  assert.match(entry, /<LeaseWizardModal/);
});

test("a generated agreement stays with its request until it is sent", () => {
  // `ready` is what finishing the builder leaves; read as settled, it dropped
  // out of Agreement with no way to send it from the request.
  const source = code(read("web/src/lib/tenancyRequests.ts"));
  assert.match(source, /return status === "draft" \|\| status === "ready";/);
  assert.match(source, /agreementUnsent\(item\.lease\.status\)/);
  assert.match(source, /agreementUnsent\(item\.request\.lease_status\)/);
});
