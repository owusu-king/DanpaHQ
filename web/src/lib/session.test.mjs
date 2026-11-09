import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const modules = new Map([
  ["@/lib/apiBase", { API_BASE_URL: "https://api.example.test" }],
  ["./device", { getWebDeviceContext: () => ({ platform: "web" }) }],
]);
const storage = new Map();
const window = new EventTarget();
window.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const navigator = {};
let send;
const context = vm.createContext({
  window, navigator, Event, AbortController, setTimeout, clearTimeout, crypto,
  fetch: (...args) => send(...args),
});
function load(name) {
  if (!modules.has(name)) {
    const { outputText } = ts.transpileModule(
      readFileSync(new URL(`${name}.ts`, import.meta.url), "utf8"),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
    );
    const exports = {};
    vm.runInContext(`(function(exports, require) {${outputText}})`, context)(exports, load);
    modules.set(name, exports);
  }
  return modules.get(name);
}
const { ApiFailure } = load("./api");
const { authedFetch, setAccessToken, clearAccessToken, isSessionRefusal: isRefusal } = load("./auth");
const { shouldRestoreSession, stateAfterFailure } = load("./sessionPolicy");
const failure = (status, code, details = {}) => new ApiFailure({ code, details, message: code, requestId: "" }, status);
const reply = (status, body) => new Response(JSON.stringify(body), { status });
const deny = (status, code) => reply(status, { error: { code } });

/**
 * Session initialization has two independent decisions: whether this route
 * needs a restore attempt, and what a failed attempt means. These tests pin the
 * boundary so a public visitor does not create auth traffic and a malformed or
 * unavailable API does not masquerade as a logout.
 */

const ME = { display_name: "Kwame Owusu" };
const SIGNED_IN = { status: "signed_in", me: ME };

test("the API's actual session refusals sign you out", () => {
  for (const cause of [
    failure(401, "signed_out"),
    failure(401, "session_ended"),
  ]) {
    assert.deepEqual(
      { ...stateAfterFailure(cause, SIGNED_IN) },
      { status: "signed_out" },
      `${cause.status}/${cause.error.code} should end the session`,
    );
  }
});

test("malformed and unexpected client responses are not treated as logout", () => {
  for (const cause of [
    failure(400, "request_failed"),
    failure(401, "authentication_failed"),
    failure(403, "permission_denied"),
    failure(404, "not_found"),
    failure(409, "conflict"),
    failure(422, "validation_failed"),
    failure(422, "validation_failed", { fields: { platform: ["invalid"] } }),
  ]) {
    const next = stateAfterFailure(cause, SIGNED_IN);
    assert.equal(next.status, "signed_in");
    assert.equal(next.stale, true);
    assert.ok(!isRefusal(cause));
  }
});

test("an unreachable service keeps the session, marked stale", () => {
  const next = stateAfterFailure(failure(0, "network_error"), SIGNED_IN);

  assert.equal(next.status, "signed_in");
  assert.equal(next.me, ME, "the identity we already had is kept");
  assert.equal(next.stale, true);
});

test("a server fault keeps the session too", () => {
  for (const status of [500, 502, 503, 504]) {
    const next = stateAfterFailure(failure(status, "server_error"), SIGNED_IN);
    assert.equal(next.status, "signed_in", `${status} must not sign anyone out`);
    assert.equal(next.stale, true);
  }
});

test("a thrown non-ApiFailure is not a logout either", () => {
  const next = stateAfterFailure(new TypeError("network"), SIGNED_IN);
  assert.equal(next.status, "signed_in");
  assert.equal(next.stale, true);
});

test("with nobody signed in yet, unreachable is its own state", () => {
  assert.deepEqual(
    { ...stateAfterFailure(failure(0, "network_error"), { status: "loading" }) },
    { status: "unavailable" },
  );
  assert.deepEqual(
    { ...stateAfterFailure(failure(503, "server_error"), { status: "unavailable" }) },
    { status: "unavailable" },
  );
});

test("a cold load that is refused is a genuine signed-out", () => {
  assert.deepEqual(
    { ...stateAfterFailure(failure(401, "session_ended"), { status: "loading" }) },
    { status: "signed_out" },
  );
});

test("isRefusal separates an auth answer from other failures", () => {
  assert.ok(isRefusal(failure(401, "session_ended")));
  assert.ok(!isRefusal(failure(0, "network_error")));
  assert.ok(!isRefusal(failure(500, "server_error")));
  assert.ok(!isRefusal(new TypeError("network")));
});

test("public startup restores only a browser that has a session hint", () => {
  assert.equal(shouldRestoreSession(false, null), false);
  assert.equal(shouldRestoreSession(false, "0"), false);
  assert.equal(shouldRestoreSession(false, "1"), true);
  assert.equal(shouldRestoreSession(true, null), true, "protected routes always verify once");
});

test("a profile 403 leaves the bearer usable for the next protected page", async () => {
  setAccessToken("valid", 900);
  send = async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer valid");
    return url.endsWith("/me/") ? deny(403, "permission_denied") : reply(200, { ok: true });
  };
  await assert.rejects(authedFetch("/me/"), { status: 403 });
  assert.deepEqual(await authedFetch("/protected/"), { ok: true });
  assert.equal(storage.has("session.logged_out"), false);
});

test("reload and parallel requests rotate once, including a late stale bearer rejection", async () => {
  setAccessToken("old", 900);
  clearAccessToken();
  let rotations = 0;
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  navigator.locks = { request: (name, run) => {
    assert.equal(name, "danpahq:refresh");
    return run();
  } };
  send = async (url, init) => {
    if (url.endsWith("/auth/refresh/")) {
      rotations++;
      assert.equal(init.credentials, "include");
      return reply(200, { access_token: `token-${rotations}`, expires_in: 900 });
    }
    if (init.headers.Authorization === "Bearer token-1" && url.endsWith("/late/")) {
      await delayed;
      return deny(401, "authentication_failed");
    }
    if (init.headers.Authorization === "Bearer token-1" && url.endsWith("/renew/")) {
      return deny(401, "authentication_failed");
    }
    return reply(200, { ok: true });
  };
  await Promise.all([authedFetch("/me/"), authedFetch("/protected/")]);
  assert.equal(rotations, 1);
  const late = authedFetch("/late/");
  await authedFetch("/renew/");
  release();
  await late;
  assert.equal(rotations, 2);
});

test("a failed refresh preserves the session until the server explicitly ends it", async () => {
  setAccessToken("expired", 0);
  let invalidations = 0;
  window.addEventListener("danpahq:session-invalid", () => { invalidations++; });
  for (const [status, code] of [[403, "permission_denied"], [503, "provider_unavailable"]]) {
    send = async () => deny(status, code);
    await assert.rejects(authedFetch("/me/"), { status });
    assert.equal(invalidations, 0);
  }
  send = async () => deny(401, "session_ended");
  await assert.rejects(authedFetch("/me/"), { status: 401 });
  assert.equal(invalidations, 1);
  assert.equal(storage.get("session.logged_out"), "1");
});

test("a client deadline and invalid gateway response have separate errors", async () => {
  const { apiFetch } = load("./api");
  send = async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  await assert.rejects(apiFetch("/slow/", { timeoutMs: 5 }), (error) => error.error.code === "request_timeout");
  send = async () => new Response("<html>gateway unavailable</html>", { status: 502 });
  await assert.rejects(apiFetch("/down/", { maxAttempts: 1 }), (error) => error.error.code === "service_unavailable");
});
