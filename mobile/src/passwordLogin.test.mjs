import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function harness(identifier, { failure, workspace = "tenant", response } = {}) {
  const calls = [];
  const sessions = [];
  const routes = [];
  const states = [];
  const user = { id: "existing-member" };
  const tokens = { access_token: "access", refresh_token: "refresh", expires_in: 900, user };
  class ApiFailure extends Error {}
  let stateIndex = 0;
  const imports = {
    "@/mfa": (() => {
      const exports = {};
      vm.runInNewContext(ts.transpileModule(readFileSync(new URL("./mfa.ts", import.meta.url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText, { exports });
      return exports;
    })(),
    react: { useState(initial) {
      const index = stateIndex++;
      states[index] = index === 1 ? "my password " : initial;
      return [states[index], (value) => { states[index] = value; }];
    } },
    "react-native": { Platform: { OS: "android" } },
    "@/api": { ApiFailure, apiFetch: async (...args) => {
      calls.push(args);
      if (failure === "credentials") throw new Error("Request failed");
      return response ?? tokens;
    } },
    "@/auth": { useAuth: () => ({ deviceFingerprint: "installation", signIn: async (session) => {
      sessions.push(session); return "context";
    } }) },
    "@/formErrors": { isNotAProvider: () => failure === "workspace", fieldErrorsFrom: () => ({}) },
    "@/navigation": { resolveEntryRoute: () => "/existing-dashboard" },
    "@/device": { describeDevice: () => "My phone" },
    "@/workspace": { chooseWorkspace: async () => {
      if (failure === "workspace") throw new Error("Not a provider");
      return user;
    } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(
    readFileSync(new URL("./signInFlow.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText, { exports, require: (name) => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  const flow = exports.useSignInFlow({ workspace, initialPhone: identifier,
    onSignedIn: (route) => routes.push(route) });
  return { flow, calls, sessions, routes, states };
}

for (const identifier of [" AMA@example.com ", "0201234567", "+233201234567"]) {
  test(`password login forwards ${identifier.trim()} through the existing session flow`, async () => {
    const h = harness(identifier);
    await h.flow.submit();
    assert.equal(h.calls[0][0], "/auth/sign-in/");
    const request = h.calls[0][1];
    assert.equal(request.anonymous, true);
    assert.equal(request.body.identifier, identifier.trim());
    assert.equal(request.body.password, "my password ");
    assert.equal(request.body.device_fingerprint, "installation");
    assert.equal("phone" in request.body, false);
    assert.equal(h.sessions[0].refresh_token, "refresh");
    assert.deepEqual(h.routes, ["/existing-dashboard"]);
  });
}

test("invalid credentials never create a client session", async () => {
  const h = harness("ama@example.com", { failure: "credentials" });
  await h.flow.submit();
  assert.equal(h.sessions.length, 0);
  assert.equal(h.routes.length, 0);
  assert.equal(h.states[2], false);
  assert.equal(h.states[3], "Could not sign you in.");
});

test("an MFA challenge never enters the mobile signed-in state", async () => {
  const pending = { mfa_required: true, challenge_token: "proof", stage: "enroll", can_skip: false };
  const h = harness("ama@example.com", { response: pending });
  await h.flow.submit();
  assert.equal(h.sessions.length, 0);
  assert.equal(h.routes.length, 0);
  assert.equal(h.states.at(-1), pending);
  assert.equal(h.states[1], "");
});

test("email login preserves the existing provider refusal handling", async () => {
  const h = harness("ama@example.com", { failure: "workspace", workspace: "provider" });
  await h.flow.submit();
  assert.equal(h.sessions.length, 1);
  assert.equal(h.states[4], true);
  assert.equal(h.routes.length, 0);
});
