import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function client(fetch) {
  const source = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, fetch, AbortController, setTimeout, clearTimeout, URL, __DEV__: true,
    process: { env: { EXPO_PUBLIC_API_URL: "http://localhost:8000/api/v1" } },
    require: (name) => name === "expo-constants" ? { default: { expoConfig: {} } } : { Platform: { OS: "web" } },
  });
  return exports.apiFetch;
}
test("cancelling an in-flight mobile lookup aborts fetch and never retries", async () => {
  let calls = 0;
  const apiFetch = client((_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  });
  const controller = new AbortController();
  const pending = apiFetch("/geo/locations/?q=Kumasi", { anonymous: true, signal: controller.signal, maxAttempts: 3 });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1);
});
test("an already-cancelled mobile lookup never sends a request", async () => {
  let calls = 0;
  const apiFetch = client(() => { calls++; });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(apiFetch("/geo/locations/", { anonymous: true, signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 0);
});
