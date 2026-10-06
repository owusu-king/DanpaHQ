import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

function rule(sheet, selector) {
  const at = sheet.indexOf(selector + " {");
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

test("a provider's leases live in Documents, beside the contracts they are made from", () => {
  const nav = read("web/src/lib/portalNav.ts");
  assert.match(nav, /href: "\/documents", label: "Documents"/);
  assert.doesNotMatch(nav, /href: "\/leases", label: "Leases"/);
  // The tenant's own agreements stay where they were.
  assert.match(nav, /href: "\/leases", label: "Agreements"/);

  const page = code(read("web/app/documents/page.tsx"));
  assert.match(page, /\{ key: "contracts", label: "Contracts" \}/);
  assert.match(page, /\{ key: "leases", label: "Leases"/);
  assert.match(page, /<ContractsView/);
  assert.match(page, /<LeasesView/);
});

test("contracts keep Rooomly's wording controlled and a Portfolio's own terms separate", () => {
  const view = code(read("web/src/components/documents/ContractsView.tsx"));
  assert.match(view, /getPortfolioContracts\(organizationId\)/);
  // The standard clauses are read, never edited: no update call names them.
  assert.match(view, /Read the clauses/);
  assert.doesNotMatch(view, /updateAgreement|clauses\s*=\s*\[/);
  // A terms template is written, imported from Word, and given placeholders.
  assert.match(view, /createTermsTemplate\(organizationId, input\)/);
  assert.match(view, /updateTermsTemplate\(organizationId, template\.id, input\)/);
  assert.match(view, /readDocxText\(chosen, known\)/);
  assert.match(view, /accept="\.docx,/);
  assert.match(view, /const token = `\\\$\{\$\{key\}\}`/);
  // An unknown placeholder is caught before it is saved, as the server would.
  assert.match(view, /!unknown\.length && !over/);

  const backend = read("backend/apps/lease/terms_templates.py");
  assert.match(backend, /def unknown_placeholders\(/);
  assert.match(read("backend/apps/lease/documents.py"), /fill_placeholders\(str\(custom\.get\("body"\)/);
});

test("a modal dims the page, not the app, and blurs nothing behind it", () => {
  for (const sheet of ["web/src/styles/enquiries-inbox.css", "web/src/styles/doc-modal.css"]) {
    const css = read(sheet);
    const backdrop = rule(css, sheet.includes("inbox") ? ".inbox::backdrop" : ".doc-modal::backdrop");
    assert.match(backdrop, /inset: var\(--modal-area-top, 0px\) 0 0 var\(--modal-area-left, 0px\)/);
    assert.doesNotMatch(backdrop, /backdrop-filter/);
  }
  const origin = code(read("web/src/lib/modalOrigin.ts"));
  assert.match(origin, /querySelector\("\.portal-rail"\)/);
  assert.match(origin, /querySelector\("\.portal-header"\)/);
});

test("every modal opens the way Change plan does", () => {
  // "Change plan" is the reference: the sheet arrives as one surface on the
  // shared spring, the page behind it holds still, and a press on the dimmed
  // area closes it. The rail and top bar sit outside the dim and stay inert.
  const billing = read("web/src/styles/billing-workspace.css");
  assert.match(billing, /\.billing-dialog\[open\] \{[^}]*modal-spring 460ms[^}]*modal-focus 220ms/);

  // The shared sheet: the same animation, and no late-arriving header or body
  // (they faded in 60ms and 120ms behind the sheet, which read as a flicker).
  const doc = read("web/src/styles/doc-modal.css");
  assert.match(doc, /\.doc-modal\[open\] \{[^}]*modal-spring 460ms[^}]*modal-focus 220ms/);
  assert.doesNotMatch(doc, /\.doc-modal-head \{ animation: modal-content-in/);
  assert.doesNotMatch(doc, /\.doc-modal-body \{ animation: modal-content-in/);
  assert.doesNotMatch(read("web/src/styles/enquiries-inbox.css"), /\.inbox-(list|thread) \{ animation: modal-content-in/);
  // The page behind any open modal does not scroll.
  assert.match(doc, /html:has\(dialog\[open\]\) \{ overflow: hidden; \}/);

  // Only the dimmed area closes: a press on the backdrop, not anywhere outside.
  const origin = code(read("web/src/lib/modalOrigin.ts"));
  assert.doesNotMatch(origin, /closeOnOutsidePress/);
  assert.match(origin, /export function isBackdropClick\(/);
  assert.match(code(read("web/src/components/billing/PlanChangeDialog.tsx")), /event\.target === dialogRef\.current\) requestClose\(\)/);
  for (const file of [
    "web/src/components/workspace/ModalSheet.tsx",
    "web/src/components/enquiries/EnquiriesInbox.tsx",
  ]) {
    const body = code(read(file));
    assert.doesNotMatch(body, /closeOnOutsidePress/, `${file} closes on a press outside`);
    assert.match(body, /if \(isBackdropClick\(dialogRef\.current, event\)\) requestClose\(\)/, `${file} does not close from its dimmed area`);
    assert.match(body, /holdModalInWorkspace\(dialog\)/, `${file} is not placed over the page`);
  }

  // A reopened sheet starts clean: a leftover exit class blinked the first frame.
  assert.match(code(read("web/src/components/workspace/ModalSheet.tsx")), /dialog\.classList\.remove\("is-closing"\);\s*setClosing\(false\);\s*dialog\.showModal\(\)/);

  // Every tenant record — application, agreement, viewing — moved onto the
  // shared sheet itself, so the stylesheet that patched their own dialogs onto
  // the shared motion is gone, and no page-local dialog class is left for it.
  for (const file of [
    "web/src/components/applications/ApplicationRecord.tsx",
    "web/src/components/tenant/AgreementRecord.tsx",
    "web/src/components/tenant/ViewingRecord.tsx",
  ]) {
    assert.match(code(read(file)), /<ModalSheet/, `${file} is not on the shared sheet`);
    assert.doesNotMatch(code(read(file)), /<dialog/, `${file} still draws its own dialog`);
  }
  const globals = read("web/app/globals.css");
  assert.doesNotMatch(globals, /modal-conform\.css/);
});

test("a modal navigates to a deeper view instead of stacking another modal", () => {
  const views = code(read("web/src/components/workspace/ModalViews.tsx"));
  const sheet = code(read("web/src/components/workspace/ModalSheet.tsx"));
  const css = read("web/src/styles/doc-modal.css");

  // The trail stays mounted, only hidden, so Back returns to the exact view;
  // the sheet's scroll is saved going in and restored coming back.
  assert.match(views, /hidden=\{index !== views\.length - 1\}/);
  assert.match(views, /scrolls\.current\[shown\.current\] = body\.scrollTop/);
  assert.match(views, /const target = scrolls\.current\[depth\] \?\? 0;/);
  // Back sits in the header while a deeper view shows.
  assert.match(sheet, /\{onBack \? \(\s*<button type="button" className="doc-modal-back"/);
  // The view slides from the side it lies on.
  assert.match(css, /data-direction="forward"\] > \.doc-modal-view:not\(\[hidden\]\) \{ animation: modal-view-forward/);
  assert.match(css, /data-direction="back"\] > \.doc-modal-view:not\(\[hidden\]\) \{ animation: modal-view-back/);

  // No sheet that opens a deeper view mounts a second modal to do it.
  for (const file of [
    "web/src/components/payments/PaymentRecordModal.tsx",
    "web/src/components/payments/RentDueModal.tsx",
    "web/src/components/requests/RequestModal.tsx",
  ]) {
    const body = code(read(file));
    assert.match(body, /useModalViews</, `${file} does not navigate its views`);
    assert.equal((body.match(/<ModalSheet\b/g) ?? []).length, 1, `${file} mounts more than one sheet`);
    assert.doesNotMatch(body, /<(ReceiptModal|LeaseModal|RentDueModal)\b/, `${file} stacks a modal`);
  }
});
