import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./useGlide.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const placeTile = new Function("require", "exports", `${compiled}; return placeTile;`)(createRequire(import.meta.url), {});
const { useGlide: createGlideHandlers } = new Function("require", "exports", `${compiled}; return exports;`)(
  (name) => name === "react" ? { useLayoutEffect() {} } : createRequire(import.meta.url)(name), {},
);
function root() {
  const values = new Map([["--current-x", "0px"], ["--current-y", "600px"], ["--current-w", "200px"], ["--current-h", "40px"], ["--hover-y", "80px"]]);
  const attributes = new Set(["data-current", "data-hover"]);
  return {
    values, attributes, scrollTop: 120, scrollLeft: 0, clientTop: 1, clientLeft: 1,
    getBoundingClientRect: () => ({ top: 100, left: 20 }),
    style: { setProperty: (key, value) => values.set(key, value), removeProperty: (key) => values.delete(key) },
    setAttribute: (key) => attributes.add(key), removeAttribute: (key) => attributes.delete(key),
  };
}

test("leaving the sidebar for Updates clears the old highlight bounds", () => {
  const nav = root();
  placeTile(nav, "current", null);
  assert.ok(!nav.attributes.has("data-current"));
  for (const axis of ["x", "y", "w", "h"]) assert.ok(!nav.values.has(`--current-${axis}`));
  assert.equal(nav.values.get("--hover-y"), "80px");
});

test("highlight coordinates account for scrolling and the container border", () => {
  const nav = root();
  placeTile(nav, "current", { getBoundingClientRect: () => ({ top: 180, left: 33, width: 140, height: 40 }) });
  assert.equal(nav.values.get("--current-y"), "199px");
  assert.equal(nav.values.get("--current-x"), "12px");
  assert.equal(nav.values.get("--current-h"), "40px");
});

test("leaving a navigation highlight accepts window and missing focus targets", () => {
  class DocumentNode {}
  for (const relatedTarget of [{ window: true }, null, undefined]) {
    const nav = root();
    nav.ownerDocument = { defaultView: { Node: DocumentNode } };
    nav.contains = () => { throw new Error("contains must only receive a DOM node"); };
    const { rest } = createGlideHandlers({ current: nav }, { link: "a", current: "a[aria-current]", layoutKey: "test" });
    assert.doesNotThrow(() => rest({ relatedTarget }));
    assert.ok(!nav.attributes.has("data-hover"));
    assert.ok(!nav.values.has("--hover-y"));
  }
});

test("focus within navigation retains its highlight; an outside node clears it", () => {
  class DocumentNode {}
  const inside = new DocumentNode();
  const outside = new DocumentNode();
  const nav = root();
  nav.ownerDocument = { defaultView: { Node: DocumentNode } };
  nav.contains = (target) => target === inside;
  const { rest } = createGlideHandlers({ current: nav }, { link: "a", current: "a[aria-current]", layoutKey: "test" });
  rest({ relatedTarget: inside });
  assert.ok(nav.attributes.has("data-hover"));
  rest({ relatedTarget: outside });
  assert.ok(!nav.attributes.has("data-hover"));
});
