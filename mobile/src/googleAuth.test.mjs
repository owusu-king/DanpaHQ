import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
function compile(path, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: (name) => {
    assert.ok(name in imports, `Unexpected dependency ${name}`);
    return imports[name];
  }, Error, Date });
  return exports;
}
const user = { id: "member", account_status: "active", registration_state: "complete",
  capabilities: { active_workspace: "tenant" }, contexts: [], entry_routes: { mobile: "/home" } };
const tokens = { access_token: "app-access", refresh_token: "app-refresh", expires_in: 900, user };
const registration = { registration_required: true, google_registration_ticket: "proof", expires_in: 900,
  profile: { first_name: "Ama", last_name: "Mensah", email: "ama@example.com" } };
const native = { Platform: { OS: "android" } };
const mfa = compile("./mfa.ts", {});

function exchangeHarness(response = tokens) {
  const calls = [];
  const api = compile("./googleAuth.ts", {
    "@/mfa": mfa,
    "react-native": native, "@/device": { describeDevice: () => "My phone" },
    "@/api": { apiFetch: async (...args) => { calls.push(args); return response; } },
  });
  return { api, calls };
}

test("native Google exchange sends an opaque ID token and installation context anonymously", async () => {
  const { api, calls } = exchangeHarness();
  assert.equal(await api.exchangeGoogleCredential("google-id", "provider", "installation"), tokens);
  assert.equal(calls[0][0], "/auth/google/");
  assert.equal(calls[0][1].anonymous, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].body)), {
    credential: "google-id", account_type: "provider", platform: "android",
    device_label: "My phone", device_fingerprint: "installation",
  });
});

test("a new Google identity returns registration proof without establishing a session", async () => {
  const { api } = exchangeHarness(registration);
  assert.equal(await api.exchangeGoogleCredential("google-id", "tenant", "install"), registration);
});

test("Google MFA challenges are forwarded without being treated as app sessions", async () => {
  const pending = { mfa_required: true, challenge_token: "proof", stage: "verify", can_skip: false };
  const exchange = exchangeHarness(pending);
  assert.equal(await exchange.api.exchangeGoogleCredential("google-id", "tenant", "install"), pending);
  const h = flowHarness(pending);
  await h.flow.submit("google-id");
  assert.equal(h.signedIn.length, 0);
  assert.equal(h.routes.length, 0);
  assert.equal(h.registrations.length, 0);
});

test("missing installation and incomplete backend responses fail closed", async () => {
  for (const response of [{}, { access_token: "access", user }, { ...registration, profile: null }]) {
    const { api } = exchangeHarness(response);
    await assert.rejects(api.exchangeGoogleCredential("google-id", "tenant", "install"), /could not|incomplete/);
  }
  const { api, calls } = exchangeHarness();
  await assert.rejects(api.exchangeGoogleCredential("google-id", "tenant", ""), /Could not start/);
  assert.equal(calls.length, 0);
});

test("Google linking uses the authenticated endpoint and no new token pipeline", async () => {
  const { api, calls } = exchangeHarness(user);
  assert.equal(await api.linkGoogleCredential("google-id"), user);
  assert.equal(calls[0][0], "/me/google/");
  assert.equal(calls[0][1].anonymous, undefined);
});

function sdkHarness({ environment = "bare", platform = "android", config = { webClientId: "server-client" } } = {}) {
  const calls = [];
  let response = { type: "success", data: { idToken: "google-id" } };
  const sdk = compile("./googleIdentity.ts", {
    "expo-constants": { __esModule: true, default: { executionEnvironment: environment, expoConfig: { extra: { googleSignIn: config } } } },
    "react-native": { Platform: { OS: platform } },
    "react-native-nitro-google-signin": { GoogleOneTapSignIn: {
      configure: (options) => calls.push(["configure", options]),
      checkPlayServices: async () => calls.push(["playServices"]),
      presentExplicitSignIn: async () => { calls.push(["picker"]); if (response instanceof Error) throw response; return response; },
      signOut: async () => calls.push(["signOut"]),
    } },
  });
  return { sdk, calls, response: (next) => { response = next; } };
}

