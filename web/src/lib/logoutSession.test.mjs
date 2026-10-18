import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
function harness(storage = new Map()) {
  const exports = {};
  let request = async () => null;
  const events = [];
  class ApiFailure extends Error {
    constructor(error, status) {
      super(error.message);
      this.error = error;
      this.status = status;
    }
  }
  class BrowserEvent { constructor(type) { this.type = type; } }
  const source = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    Event: BrowserEvent,
    window: {
      dispatchEvent: (event) => events.push(event.type),
      localStorage: {
        getItem: (k) => storage.get(k),
        setItem: (k, v) => storage.set(k, v),
        removeItem: (k) => storage.delete(k),
      },
    },
    require: (name) => name === "./api" ? { ApiFailure, apiFetch: (...args) => request(...args) } : { getWebDeviceContext: () => ({}) },
  });
  return { api: exports, ApiFailure, events, storage, request: (fn) => { request = fn; } };
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

test("concurrent callers share one refresh rotation", async () => {
  const h = harness();
  let calls = 0;
  let finish;
  h.request((path) => {
    assert.equal(path, "/auth/refresh/");
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  });

  const first = h.api.getAccessToken();
  const second = h.api.getAccessToken();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  finish({ access_token: "shared", expires_in: 900 });
  assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
});

test("the no-cookie refresh contract invalidates once and does not loop", async () => {
  const h = harness();
  let calls = 0;
  h.request(async () => {
    calls += 1;
    throw new h.ApiFailure(
      { code: "validation_failed", message: "Sign in again.", details: {}, requestId: "test" },
      422,
    );
  });

  await assert.rejects(h.api.getAccessToken(), { status: 422 });
  await assert.rejects(h.api.getAccessToken(), { status: 401 });
  assert.equal(calls, 1, "an ended session must not submit the missing cookie again");
  assert.deepEqual(h.events, ["danpahq:session-invalid"]);
  assert.equal(h.storage.get("session.logged_out"), "1");
});

test("an expired or invalid refresh credential ends the session", async () => {
  const h = harness();
  h.request(async () => {
    throw new h.ApiFailure(
      { code: "permission_denied", message: "Your session has expired.", details: {}, requestId: "test" },
      403,
    );
  });

  await assert.rejects(h.api.getAccessToken(), { status: 403 });
  await assert.rejects(h.api.getAccessToken(), { status: 401 });
  assert.deepEqual(h.events, ["danpahq:session-invalid"]);
});

test("a malformed refresh response remains diagnosable and retryable", async () => {
  const h = harness();
  let calls = 0;
  h.request(async () => {
    calls += 1;
    throw new h.ApiFailure(
      {
        code: "validation_failed",
        message: "Some of the details need fixing.",
        details: { fields: { platform: ["invalid"] } },
        requestId: "test",
      },
      422,
    );
  });

  await assert.rejects(h.api.getAccessToken(), { status: 422 });
  await assert.rejects(h.api.getAccessToken(), { status: 422 });
  assert.equal(calls, 2, "a client defect is not persisted as a signed-out session");
  assert.deepEqual(h.events, []);
});

test("network and server refresh failures remain diagnosable", async () => {
  for (const [status, code] of [[0, "network_error"], [503, "server_error"]]) {
    const h = harness();
    h.request(async () => {
      throw new h.ApiFailure({ code, message: code, details: {}, requestId: "test" }, status);
    });
    await assert.rejects(h.api.getAccessToken(), { status });
    assert.deepEqual(h.events, []);
  }
});

test("a failed retry reports refresh connectivity instead of hiding it behind a 401", async () => {
  const h = harness();
  h.api.setAccessToken("stale", 900);
  h.request(async (path) => {
    if (path === "/auth/refresh/") {
      throw new h.ApiFailure(
        { code: "network_error", message: "offline", details: {}, requestId: "refresh" },
        0,
      );
    }
    throw new h.ApiFailure(
      { code: "authentication_failed", message: "expired", details: {}, requestId: "resource" },
      401,
    );
  });

  await assert.rejects(h.api.authedFetch("/me/"), { status: 0 });
});
