import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const element = (type, props) => ({ type, props: props ?? {} });
const jsx = { jsx: element, jsxs: element, Fragment: "Fragment" };
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
function compile(path, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: (name) => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in imports, `Unexpected dependency in UI-only surface: ${name}`);
    return imports[name];
  } });
  return exports;
}
const { theme } = compile("./theme.ts", {});
const space = Object.fromEntries(Object.entries(theme.space).map(([key, value]) => [key, parseFloat(value)]));
const shell = { chrome: theme.color.kola[600], onChrome: theme.color.field[0], canvas: theme.color.field[50], dashboard: "dashboard" };
const alpha = (color, opacity) => `${color}:${opacity}`;
const native = (width = 390, fontScale = 1) => ({
  Pressable: "Pressable", Text: "Text", View: "View", Image: "Image",
  StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width, height: 844, fontScale }),
});
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (typeof tree === "string") return tree;
  return tree && typeof tree === "object" ? text(tree.props?.children) : "";
}

function askHarness(width = 390, fontScale = 1) {
  const routes = [];
  const api = compile("./components/AskDanpa.tsx", {
    "expo-router": { useRouter: () => ({ push: (route) => routes.push(route) }) },
    "react-native": native(width, fontScale),
    "react-native-svg": { __esModule: true, default: "Svg", Path: "Path" },
    "@expo/vector-icons/Ionicons": { __esModule: true, default: "Icon" },
    "@/components/ui": { space, Type: "Type" }, "@/shell": { shell, alpha }, "@/theme": { theme },
  });
  return { ...api, routes, render: (props = {}) => api.AskDanpaButton(props) };
}

test("Danpa Intel headers open a full page without mounting a modal", () => {
  const app = askHarness();
  const tree = app.render();
  const button = nodes(tree).find((node) => node.type === "Pressable");
  assert.equal(button.props.accessibilityLabel, "Danpa Intel");
  button.props.onPress();
  assert.deepEqual(app.routes, ["/(app)/enquiries"]);
  assert.equal(nodes(tree).filter((node) => ["BottomSheet", "Modal"].includes(node.type)).length, 0);
});

test("the coming-soon surface has clear future copy and no pretend composer or actions", () => {
  const app = askHarness();
  const surface = app.AskDanpaSurface();
  assert.match(text(surface), /Danpa Intel/);
  assert.match(text(surface), /Coming soon/);
  assert.match(text(surface), /future housing intelligence/);
  assert.match(text(surface), /Understand the details/);
  assert.match(text(surface), /Find the next step/);
  assert.equal(nodes(surface).filter((node) => ["TextInput", "Pressable"].includes(node.type)).length, 0);
});

test("the full page closes to its previous screen or the account workspace", () => {
  for (const hasHistory of [true, false]) {
    const calls = [];
    const page = compile("../app/(app)/enquiries.tsx", {
      "@expo/vector-icons/Ionicons": { __esModule: true, default: "Icon" },
      "expo-status-bar": { StatusBar: "StatusBar" },
      "expo-router": { useIsFocused: () => true, useRouter: () => ({ canGoBack: () => hasHistory, back: () => calls.push("back"), replace: (path) => calls.push(path), push: (path) => calls.push(path) }) },
      "react-native": { ...native(), ScrollView: "ScrollView" },
      "react-native-safe-area-context": { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 24 }) },
      "@/auth": { useAuth: () => ({ state: { status: "signed_in", me: {} }, activeContext: "portfolio" }) },
      "@/components/AskDanpa": { AskDanpaSurface: "IntelSurface" },
      "@/components/ui": { space }, "@/navigation": { resolveEntryRoute: () => "/provider-home" },
      "@/platform": { useSafeBottom: (value) => value, safeHeaderTop: (top) => top }, "@/theme": { theme },
    }).default();
    assert.equal(page.type, "SafeAreaView");
    nodes(page).find((node) => node.props.accessibilityLabel === "Close Danpa Intel").props.onPress();
    assert.deepEqual(calls, [hasHistory ? "back" : "/provider-home"]);
    nodes(page).find((node) => node.type === "IntelSurface").props.onSupport();
    assert.equal(calls.at(-1), "/(app)/support-tickets");
  }
  assert.match(read("../app/(app)/_layout.tsx"), /name="enquiries" options=\{\{ title: "Danpa Intel", headerShown: false, presentation: "card"/);
});

