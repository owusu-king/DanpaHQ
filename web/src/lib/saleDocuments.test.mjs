import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

for (const platform of ["web", "mobile"]) {
  const path = resolve(root, `${platform}/src/components/property/PropertyWizard.tsx`);
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const step = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "DocumentsStep");
  let callback;
  function findCommit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useCommit") callback = node.arguments[1].getText(source);
    ts.forEachChild(node, findCommit);
  }
  assert.ok(step, `${platform} Documents step exists`);
  findCommit(step);
  assert.ok(callback, `${platform} Documents step registers its save`);

  test(`${platform}: sale documents cannot be skipped; letting can defer documents`, async () => {
    const scenarios = [
      { saleKind: "residential", ready: false, recorded: false, next: "draft", result: false, saves: 1, reloads: 0 },
      { saleKind: "land", ready: false, recorded: false, next: "draft", result: false, saves: 1, reloads: 0 },
      { saleKind: null, ready: false, recorded: false, next: "draft", result: true, saves: 0, reloads: 0 },
      { saleKind: "residential", ready: false, recorded: true, next: "ready", result: true, saves: 0, reloads: 0 },
      { saleKind: "residential", ready: true, recorded: false, next: "draft", result: false, saves: 1, reloads: 1 },
      { saleKind: "residential", ready: true, recorded: false, next: "ready", result: true, saves: 1, reloads: 1 },
    ];
    for (const scenario of scenarios) {
      let saves = 0;
      let reloads = 0;
      const claim = { current: async () => { saves++; } };
      const commit = vm.runInNewContext(`(${callback})`, {
        ...scenario, claim, claimRef: claim,
        reload: async () => {
          reloads++;
          return { verification: { authority: { state: scenario.next } } };
        },
      });
      assert.equal(await commit(), scenario.result, JSON.stringify(scenario));
      assert.equal(saves, scenario.saves);
      assert.equal(reloads, scenario.reloads);
    }
  });
}
