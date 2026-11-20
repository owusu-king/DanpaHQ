import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./propertyCard.ts", import.meta.url), "utf8");
const native = readFileSync(new URL("../../../mobile/src/propertyCard.ts", import.meta.url), "utf8");
const scope = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, scope);
const { propertyCardPresentation } = scope.exports;

test("native and web use the same card presentation", () => {
  const withoutHeader = (file) => file.replace(/^\/\/.*\r?\n/, "").replace(/\r\n/g, "\n");
  assert.equal(withoutHeader(native), withoutHeader(source));
});

function presentation(state, review_state, { canEdit = true, canSubmit = true } = {}) {
  return propertyCardPresentation({
    verification: { state, review_state },
    permitted_actions: {
      edit: { allowed: canEdit },
      submit_for_verification: { allowed: canSubmit },
    },
  });
}

test("property cards distinguish ready, draft, in review and verified", () => {
  assert.equal(presentation("draft", "not_submitted").action, "continue");
  assert.equal(presentation("ready_for_submission", "not_submitted").action, "submit");
  assert.equal(presentation("verified", "verified").action, "view");
  for (const state of ["submitted", "under_review"]) {
    const row = presentation(state, "pending_verification");
    assert.equal(row.action, "details");
    assert.equal(row.badge, "Under review");
  }
});

test("property cards respect denied actions and leave attention states to the detail page", () => {
  assert.equal(presentation("draft", "not_submitted", { canEdit: false }).action, "details");
  assert.equal(presentation("ready_for_submission", "not_submitted", { canSubmit: false }).action, "details");
  assert.equal(presentation("ready_for_submission", "withdrawn", { canSubmit: false }).action, "details");
  assert.equal(presentation("ready_for_submission", "withdrawn").action, "submit");
  for (const review of ["changes_required", "rejected", "suspended", "expired"]) {
    const row = presentation(review, review);
    assert.equal(row.action, "details");
    assert.equal(row.badge, "Needs attention");
  }
});
