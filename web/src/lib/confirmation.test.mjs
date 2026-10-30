import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./confirmation.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function("exports", output)(exports);

test("confirmation requires exact case, spacing and the entire name", () => {
  for (const expected of ["TENANT", "Alpha House", "Étoile Court", "House 1 & 2"]) {
    assert.equal(exports.confirmsExactly(expected, expected), true);
    for (const value of ["", expected.toLowerCase(), ` ${expected}`, `${expected} `, expected.slice(0, -1)]) {
      assert.equal(exports.confirmsExactly(value, expected), false);
    }
  }
  assert.equal(exports.confirmsExactly("", ""), false);
});
