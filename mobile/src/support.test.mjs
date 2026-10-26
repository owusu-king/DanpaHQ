import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
function compile(file, imports, globals = {}) {
  const exports = {};
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: (name) => {
    assert.ok(name in imports, `Unexpected dependency ${name}`);
    return imports[name];
  }, ...globals });
  return exports;
}

test("support creation and replies reach the transport as JSON objects, encoded once", async () => {
  const requests = [];
  const api = compile("./api.ts", {
    "expo-constants": { __esModule: true, default: { expoConfig: {} } },
    "react-native": { Platform: { OS: "android" } },
  }, {
    __DEV__: false, process: { env: { EXPO_PUBLIC_API_URL: "https://api.example.test/api/v1" } },
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (url, init) => {
      const payload = JSON.parse(init.body);
      assert.equal(typeof payload, "object");
      requests.push({ url, payload, authorization: init.headers.Authorization });
      return { ok: true, status: 201, json: async () => ({ id: "ticket", messages: [] }) };
    },
  });
  api.setAuthTokenProvider(async () => "test-session");
  const support = compile("./support.ts", { "@/api": api });
  await support.createSupportCase({ category: "payment", summary: "Pending payment", message: "Please check my payment." });
  await support.replyToSupportCase("ticket", "Here is the reference.");
  assert.deepEqual(requests, [
    { url: "https://api.example.test/api/v1/me/support-cases/", authorization: "Bearer test-session",
      payload: { category: "payment", summary: "Pending payment", message: "Please check my payment." } },
    { url: "https://api.example.test/api/v1/me/support-cases/ticket/", authorization: "Bearer test-session",
      payload: { message: "Here is the reference." } },
  ]);
});
