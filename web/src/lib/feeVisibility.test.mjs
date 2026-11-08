import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = readFileSync(new URL("../components/viewings/ViewingFee.tsx", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, {
  exports,
  require(name) {
    if (name === "react") return { useState: (value) => [value, () => {}] };
    if (name === "next/navigation") return { useRouter: () => ({}) };
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "@/lib/money") return { formatMoney: () => "GH₵25.00" };
    return {};
  },
});

test("disabled viewing fees render no panel for either workspace, including existing quotes", () => {
  for (const tenant of [true, false]) {
    for (const amount_minor of [0, 2500]) {
      const viewing = { status: "offered", fee_policy: { mode: "disabled" }, fee: { amount_minor, currency: "GHS", status: "unpaid", collection: "platform" } };
      assert.equal(exports.ViewingFee({ viewing, tenant, onChanged: async () => {} }), null);
    }
  }
});

test("free viewing fees remain visible when management explicitly selects Free", () => {
  const viewing = { status: "offered", fee_policy: { mode: "free" }, fee: { amount_minor: 0, currency: "GHS", status: "free", collection: "platform" } };
  assert.ok(exports.ViewingFee({ viewing, tenant: true, onChanged: async () => {} }));
});
