import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function updatesHarness({ failLoad = false } = {}) {
  const hooks = [];
  const pending = new Map();
  const effects = [];
  const events = [];
  let cursor = 0;
  let rendering = false;
  let tree;
  const item = { id: "update-1", record: "informational", is_read: false,
    created_at: "2026-10-23T10:00:00Z" };
  const memo = (callback, deps) => {
    const index = cursor++;
    if (!hooks[index] || deps.some((dep, i) => dep !== hooks[index].deps[i])) {
      hooks[index] = { value: callback(), deps };
    }
    return hooks[index].value;
  };
  const router = { push() {} };
  const imports = {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = initial;
        for (const value of pending.get(index) ?? []) {
          // React may replay updater functions while rendering. Neither call
          // may publish events to a different component.
          if (typeof value === "function") {
            value(hooks[index]);
            hooks[index] = value(hooks[index]);
          } else hooks[index] = value;
        }
        pending.delete(index);
        return [hooks[index], (value) => pending.set(index, [...(pending.get(index) ?? []), value])];
      },
      useRef: (initial) => memo(() => ({ current: initial }), []),
      useMemo: memo,
      useCallback: (callback, deps) => memo(() => callback, deps),
      useEffect(callback, deps) {
        memo(() => { effects.push(callback); return null; }, deps);
      },
      useLayoutEffect() {},
      useTransition: () => [false, (callback) => callback()],
    },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    "next/navigation": { useRouter: () => router },
    "@/components/toast/Toaster": { useToast: () => ({ toast() {} }) },
    "@/lib/api": { ApiFailure: class extends Error {} },
    "@/lib/console": {
      listNotificationHistory: async () => {
        if (failLoad) throw new Error("offline");
        return { results: [item], unread_count: 1 };
      },
      markNotificationsRead: async () => {},
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(
    readFileSync(new URL("../../app/updates/page.tsx", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX } },
  ).outputText, { exports, require: (name) => imports[name] ?? {},
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    window: { sessionStorage: { getItem: () => null, removeItem() {} }, dispatchEvent(event) {
      assert.equal(rendering, false, "Unread events must never update PortalShell during render");
      events.push(event.detail);
    } } });
  function render() {
    cursor = 0; rendering = true;
    try { tree = exports.default(); } finally { rendering = false; }
  }
  function commit() { while (effects.length) effects.shift()(); }
  function find(node, predicate) {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const value of Object.values(node.props ?? {})) {
      for (const child of Array.isArray(value) ? value : [value]) {
        const match = find(child, predicate);
        if (match) return match;
      }
    }
    return null;
  }
  return { events, item, render, commit,
    acknowledge: () => find(tree, (node) => Boolean(node.props?.onAcknowledge)).props.onAcknowledge(item),
    markAll: () => find(tree, (node) => node.props?.["aria-label"] === "Mark all updates as read").props.onClick(),
  };
}

async function load(h) {
  h.render(); h.commit();
  assert.deepEqual(h.events, [], "Loading must not reset the shell badge to zero");
  await new Promise(setImmediate);
  h.render(); h.commit();
}

test("acknowledging an update only publishes its unread count after commit", async () => {
  const h = updatesHarness();
  await load(h);
  assert.deepEqual(h.events, [1]);
  h.acknowledge();
  h.render();
  assert.deepEqual(h.events, [1]);
  h.commit();
  assert.deepEqual(h.events, [1, 0]);
});

test("mark all read publishes zero after the page commits", async () => {
  const h = updatesHarness();
  await load(h);
  h.markAll();
  await new Promise(setImmediate);
  h.render();
  assert.deepEqual(h.events, [1]);
  h.commit();
  assert.deepEqual(h.events, [1, 0]);
});

test("a failed load leaves the shell unread badge unchanged", async () => {
  const h = updatesHarness({ failLoad: true });
  await load(h);
  assert.deepEqual(h.events, []);
});
