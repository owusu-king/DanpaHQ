import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function dialog(dismissible) {
  let closed = 0;
  let prevented = false;
  const jsx = (type, props) => ({ type, props });
  const imports = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useCallback: (callback) => callback, useEffect: () => {}, useLayoutEffect: () => {},
      useId: () => "test-dialog", useRef: (current) => ({ current }), useState: (value) => [value, () => {}],
    },
    "@/components/portal/icons": { Icon: "Icon" },
    "@/lib/modalOrigin": { isBackdropClick: () => true },
  };
  const exports = {};
  const source = readFileSync(new URL("../components/workspace/ModalSheet.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    exports, require: (name) => imports[name], window: { matchMedia: () => ({ matches: true }) },
  });
  const tree = exports.ModalSheet({ open: true, dismissible, onClose: () => { closed++; }, title: "Creation", icon: "properties", children: "Form" });
  return { tree, cancel: () => tree.props.onCancel({ preventDefault: () => { prevented = true; } }), closed: () => closed, prevented: () => prevented };
}

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  const children = node.props?.children;
  return [node, ...(Array.isArray(children) ? children : [children]).flatMap(nodes)];
}

test("creation dialog ignores backdrop and Escape but its X still closes", () => {
  const modal = dialog(false);
  modal.cancel();
  modal.tree.props.onClick({});
  assert.equal(modal.prevented(), true);
  assert.equal(modal.closed(), 0);
  nodes(modal.tree).find((node) => node.props?.className === "doc-modal-close").props.onClick();
  assert.equal(modal.closed(), 1);
});

test("other workspace dialogs retain backdrop and Escape dismissal", () => {
  const modal = dialog(true);
  modal.cancel();
  modal.tree.props.onClick({});
  assert.equal(modal.closed(), 2);
});


test("property creation finishes without opening verification confirmation", () => {
  const properties = readFileSync(new URL("../../app/properties/page.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../app/record/property-new/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(properties, /PropertyVerificationModal|setVerificationProperty/);
  assert.match(properties, /onFinished=\{\(\) => void load\(true\)\}/);
  assert.doesNotMatch(route, /PropertyVerificationModal|setVerificationProperty/);
  assert.ok(properties.indexOf("<AddPropertyCard", properties.indexOf("visible.length > 0")) < properties.indexOf("{visible.map"));
});


test("Newest uses creation timestamps, with deterministic invalid-date fallback", () => {
  const source = readFileSync(new URL("../../app/properties/page.tsx", import.meta.url), "utf8");
  const helper = source.match(/function creationTime[^\n]+/)[0];
  const start = source.indexOf(".sort((a, b) => {") + ".sort((a, b) => ".length;
  const body = source.slice(start, source.indexOf("      });", start)) + "}";

  const scope = { exports: {} };
  vm.runInNewContext(ts.transpileModule(`${helper}\nconst sort = "newest"; exports.compare = (a, b) => ${body};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope);
  const rows = [
    { id: "missing", title: "Missing" }, { id: "old", title: "Old", created_at: "2025-01-01T00:00:00Z" },
    { id: "new", title: "New", created_at: "2026-10-28T23:00:00Z" }, { id: "invalid", title: "Invalid", created_at: "bad date" },
  ];
  assert.deepEqual(rows.sort(scope.exports.compare).map((row) => row.id), ["new", "old", "invalid", "missing"]);
});
