import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("./management.tsx", import.meta.url), "utf8");

function harness(fetchImplementation) {
  const exports = {};
  const requests = [];
  const storage = new Map();
  const successfulFetch = async (url, init) => {
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
  const fetch = fetchImplementation ?? successfulFetch;
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
      AbortController,
      clearTimeout,
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
  assert.match(source, /managementFetch<\{ user: ManagementUser \}>\(\s*"\/auth\/session\/"/);
  assert.match(source, /useEffect\(\(\) => \{\s*void refresh\(\);\s*\}, \[refresh\]\)/);
  assert.doesNotMatch(source, /\/auth\/refresh\//);
});

test("a stalled management request fails with a bounded timeout", async () => {
  const h = harness((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  }));

  await assert.rejects(
    h.api.managementFetch("/auth/session/", { timeoutMs: 5 }),
    (error) => error.code === "request_timeout",
  );
});

test("the login screen renders before session restoration completes", () => {
  const shell = readFileSync(
    new URL("../components/management/ManagementShell.tsx", import.meta.url),
    "utf8",
  );
  const loginGate = shell.indexOf('if (loginPage && state.status !== "signed_in") return children;');
  const loadingGate = shell.indexOf('if (state.status === "loading")');

  assert.notEqual(loginGate, -1);
  assert.ok(loginGate < loadingGate);
});

test("an older session probe cannot overwrite a newer login", () => {
  assert.match(source, /const authRevision = useRef\(0\);/);
  assert.match(source, /const revision = \+\+authRevision\.current;/);
  assert.match(source, /if \(authRevision\.current === revision\) \{\s*setState\(\{ status: "signed_in"/);
  assert.match(source, /if \(authRevision\.current !== revision\) return;/);
});
