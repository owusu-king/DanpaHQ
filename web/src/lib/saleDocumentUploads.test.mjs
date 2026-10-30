import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

for (const platform of ["web", "mobile"]) {
  const source = ts.createSourceFile("claim.tsx", readFileSync(new URL(platform === "web" ? "../components/property/AuthorityClaim.tsx" : "../../../mobile/src/components/property/AuthorityClaim.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submit, ready;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") submit = node.getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "ready") ready = node.initializer.getText(source);
    ts.forEachChild(node, find);
  }
  find(source);
  const compiled = ts.transpileModule(`${submit}; submit;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

  test(`${platform}: only the sale title is mandatory, optional uploads and file validation work`, async () => {
    for (const scenario of [
      { selling: true, title: true, extra: false, usable: true, count: 1 },
      { selling: true, title: true, extra: true, usable: true, count: 3 },
      { selling: true, title: false, extra: true, usable: true, count: 0 },
      { selling: true, title: true, extra: false, usable: false, count: 1 },
      { selling: false, title: false, extra: true, usable: true, count: 1 },
      { selling: false, title: false, extra: false, usable: true, count: 0 },
    ]) {
      const uploads = [], claims = [], errors = [];
      const title = scenario.title ? { name: "title.pdf", fileName: "title.jpg" } : null;
      const document = scenario.extra ? { name: "authority.pdf", fileName: "authority.jpg" } : null;
      const upload = async (file, purpose) => {
        assert.ok(file);
        assert.equal(purpose, "property_document");
        uploads.push(file);
        return { id: `file-${uploads.length}`, is_usable: scenario.usable };
      };
      const context = vm.createContext({
        selling: scenario.selling, land: scenario.selling, file: document, document,
        titleFile: title, title, sitePlan: scenario.extra ? document : null,
        titleType: "indenture", propertyId: "property", relationship: "owner", actingForAnother: false,
        ownerName: "", ownerPhone: "", companyName: "", ApiFailure: class extends Error {},
        uploadFile: upload, uploadImage: upload, recordPropertyClaim: async (...args) => claims.push(args),
        setError: value => { if (value) errors.push(value); }, setBusy() {}, setSent() {}, onSubmitted: async () => {},
      });
      assert.equal(vm.runInContext(ready, context), scenario.selling ? scenario.title : scenario.extra);
      await vm.runInContext(compiled, context)();
      assert.equal(uploads.length, scenario.count, JSON.stringify(scenario));
      const succeeds = scenario.usable && (scenario.selling ? scenario.title : scenario.extra);
      assert.equal(claims.length, succeeds ? 1 : 0);
      assert.equal(errors.length, succeeds ? 0 : 1);
      if (succeeds && scenario.selling) {
        const payload = claims[0][1];
        assert.equal(payload.file_ids.length, scenario.count);
        assert.ok(Object.values(payload.evidence_types).includes("indenture"));
        assert.equal(Object.values(payload.evidence_types).includes("site_plan"), scenario.extra);
      }
    }
  });
}
