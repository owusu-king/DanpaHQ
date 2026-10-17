import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
function compile(source, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => imports[name] ?? {}, ...globals });
  return exports;
}
const navigation = compile(read("./navigation.ts"));
const layout = read("../app/_layout.tsx");
const decision = layout.slice(layout.indexOf("const SIGNED_OUT_SCREENS"), layout.indexOf("function Shell()"));
const { entryRedirect } = compile(`${decision}\nexport { entryRedirect };`, {}, {
  resolveEntryRoute: navigation.resolveEntryRoute, accountJustCreated: () => null,
});
const me = (role, pending = false) => ({
  id: role, account_status: "active", registration_state: "complete",
  onboarding_state: "complete", contexts: [], available_contexts: [], default_context: null,
  default_context_id: null,
  capabilities: { active_workspace: role, provider: {
    workspace_access: role === "provider" && !pending,
    verification_status: pending ? "pending" : "approved", can_create_property: !pending,
  } },
  entry_routes: { mobile: role === "tenant" ? "/(app)/(tabs)" : pending ? "/(app)/provider" : "/(app)/(provider-tabs)" },
});

test("only a first installation opens welcome; returning and protected routes open Login", () => {
  assert.equal(entryRedirect({ status: "signed_out", firstVisit: true }, null, []), "/(auth)/start");
  assert.equal(entryRedirect({ status: "signed_out" }, null, []), "/(auth)/sign-in");
  assert.equal(entryRedirect({ status: "signed_out" }, null, ["(app)", "security"]), "/(auth)/sign-in");
  assert.equal(entryRedirect({ status: "signed_out" }, null, ["(auth)", "sign-in"]), null);
});

test("login and restored sessions follow backend tenant, provider and pending-provider destinations", () => {
  for (const user of [me("tenant"), me("provider"), me("provider", true)]) {
    const original = JSON.stringify(user);
    for (const route of [[], ["(auth)", "sign-in"]]) {
      assert.equal(entryRedirect({ status: "signed_in", me: user }, "discovery", route), user.entry_routes.mobile);
    }
    assert.equal(JSON.stringify(user), original);
  }
});

function authHarness() {
  const store = new Map();
  const states = [];
  const routes = [];
  let request = async () => { throw new Error("Unexpected API request"); };
  let tokenProvider;
  const react = {
    createContext: () => ({ Provider: "provider" }), useContext: () => null,
    useState: (value) => [value, (next) => states.push(next)],
    useRef: (current) => ({ current }), useCallback: (fn) => fn, useMemo: (fn) => fn(),
    useEffect: (fn) => { if (!tokenProvider) fn(); },
  };
  const auth = compile(read("./auth.tsx"), {
    react, "react/jsx-runtime": { jsx: (_, props) => props.value },
    "expo-router": { useRouter: () => ({ canDismiss: () => true, dismissAll: () => routes.push("reset"), replace: (route) => routes.push(route) }) },
    "@/api": { apiFetch: (...args) => request(...args), ApiFailure: class extends Error {}, setAuthTokenProvider: (fn) => { tokenProvider = fn; } },
    "@/secure": { secure: { get: async (k) => store.get(k) ?? null, set: async (k, v) => store.set(k, v), clear: async (k) => store.delete(k) } },
    "@/photo": { forgetPhotoUrls() {} }, "@/navigation": navigation,
    "@/onboardingIntent": { clearPendingOnboardingIntent: async () => {} },
    "@/registrationDraft": { clearRegistrationDraft() {}, finishAccountWelcome() {} },
    "@/serviceAccounts": { clearServiceDetails: async () => store.delete("danpahq.service.details.v1") },
    "@/privateDocuments": { clearPrivateDocuments() {} },
  });
  return { api: auth.AuthProvider({ children: null }), store, states, routes,
    request: (fn) => { request = fn; }, token: (...args) => tokenProvider(...args) };
}

test("logout clears credentials and cached account data, then login retains pending verification", async () => {
  const h = authHarness();
  h.request(async () => null);
  const user = me("provider", true);
  const tokens = { access_token: "access", refresh_token: "refresh", user };
  await h.api.signIn(tokens);
  h.store.set("danpahq.service.details.v1", "private meter");
  await h.api.signOut();
  assert.equal(h.store.size, 0);
  assert.equal(h.states.at(-1).status, "signed_out");
  assert.deepEqual(h.routes, ["reset", "/(auth)/sign-in"]);
  await h.api.signIn(tokens);
  assert.equal(h.states.at(-1).me, user);
  assert.equal(user.capabilities.provider.verification_status, "pending");
});

test("a late /me response cannot restore a signed-out session", async () => {
  const h = authHarness();
  const user = me("tenant");
  await h.api.signIn({ access_token: "a", refresh_token: "r", user });
  let finish;
  h.request((path) => path === "/me/" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(null));
  const reading = h.api.refreshMe();
  await h.api.signOut();
  finish(user);
  await reading;
  assert.equal(h.states.at(-1).status, "signed_out");
  assert.equal(h.store.size, 0);
});

test("a refresh finishing during logout cannot republish credentials", async () => {
  const h = authHarness();
  await h.api.signIn({ access_token: "a", refresh_token: "r", user: me("tenant") });
  let finish;
  h.request((path) => path === "/auth/refresh/" ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(null));
  const refreshing = h.token(true);
  await new Promise(setImmediate);
  const leaving = h.api.signOut();
  finish({ access_token: "late", refresh_token: "late", expires_in: 900 });
  await Promise.all([refreshing, leaving]);
  assert.equal(await h.token(), null);
  assert.equal(h.store.size, 0);
});
