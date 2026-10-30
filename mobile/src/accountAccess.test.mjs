import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(source, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: (name) => {
    assert.ok(name in imports, `Unexpected dependency ${name}`);
    return imports[name];
  }, ...globals });
  return exports;
}
const { isPublicDiscovery } = compile(read("src/navigation.ts"));
const root = read("app/_layout.tsx");
const gateSource = "export " + root.slice(root.indexOf("function entryRedirect("), root.indexOf("function Shell("));
const { entryRedirect } = compile(gateSource, {}, {
  SIGNED_OUT_SCREENS: ["start", "sign-in", "phone", "code", "register", "forgot-password"],
  BASIC_ACCOUNT_SCREENS: ["profile-edit", "security", "notification-settings", "help", "trust", "identity-verification", "provider", "artisan-application", "provider-property"],
  isPublicDiscovery, SHARED_TABS: ["payments"], accountJustCreated: () => false,
  resolveEntryRoute: (me) => me.entry_routes.mobile,
});
const signedOut = { status: "signed_out", firstVisit: true };

test("a newly registered artisan can apply without tenant access or operational screens", () => {
  const me = { registration_state: "complete", entry_routes: { mobile: "/(app)/(artisan-tabs)" }, capabilities: {
    account_type: "artisan", active_workspace: "artisan", available_workspaces: ["discovery", "artisan"],
    tenant: { workspace_access: false }, provider: { workspace_access: false },
    artisan: { status: "not_started", workspace_access: false, can_quote: false },
  } };
  const session = { status: "signed_in", me };
  assert.equal(entryRedirect(session, null, ["(app)", "artisan-application"]), null);
  for (const screen of ["artisan-job", "(tabs)", "(provider-tabs)"]) {
    assert.equal(entryRedirect(session, null, ["(app)", screen]), "/(app)/(artisan-tabs)");
  }
});
test("anonymous access includes public listing discovery and keeps private routes protected", () => {
  assert.equal(entryRedirect(signedOut, null, ["(app)", "(tabs)", "explore"]), null);
  for (const route of [
    ["(app)", "(tabs)", "index"], ["(app)", "(tabs)", "payments"],
    ["(app)", "(tabs)", "profile"], ["(app)", "(tabs)", "services"],
    ["(app)", "(provider-tabs)", "payments"],
    ["(app)", "profile-edit"], ["(app)", "artisan-job"],
  ]) assert.equal(entryRedirect(signedOut, null, route), "/(auth)/sign-in");
  assert.equal(entryRedirect(signedOut, null, ["(app)", "listing", "123"]), null);
  assert.equal(entryRedirect(signedOut, null, ["(auth)", "register"]), null);
});
for (const side of ["provider", "artisan"]) {
  const home = `/(app)/(${side}-tabs)`;
  const session = { status: "signed_in", me: { registration_state: "complete", entry_routes: { mobile: home }, capabilities: {
    active_workspace: side, available_workspaces: ["discovery", side],
    tenant: { workspace_access: false }, provider: { workspace_access: false }, artisan: { workspace_access: false },
  } } };
  test(`pending ${side} keeps its Home and basic profile access`, () => {
    assert.equal(entryRedirect(session, null, ["(app)", `(${side}-tabs)`, "index"]), null);
    assert.equal(entryRedirect(session, null, ["(app)", "profile-edit"]), null);
    assert.equal(entryRedirect(session, null, ["(app)", "(tabs)", "index"]), home);
    assert.equal(entryRedirect(session, null, ["(app)", "payment-checkout"]), home);
    assert.equal(entryRedirect(session, null, ["(app)", "artisan-job"]), home);
  });
  test(`pending ${side} never mounts operational tabs, including deep links`, () => {
    const api = compile(read(`app/(app)/(${side}-tabs)/_layout.tsx`), {
      "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
      "@/auth": { useAuth: () => ({ state: session }) },
      "@/components/auth/VerificationHome": { VerificationHome: "VerificationHome" },
      "@expo/vector-icons/Ionicons": {}, "expo-router": {}, "expo-router/unstable-native-tabs": {},
      "react-native": {}, "@/components/nav/MainTabBar": {}, "@/components/nav/NativeTabFrame": {},
      "@/components/nav/TabHeader": {}, "@/components/nav/TabHeaderControls": {},
      "@/components/portfolio/PortfolioSwitcher": {}, "@/components/AskDanpa": {},
      "@/platform": {}, "@/shell": {}, "@/theme": {},
    });
    const result = api.default();
    assert.equal(result.type, "VerificationHome");
    assert.equal(result.props.side, side);
  });
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
function explore({ query = "", loading = false, error = "" } = {}) {
  let index = 0;
  const values = [false, query, query, loading ? null : [], loading ? null : [], null, null, false, false, error];
  const { AllExplore } = compile(read("src/components/explore/AllExplore.tsx"), {
    "react/jsx-runtime": jsx,
    react: { useState: () => [values[index++], () => {}], useRef: (current) => ({ current }), useMemo: (fn) => fn(), useEffect: () => {} },
    "expo-router": { useRouter: () => ({ push: () => {} }) },
    "react-native": { View: "View", FlatList: "FlatList", RefreshControl: "RefreshControl" },
    "@/api": {}, "@/components/listings/ListingCard": {}, "@/components/sales/SaleCard": {},
    "@/components/ui": { space: {}, Type: "Type", Button: "Button" },
    "@/listings": {}, "@/sales": {}, "@/theme": { theme: { color: { field: {}, kola: {} } } },
    "./ExploreHero": { ExploreHero: "Hero", ExploreResults: "Results", HeroSearch: "Search" }, "./ExploreShow": {},
  });
  return AllExplore({ inTabs: true, bottomPadding: 0 }).props.children[1].props;
}
test("general browsing hides counts; an active search may show them", () => {
  assert.equal(explore().ListHeaderComponent.props.children[0].props.line, "Explore properties");
  assert.match(explore({ query: "Accra" }).ListHeaderComponent.props.children[0].props.line, /0 to rent/);
});
test("Explore distinguishes loading, failed requests, and an empty search", () => {
  assert.equal(explore({ loading: true }).ListEmptyComponent, null);
  assert.equal(explore({ error: "Offline" }).ListEmptyComponent, null);
  const empty = explore({ query: "Accra" }).ListEmptyComponent;
  assert.equal(empty.props.children[2].props.label, "Clear search");
});


test("the app stack refuses an unauthorized screen before mounting its navigator", () => {
  const api = compile(read("app/(app)/_layout.tsx"), {
    "react/jsx-runtime": jsx,
    "expo-router": { Redirect: "Redirect", useSegments: () => ["(app)", "(tabs)", "payments"] },
    "@/auth": { useAuth: () => ({ state: { status: "signed_out" } }) },
    "@/navigation": { appAccessRedirect: compile(read("src/navigation.ts")).appAccessRedirect },
    "@/components/nav/BackControl": {}, "@/components/nav/StackHeader": {},
    "@/platform": {}, "@/shell": {},
  });
  const result = api.default();
  assert.equal(result.type, "Redirect");
  assert.equal(result.props.href, "/(auth)/sign-in");
});

const appGuard = compile(read("src/navigation.ts")).appAccessRedirect;
test("pending accounts cannot mount pushed operations, but retain status and settings", () => {
  for (const side of ["provider", "artisan"]) {
    const me = { account_status: "active", registration_state: "complete", contexts: [],
      entry_routes: { mobile: `/(app)/(${side}-tabs)` }, capabilities: {
        active_workspace: side, tenant: { workspace_access: false },
        provider: { workspace_access: false }, artisan: { workspace_access: false },
      } };
    assert.equal(appGuard(me, ["(app)", "payment-checkout"]), me.entry_routes.mobile);
    assert.equal(appGuard(me, ["(app)", `(${side}-tabs)`, "index"]), null);
    assert.equal(appGuard(me, ["(app)", "profile-edit"]), null);
  }
});
test("restricted accounts can reach their restriction screen without a redirect loop", () => {
  const me = { account_status: "restricted" };
  assert.equal(appGuard(me, ["(app)", "restricted"]), null);
  assert.equal(appGuard(me, ["(app)", "profile-edit"]), "/(app)/restricted");
});