test("small screens and large text retain the full name and a 48-point touch target", () => {
  for (const [width, fontScale] of [[320, 1], [390, 2], [768, 1]]) {
    const app = askHarness(width, fontScale);
    const tree = app.render();
    const button = nodes(tree).find((node) => node.type === "Pressable");
    assert.equal(text(button).trim(), "Danpa Intel");
    const styles = button.props.style({ pressed: false }).filter(Boolean);
    assert.ok(styles[0].minHeight + button.props.hitSlop * 2 >= 48);
    assert.equal(nodes(button).some((node) => node.type === app.AskDanpaMark), width > 360 && fontScale <= 1.3);
  }
});

const Ask = () => null;
const Portfolio = () => null;
const headerControls = Object.fromEntries(["TenantProfileButton", "TenantHeaderActions", "ProviderHeaderActions", "ArtisanHeaderActions"].map((key) => [key, () => null]));
function frameHarness() {
  return compile("./components/nav/NativeTabFrame.tsx", {
    "react-native": native(), "@/components/nav/TabHeader": { TabHeaderRow: "TabHeaderRow" },
    "@/components/nav/TabHeaderControls": headerControls,
    "@/components/portfolio/PortfolioSwitcher": { PortfolioHeaderButton: Portfolio },
    "@/components/AskDanpa": { AskDanpaButton: Ask },
    "@/platform": { isIOS: true, NativeTabContext: { Provider: "Context" }, hapticsPolicy: {} },
    "@/shell": { shell },
  });
}

test("iOS tenant headers use Danpa Intel while Explore and Menu retain their own headers", () => {
  const frames = frameHarness();
  for (const tab of ["home", "services", "payments"]) {
    const header = frames.RenterTabFrame({ tab, children: "page" }).props.header;
    assert.equal(header.props.middle.type, Ask);
    assert.equal(header.props.left.type, headerControls.TenantProfileButton);
    assert.ok(header.props.right);
  }
  for (const tab of ["explore", "menu"]) {
    assert.equal(frames.RenterTabFrame({ tab }).props.header, null);
  }
});

test("iOS preserves the exact Portfolio control on Home and replaces it on every other standard tab", () => {
  const frames = frameHarness();
  assert.equal(frames.ProviderTabFrame({ tab: "home" }).props.header.props.left.type, Portfolio);
  for (const tab of ["properties", "tenants", "payments", "add"]) {
    assert.equal(frames.ProviderTabFrame({ tab }).props.header.props.left.type, Ask);
  }
  assert.equal(frames.ProviderTabFrame({ tab: "menu" }).props.header, null);
});

function jsTabs(path) {
  const Tabs = Object.assign(() => null, { Screen: "Screen" });
  const api = compile(path, {
    "@expo/vector-icons/Ionicons": { __esModule: true, default: "Icon" },
    "@expo/vector-icons/MaterialCommunityIcons": { __esModule: true, default: "MapIcon" },
    "expo-router": { Tabs }, "expo-router/unstable-native-tabs": { NativeTabs: {} },
    "react-native": native(320), "@/components/nav/MainTabBar": { MainTabBar: "Bar" },
    "@/components/nav/NativeTabFrame": { nativeTabHaptics: {} },
    "@/components/nav/TabHeader": { TabHeader: "TabHeader" },
    "@/components/nav/TabHeaderControls": headerControls,
    "@/components/portfolio/PortfolioSwitcher": { PortfolioHeaderButton: Portfolio },
    "@/components/AskDanpa": { AskDanpaButton: Ask },
    "@/platform": { isIOS: false }, "@/shell": { shell }, "@/theme": { theme },
  });
  return api.default().type();
}

test("Android tenant and provider navigators preserve header tools and scope Portfolio to Home", () => {
  const tenant = jsTabs("../app/(app)/(tabs)/_layout.tsx");
  assert.equal(tenant.props.screenOptions.headerTitle().type, Ask);
  assert.equal(tenant.props.screenOptions.headerLeft().type, headerControls.TenantProfileButton);
  const provider = jsTabs("../app/(app)/(provider-tabs)/_layout.tsx");
  assert.equal(provider.props.screenOptions.headerLeft().type, Ask);
  const home = nodes(provider).find((node) => node.type === "Screen" && node.props.name === "index");
  const original = home.props.options.headerLeft();
  assert.equal(original.type, Portfolio);
  assert.equal(original.props.compact, true);
  assert.equal(provider.props.screenOptions.headerRight().type, headerControls.ProviderHeaderActions);
});