test("Expo Go and missing native configuration never load Google native code", async () => {
  for (const options of [{ environment: "storeClient" }, { config: {} }, { platform: "ios" }, { platform: "web" }]) {
    const { sdk, calls } = sdkHarness(options);
    assert.ok(sdk.googleUnavailableReason());
    await assert.rejects(sdk.getGoogleCredential());
    assert.equal(calls.length, 0);
  }
});

test("native Google requests the backend audience and always uses the explicit chooser", async () => {
  const { sdk, calls } = sdkHarness();
  assert.equal(await sdk.getGoogleCredential(), "google-id");
  assert.equal(await sdk.getGoogleCredential(), "google-id");
  assert.equal(calls.filter(([action]) => action === "configure").length, 1);
  assert.equal(calls[0][1].webClientId, "server-client");
  assert.equal(calls[0][1].offlineAccess, undefined);
  assert.equal(calls.filter(([action]) => action === "picker").length, 2);
  await sdk.clearGoogleIdentity();
  assert.equal(calls.at(-1)[0], "signOut");
});

test("cancelled native prompts are quiet and do not prevent retry", async () => {
  const { sdk, response } = sdkHarness();
  response({ type: "cancelled", data: null });
  assert.equal(await sdk.getGoogleCredential(), null);
  response(Object.assign(new Error("cancel"), { code: "SIGN_IN_CANCELLED" }));
  assert.equal(await sdk.getGoogleCredential(), null);
  response({ type: "success", data: { idToken: "retry-token" } });
  assert.equal(await sdk.getGoogleCredential(), "retry-token");
});

test("native errors become actionable messages and never expose SDK internals", async () => {
  const { sdk, response } = sdkHarness();
  response(Object.assign(new Error("internal signing detail"), { code: "DEVELOPER_ERROR" }));
  await assert.rejects(sdk.getGoogleCredential(), /not configured/);
  response(Object.assign(new Error("internal"), { code: "PLAY_SERVICES_NOT_AVAILABLE" }));
  await assert.rejects(sdk.getGoogleCredential(), /Update Google Play/);
  response(new Error("internal signing detail"));
  await assert.rejects(sdk.getGoogleCredential(), /unavailable/);
  response({ type: "success", data: null });
  await assert.rejects(sdk.getGoogleCredential(), /unavailable/);
});

function registrationHarness(response = tokens) {
  const calls = [];
  const api = compile("./registrationDraft.ts", {
    "react-native": native, "@/device": { describeDevice: () => "My phone" },
    "@/api": { apiFetch: async (...args) => { calls.push(args); return response; } },
    "@/workspace": { chooseWorkspace: async () => user },
  });
  return { api, calls };
}
const details = { accountType: "tenant", firstName: " Ama ", lastName: "Mensah", email: "ama@example.com",
  dateOfBirth: "1992-01-01", password: "phone-password" };

test("Google registration holds proof in memory and never sends a password or phone ticket", async () => {
  const { api, calls } = registrationHarness();
  api.saveGoogleRegistration("google-proof", "provider", registration.profile);
  assert.equal(api.registrationDraft().googleTicket, "google-proof");
  assert.equal(api.registrationDraft().accountType, "provider");
  assert.equal(api.registrationDraft().password, "");
  const result = await api.submitRegistration({ details, ticket: "", googleTicket: "google-proof", deviceFingerprint: "install" });
  assert.equal(result.session.refresh_token, "app-refresh");
  assert.equal(calls[0][1].anonymous, true);
  assert.equal(calls[0][1].body.google_registration_ticket, "google-proof");
  assert.equal(calls[0][1].body.registration_ticket, undefined);
  assert.equal(calls[0][1].body.password, undefined);
  api.clearRegistrationDraft();
  assert.equal(api.registrationDraft(), null);
});

test("phone registration still sends phone proof and password", async () => {
  const { api, calls } = registrationHarness();
  await api.submitRegistration({ details, ticket: "phone-proof", deviceFingerprint: "install" });
  assert.equal(calls[0][1].body.registration_ticket, "phone-proof");
  assert.equal(calls[0][1].body.password, "phone-password");
  assert.equal(calls[0][1].body.google_registration_ticket, undefined);
});

