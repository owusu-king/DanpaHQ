import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const nativeModule = new URL("./messagePush.native.ts", import.meta.url);
const source = readFileSync(nativeModule, "utf8");
const thread = "01234567-89ab-cdef-0123-456789abcdef";
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("Expo Metro selects native push on Android and iOS and the fallback on web", () => {
  const { resolve } = require("metro-resolver");
  const { getDefaultConfig } = require("expo/metro-config");
  const { sourceExts, assetExts } = getDefaultConfig(fileURLToPath(new URL("../", import.meta.url))).resolver;
  const context = {
    originModulePath: fileURLToPath(import.meta.url),
    sourceExts,
    assetExts: new Set(assetExts),
    getPackageForModule: () => null,
    fileSystemLookup(path) {
      const stat = statSync(path, { throwIfNoEntry: false });
      if (!stat) return { exists: false };
      return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: path };
    },
  };

  for (const platform of ["android", "ios", "web"]) {
    const isNative = platform !== "web";
    const expected = isNative ? nativeModule : new URL("./messagePush.ts", import.meta.url);
    const result = resolve({ ...context, preferNativePlatform: isNative }, "./messagePush", platform);
    assert.equal(result.filePath, fileURLToPath(expected), platform);
  }
});

function harness({
  enabled = true, granted = true, askGrants = true, expoGo = false, physical = true,
  platform = "android",
} = {}) {
  const calls = [];
  const effects = [];
  const listeners = {};
  const routes = [];
  const sdk = {
    AndroidImportance: { HIGH: 4 }, AndroidNotificationVisibility: { PRIVATE: 0 },
    DEFAULT_ACTION_IDENTIFIER: "tap",
    setNotificationChannelAsync: async () => calls.push("channel"),
    getPermissionsAsync: async () => ({ granted, canAskAgain: true }),
    requestPermissionsAsync: async () => { calls.push("permission"); return { granted: askGrants }; },
    getDevicePushTokenAsync: async () => {
      calls.push("read-native-token");
      return { data: "installation:phone" };
    },
    setNotificationHandler: (handler) => { listeners.foreground = handler.handleNotification; },
    addNotificationResponseReceivedListener: (fn) => { listeners.tap = fn; return { remove() {} }; },
    addPushTokenListener: (fn) => { listeners.token = fn; return { remove() {} }; },
    getLastNotificationResponseAsync: async () => listeners.cold ?? null,
    clearLastNotificationResponseAsync: async () => calls.push("clear-response"),
  };
  const constants = { executionEnvironment: expoGo ? "store" : "standalone",
    expoConfig: { extra: { eas: { projectId: "test-project" } } } };
  const imports = {
    "expo-constants": { __esModule: true, default: constants, ExecutionEnvironment: { StoreClient: "store" } },
    "expo-device": { isDevice: physical }, "expo-notifications": sdk,
    "react": { useEffect: (effect) => effects.push(effect), useRef: (value) => ({ current: value }) },
    "expo-router": { useRouter: () => ({ push: (route) => routes.push(route) }) },
    "react-native": { Platform: { OS: platform }, AppState: {
      addEventListener: (_event, fn) => { listeners.state = fn; return { remove() {} }; },
    } },
    "@react-native-firebase/messaging": {
      getMessaging: () => ({}),
      setAPNSToken: async (_messaging, token) => calls.push({ apns: token }),
      getToken: async () => "ios-fcm-token",
      onTokenRefresh: (_messaging, listener) => { listeners.token = listener; return () => {}; },
    },
    "@/api": { apiFetch: async (path, options) => calls.push({ path, ...options }) },
    "@/notifications": { getNotificationPreferences: async () => ({ push_enabled: enabled }) },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, console, AbortController, require: (name) => {
    assert.ok(name in imports, `Unexpected dependency ${name}`);
    return imports[name];
  } });
  return { ...exports, calls, sdk, listeners, routes, mount(userId) {
    exports.MessagePush({ userId });
    return effects.pop()();
  } };
}

test("explicit enable creates Android channel, requests permission and registers the FCM token", async () => {
  const app = harness({ granted: false });
  assert.equal(await app.registerMessagePush(true, "recipient"), true);
  assert.ok(app.calls.indexOf("channel") < app.calls.indexOf("permission"));
  assert.equal(app.calls.at(-1).path, "/me/push-token/");
  assert.equal(app.calls.at(-1).method, "PUT");
  assert.equal(app.calls.at(-1).body.token, "fcm:installation:phone");
  assert.equal(app.calls.at(-1).body.recipient_id, "recipient");
});

test("disabled preference never requests permission or registers a token", async () => {
  const app = harness({ enabled: false });
  assert.equal(await app.registerMessagePush(true), false);
  assert.equal(app.calls.length, 0);
});

test("iOS registers the FCM token after linking the APNs token", async () => {
  const app = harness({ platform: "ios" });
  assert.equal(await app.registerMessagePush(true, "recipient"), true);
  assert.equal(app.calls[1].apns, "installation:phone");
  assert.equal(app.calls[2].body.token, "fcm:ios-fcm-token");
});

test("denied or revoked OS permission removes registration without prompting on foreground", async () => {
  const app = harness({ granted: false });
  assert.equal(await app.registerMessagePush(false), false);
  assert.ok(!app.calls.includes("permission"));
  assert.equal(app.calls.at(-1).method, "DELETE");
});

test("Expo Go and simulators skip native push without breaking the inbox", async () => {
  for (const options of [{ expoGo: true }, { physical: false }]) {
    const app = harness(options);
    assert.equal(await app.registerMessagePush(true), false);
    assert.equal(app.calls.length, 0);
  }
});

function response(recipient = "recipient", target = thread) {
  return { actionIdentifier: "tap", notification: { request: { identifier: "notification", content: {
    data: { recipient_id: recipient, target_type: "sale_enquiry", target_id: target },
  } } } };
}

test("cold-start tap opens the conversation once; other accounts and malformed targets are ignored", async () => {
  for (const [recipient, target, expected] of [
    ["recipient", thread, 1], ["other-account", thread, 0], ["recipient", "https://evil.invalid", 0],
  ]) {
    const app = harness();
    app.listeners.cold = response(recipient, target);
    app.mount("recipient");
    await flush();
    assert.equal(app.routes.length, expected);
    app.listeners.tap(response(recipient, target));
    assert.equal(app.routes.length, expected);
    if (expected) {
      assert.equal(app.routes[0].pathname, "/(app)/enquiry/[id]");
      assert.equal(app.routes[0].params.id, thread);
    }
    const own = await app.listeners.foreground(response().notification);
    const other = await app.listeners.foreground(response("other").notification);
    assert.equal(own.shouldShowBanner, true);
    assert.equal(other.shouldShowBanner, false);
  }
});

test("token rotation and foreground resume refresh backend registration", async () => {
  const app = harness();
  app.mount("recipient");
  await flush();
  const before = app.calls.filter((call) => call.method === "PUT").length;
  const reads = app.calls.filter((call) => call === "read-native-token").length;
  app.listeners.token({ data: "rotated:phone" });
  await flush();
  assert.equal(app.calls.at(-1).body.token, "fcm:rotated:phone");
  assert.equal(app.calls.filter((call) => call === "read-native-token").length, reads);
  app.listeners.state("active");
  await flush();
  assert.equal(app.calls.filter((call) => call.method === "PUT").length, before + 2);
});
