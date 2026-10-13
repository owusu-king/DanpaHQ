import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
function harness(storage = new Map()) {
  const exports = {};
  let request = async () => null;
  class ApiFailure extends Error {
    constructor(error, status) { super(error.message); this.status = status; }
  }
  const source = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, window: { localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) } },
    require: (name) => name === "./api" ? { ApiFailure, apiFetch: (...args) => request(...args) } : { getWebDeviceContext: () => ({}) },
  });
  return { api: exports, storage, request: (fn) => { request = fn; } };
}

test("offline logout blocks cookie restoration after reload; explicit login reopens the session", async () => {
  const h = harness();
  h.api.setAccessToken("old", 900);
  h.request(async () => { throw new Error("offline"); });
  await h.api.endSession();
  await assert.rejects(h.api.getAccessToken(), { status: 401 });
  const relaunched = harness(h.storage);
  await assert.rejects(relaunched.api.getAccessToken(), { status: 401 });
  relaunched.api.setAccessToken("new", 900);
  assert.equal(await relaunched.api.getAccessToken(), "new");
});

test("logout waits for a pending cookie rotation and refuses its late access token", async () => {
  const h = harness();
  const revoked = [];
  let finish;
  h.request((path, options) => path === "/auth/refresh/"
    ? new Promise((resolve) => { finish = resolve; })
    : (revoked.push(options.headers.Authorization), Promise.resolve(null)));
  const refreshing = h.api.getAccessToken();
  const refused = assert.rejects(refreshing, { status: 401 });
  const leaving = h.api.endSession();
  finish({ access_token: "late", expires_in: 900 });
  await Promise.all([refused, leaving]);
  assert.deepEqual(revoked, ["Bearer late"]);
  await assert.rejects(h.api.getAccessToken(), { status: 401 });
});