test("provider record headers gain Danpa Intel without replacing back or explicit header actions", () => {
  for (const workspace of ["tenant", "provider"]) {
    const { StackHeader } = compile("./components/nav/StackHeader.tsx", {
      "expo-router/react-navigation": { getHeaderTitle: (options) => options.title },
      "react-native": native(), "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24, left: 0, right: 0 }) },
      "@/components/nav/HeaderChromeBackground": { HeaderChromeBackground: "Chrome" },
      "@/components/AskDanpa": { AskDanpaButton: Ask },
      "@/auth": { useAuth: () => ({ state: { status: "signed_in", me: { capabilities: { active_workspace: workspace } } } }) },
      "@/components/ui": { space }, "@/platform": { isAndroid: true, safeHeaderTop: (top) => top },
      "@/shell": { shell },
    });
    const options = { title: "A record", headerLeft: () => element("Back") };
    const tree = StackHeader({ options, route: { name: "record" }, back: {} });
    assert.ok(nodes(tree).some((node) => node.type === "Back"));
    assert.equal(nodes(tree).some((node) => node.type === Ask), workspace === "provider");
    const custom = StackHeader({ options: { ...options, headerRight: () => element("Custom") }, route: {}, back: {} });
    assert.ok(nodes(custom).some((node) => node.type === "Custom"));
    assert.ok(!nodes(custom).some((node) => node.type === Ask));
  }
});

test("the custom Menu keeps search and tools without an Intel entry", () => {
  const state = [];
  let cursor = 0;
  const { YouPage } = compile("./components/account/YouParts.tsx", {
    "@expo/vector-icons/Ionicons": { __esModule: true, default: "Icon" },
    "expo-router": { useIsFocused: () => false }, "expo-status-bar": { StatusBar: "StatusBar" },
    "react": { Fragment: "Fragment", useMemo: (fn) => fn(), useState: (initial) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next) => { state[index] = next; }];
    } },
    "react-native": { ...native(), ScrollView: "ScrollView", TextInput: "TextInput" },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24 }) },
    "@/components/account/IndexRows": { IndexGround: "Ground" },
    "@/components/work/WorkParts": { Empty: "Empty" },
    "@/components/ui": { Type: "Type", radius: { pill: 100 }, space },
    "@/platform": { pressableFeedback: () => ({}), safeHeaderTop: (top) => top, useSafeBottom: (base) => base },
    "@/shell": { alpha }, "@/theme": { theme },
  });
  const render = () => {
    cursor = 0;
    return YouPage({ identity: element("Identity"), sections: [],
      tools: [{ key: "edit", icon: "pencil", label: "Edit profile", onPress() {} }] });
  };
  let tree = render();
  assert.ok(!nodes(tree).some((node) => node.type === Ask));
  assert.ok(nodes(tree).some((node) => node.props.accessibilityLabel === "Edit profile"));
  nodes(tree).find((node) => node.props.accessibilityLabel === "Search settings and pages").props.onPress();
  tree = render();
  assert.ok(nodes(tree).some((node) => node.type === "TextInput"));
  const cancel = nodes(tree).find((node) => node.type === "Pressable" && text(node) === "Cancel");
  cancel.props.onPress();
  assert.ok(!nodes(render()).some((node) => node.type === Ask));
});


test("the intelligence surface offers a working support action", () => {
  let pressed = false;
  const app = askHarness();
  const rendered = app.AskDanpaSurface({ onSupport: () => { pressed = true; } });
  nodes(rendered).find((node) => node.props.accessibilityLabel === "Support Tickets").props.onPress();
  assert.equal(pressed, true);
  for (const file of ["../app/(app)/(tabs)/profile.tsx", "../app/(app)/(provider-tabs)/more.tsx"]) {
    assert.doesNotMatch(read(file), /AskDanpaButton|label: "Danpa Intel"|key: "enquiries"/);
  }
});

test("the former enquiries entry is Danpa Intel, with support isolated from sale records", () => {
  const entry = read("../app/(app)/enquiries.tsx");
  assert.match(entry, /AskDanpaSurface/);
  assert.match(entry, /support-tickets/);
  assert.doesNotMatch(entry, /listEnquiries|replyToEnquiry|PillSwitch/);
  const record = read("../app/(app)/enquiry/[id].tsx");
  assert.match(record, /getEnquiry/);
  assert.match(record, /Original enquiry note/);
  assert.doesNotMatch(record, /replyToEnquiry|TextInput|KeyboardAvoidingView/);
  assert.match(read("../app/(app)/support-tickets.tsx"), /<SupportInbox/);
});