test("a malformed registration response cannot be treated as a completed session", async () => {
  const { api } = registrationHarness({ user });
  await assert.rejects(api.submitRegistration({ details, ticket: "", googleTicket: "proof", deviceFingerprint: "install" }), /incomplete/);
});

function flowHarness(result = tokens, workspaceFailure = false) {
  const signedIn = [], registrations = [], routes = [], effects = [];
  let exchange = async () => result;
  const api = compile("./googleSignInFlow.ts", {
    "@/mfa": mfa,
    react: {
      useState: (value) => [value, () => {}], useRef: (current) => ({ current }),
      useEffect: (effect) => { effects.push(effect()); },
    },
    "@/api": { ApiFailure: class extends Error {} },
    "@/auth": { useAuth: () => ({ deviceFingerprint: "install", signIn: async (session) => { signedIn.push(session); return null; } }) },
    "@/googleAuth": { exchangeGoogleCredential: (...args) => exchange(...args) },
    "@/workspace": { chooseWorkspace: async () => { if (workspaceFailure) throw new Error("unavailable workspace"); return user; } },
    "@/navigation": { resolveEntryRoute: (me) => me.entry_routes.mobile },
  });
  const flow = api.useGoogleSignInFlow({ accountType: "tenant", onRegistration: (proof) => registrations.push(proof), onSignedIn: (route) => routes.push(route) });
  return { flow, signedIn, registrations, routes, unmount: () => effects.forEach((effect) => effect?.()), exchange: (fn) => { exchange = fn; } };
}

test("workspace failure preserves the issued session and its backend destination", async () => {
  const h = flowHarness(tokens, true);
  await h.flow.submit("google-id");
  assert.equal(h.signedIn.length, 1);
  assert.equal(h.signedIn[0].refresh_token, "app-refresh");
  assert.deepEqual(h.routes, ["/home"]);
});

test("Google sign-up proof never enters the signed-in state", async () => {
  const h = flowHarness(registration);
  await h.flow.submit("google-id");
  assert.equal(h.registrations[0], registration);
  assert.equal(h.signedIn.length, 0);
  assert.equal(h.routes.length, 0);
});

test("duplicate taps share one exchange and abandoned screens cannot restore a session", async () => {
  const h = flowHarness();
  let finish, calls = 0;
  h.exchange(() => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  const first = h.flow.submit("google-id");
  await h.flow.submit("google-id");
  assert.equal(calls, 1);
  h.unmount(); finish(tokens); await first;
  assert.equal(h.signedIn.length, 0);
  assert.equal(h.routes.length, 0);
});

test("refused Google credentials do not erase an existing session and allow retry", async () => {
  const h = flowHarness();
  h.exchange(async () => { throw new Error("expired Google token"); });
  await h.flow.submit("expired");
  assert.equal(h.signedIn.length, 0);
  h.exchange(async () => tokens);
  await h.flow.submit("fresh");
  assert.equal(h.signedIn.length, 1);
});

test("build configuration exports public client IDs only and derives the iOS scheme", () => {
  const module = { exports: {} };
  const fs = { readFileSync: () => 'GOOGLE_OAUTH_CLIENT_ID=server.apps.googleusercontent.com\nEXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=ios.apps.googleusercontent.com\nSECRET_KEY=private-secret' };
  vm.runInNewContext(read("../app.config.js"), {
    module, __dirname: "/mobile", process: { env: {} },
    require: (name) => name === "node:fs" ? fs : name === "expo/config-plugins"
      ? { withAppBuildGradle: (config) => config } : require(name),
  });
  const config = module.exports({ config: { extra: {}, plugins: [] } });
  assert.equal(config.extra.googleSignIn.webClientId, "server.apps.googleusercontent.com");
  assert.equal(config.extra.googleSignIn.iosClientId, "ios.apps.googleusercontent.com");
  assert.equal(config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "react-native-nitro-google-signin")[1].iosUrlScheme, "com.googleusercontent.apps.ios");
  assert.ok(!JSON.stringify(config).includes("private-secret"));
});
