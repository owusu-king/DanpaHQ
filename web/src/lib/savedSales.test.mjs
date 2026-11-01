import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("sale shortlist reads and mutations use the authenticated sale endpoint", async () => {
  const calls = [];
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("./sales.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ authedFetch: async (...args) => { calls.push(args); return []; } }) });
  await exports.listSavedSales();
  await exports.saveSale("sale-id");
  await exports.unsaveSale("sale-id");
  assert.equal(calls[0][0], "/me/saved-sales/");
  assert.equal(calls[1][1].method, "POST");
  assert.equal(calls[2][1].method, "DELETE");
  for (const call of calls.slice(1)) assert.deepEqual(JSON.parse(call[1].body), { sale_id: "sale-id" });
});
