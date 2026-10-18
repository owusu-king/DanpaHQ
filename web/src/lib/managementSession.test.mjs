import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("./management.tsx", import.meta.url), "utf8");

function harness() {
  const exports = {};
  const requests = [];
  const storage = new Map();
  const fetch = async (url, init) => {
    requests.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        user: { id: "manager", capabilities: ["view_dashboard"] },
        csrf_token: "restored-csrf",
      }),
    };
  };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    {
      exports,
      fetch,
      crypto: { randomUUID: () => "request-id" },
      setTimeout,
      window: {
        sessionStorage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
          removeItem: (key) => storage.delete(key),
        },
      },
      require: (name) => {
        if (name === "react" || name === "react/jsx-runtime") return require(name);
        if (name === "@/lib/apiBase") return { API_BASE_URL: "https://api.example.test/api/v1" };
        throw new Error(`unexpected import: ${name}`);
      },
    },
  );
  return { api: exports, requests, storage };
}

test("management session restoration keeps its isolated credentialed endpoint", async () => {
  const h = harness();
  const response = await h.api.managementFetch("/auth/session/");

  assert.equal(response.user.id, "manager");
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, "https://api.example.test/api/v1/management/auth/session/");
  assert.equal(h.requests[0].init.credentials, "include");
  assert.equal(h.requests[0].init.headers["X-Client"], "management");
  assert.equal(h.storage.get("management.csrf"), "restored-csrf");
});

test("management reload initialization does not use consumer refresh", () => {
  assert.match(source, /managementFetch<\{ user: ManagementUser \}>\("\/auth\/session\/"\)/);
  assert.match(source, /useEffect\(\(\) => \{\s*void refresh\(\);\s*\}, \[refresh\]\)/);
  assert.doesNotMatch(source, /\/auth\/refresh\//);
});
