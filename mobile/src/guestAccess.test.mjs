import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./navigation.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { appAccessRedirect, isPublicDiscovery } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("guests can browse Explore, search and public details through the same route policy", () => {
  for (const segments of [["(app)", "(tabs)", "explore"], ["(app)", "search"], ["(app)", "listing", "[id]"], ["(app)", "sale", "[id]"]]) {
    assert.equal(isPublicDiscovery(segments), true);
    assert.equal(appAccessRedirect(null, segments), null);
  }
});

test("applications, viewings, private tabs and provider operations stay protected", () => {
  for (const segments of [["(app)", "apply", "[id]"], ["(app)", "viewings"], ["(app)", "(tabs)", "payments"], ["(app)", "(provider-tabs)", "properties"]]) {
    assert.equal(isPublicDiscovery(segments), false);
    assert.equal(appAccessRedirect(null, segments), "/(auth)/sign-in");
  }
});

test("dismissing the guest sign-in sheet keeps the listing mounted and never navigates", () => {
  let next = null;
  const pushes = [];
  const jsx = (type, props) => ({ type, props });
  const imports = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      createContext: () => ({ Provider: "Provider" }), useCallback: (callback) => callback,
      useState: () => [next, (value) => { next = value; }],
    },
    "expo-router": { usePathname: () => "/listing/123", useRouter: () => ({ push: (value) => pushes.push(value) }) },
    "react-native": { View: "View" },
    "@/components/sheet/BottomSheet": { BottomSheet: "Sheet" },
    "@/components/ui": { Button: "Button", Type: "Type", space: { 4: 16 } },
  };
  const exports = {};
  const component = readFileSync(new URL("./components/auth/GuestSignIn.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(component, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: (name) => imports[name] });
  const listing = { id: "listing-123", scroll: 230 };
  let tree = exports.GuestSignInProvider({ children: listing });
  tree.props.value("/(app)/apply/123");
  tree = exports.GuestSignInProvider({ children: listing });
  const sheet = tree.props.children[1];
  assert.equal(sheet.props.visible, true);
  sheet.props.onClose();
  tree = exports.GuestSignInProvider({ children: listing });
  assert.equal(tree.props.children[1].props.visible, false);
  assert.equal(tree.props.children[0], listing);
  assert.equal(pushes.length, 0);
});
