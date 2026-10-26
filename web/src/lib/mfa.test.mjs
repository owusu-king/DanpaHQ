import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(path, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Error, require: (name) => {
    assert.ok(name in imports, `Unexpected import ${name}`);
    return imports[name];
  } });
  return exports;
}
const mfa = load("./mfa.ts", {});
const pending = { mfa_required: true, challenge_token: "first-factor-proof", stage: "enroll",
  can_skip: false, expires_in: 300, secret: "TEST-KEY", qr_svg: "<svg/>" };

function harness(response) {
  const state = [], calls = [], completed = [];
  let index = 0, cancelled = 0;
  const { MFAStep } = load("../components/auth/MFAStep.tsx", {
    react: { useState: (initial) => {
      const at = index++;
      if (!(at in state)) state[at] = initial;
      return [state[at], (value) => { state[at] = value; }];
    } },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "@/components/Button": { Button: "Button" }, "@/components/Field": { Field: "Field" },
    "@/components/Check": { Check: "Check" }, "@/components/Notice": { Notice: "Notice" },
    "@/lib/mfa": mfa,
  });
  function render(initial = pending) {
    index = 0;
    return MFAStep({ initial, request: async (body) => { calls.push(body); return response(body); },
      onComplete: (value) => completed.push(value), onCancel: () => cancelled++ });
  }
  return { render, calls, completed, cancelled: () => cancelled };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return null;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const found = find(child, predicate); if (found) return found;
  }
  return null;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("QR enrollment waits for code confirmation and saved recovery codes before login", async () => {
  const session = { access_token: "app-token" };
  const h = harness((body) => body.action === "verify"
    ? { ...pending, stage: "recovery", recovery_codes: ["AABBCCDD-11223344"] } : session);
  let tree = h.render();
  assert.match(find(tree, (node) => node.type === "img").props.src, /^data:image\/svg\+xml/);
  assert.equal(find(tree, (node) => node.props?.children === "Set up later"), null);
  find(tree, (node) => node.type === "Field").props.onChange({ target: { value: "123456" } });
  tree = h.render();
  find(tree, (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await tick(); tree = h.render();
  assert.equal(h.completed.length, 0);
  assert.equal(h.calls[0].code, "123456");
  assert.equal(find(tree, (node) => node.props?.children === "Continue").props.disabled, true);
  find(tree, (node) => node.type === "Check").props.onChange(true);
  tree = h.render();
  const next = find(tree, (node) => node.props?.children === "Continue");
  assert.equal(next.props.disabled, false);
  next.props.onClick(); await tick();
  assert.deepEqual(h.completed, [session]);
  assert.equal(h.calls[1].action, "complete");
});

test("optional setup can be skipped; cancellation never sends enrollment requests", async () => {
  const h = harness(() => ({ access_token: "app-token" }));
  const tree = h.render({ ...pending, can_skip: true });
  find(tree, (node) => node.props?.children === "Set up later").props.onClick(); await tick();
  assert.equal(h.calls[0].action, "skip");
  find(tree, (node) => node.props?.children === "Back to sign in").props.onClick();
  assert.equal(h.cancelled(), 1);
  assert.equal(h.calls.length, 1);
});

test("invalid codes stay on the challenge and never establish a session", async () => {
  const h = harness(() => { throw new Error("That code did not match."); });
  let tree = h.render({ ...pending, stage: "verify" });
  find(tree, (node) => node.type === "Field").props.onChange({ target: { value: "wrong" } });
  tree = h.render();
  find(tree, (node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  await tick(); tree = h.render();
  assert.equal(h.completed.length, 0);
  assert.equal(find(tree, (node) => node.type === "Notice").props.title, "That code did not match.");
});
