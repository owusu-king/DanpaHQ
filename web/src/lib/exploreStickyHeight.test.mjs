import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("AllBrowser.tsx", readFileSync(new URL("../components/explore/AllBrowser.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function find(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") {
    const body = node.arguments[0].getText(source);
    if (body.includes('"--explore-tray-height"')) callback = body;
  }
  ts.forEachChild(node, find);
}
find(source);
assert.ok(callback);
const compiled = ts.transpileModule(`var effect = ${callback}; effect;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("public map follows the actual search-bar height through collapse and wrapping", () => {
  const values = new Map();
  let height = 160.2, notify, disconnected = false;
  const explore = { style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) } };
  const element = { closest: () => explore, getBoundingClientRect: () => ({ height }) };
  class ResizeObserver {
    constructor(callback) { notify = callback; }
    observe(target) { assert.equal(target, element); }
    disconnect() { disconnected = true; }
  }
  const effect = vm.runInNewContext(compiled, { signedIn: false, stick: { current: element }, ResizeObserver });
  const cleanup = effect();
  assert.equal(values.get("--explore-tray-height"), "161px");
  height = 80;
  notify();
  assert.equal(values.get("--explore-tray-height"), "80px");
  height = 128;
  notify();
  assert.equal(values.get("--explore-tray-height"), "128px");
  cleanup();
  assert.equal(disconnected, true);
  assert.equal(values.has("--explore-tray-height"), false);
});

test("public map measurement leaves workspace layout unchanged", () => {
  const effect = vm.runInNewContext(compiled, { signedIn: true });
  assert.equal(effect(), undefined);
});
