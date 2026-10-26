import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import ts from "typescript";

const source = readFileSync(new URL("./apiBase.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function resolve(configured) {
  const exports = {};
  const context = {
    exports,
    process: { env: { NODE_ENV: "production", NEXT_PUBLIC_API_URL: configured } },
    URL,
  };
  runInNewContext(compiled, context, { filename: fileURLToPath(new URL("./apiBase.ts", import.meta.url)) });
  return exports.API_BASE_URL;
}

test("production web API URL must target the versioned API", () => {
  assert.equal(resolve("https://api.oskec.com/api/v1"), "https://api.oskec.com/api/v1");
  assert.throws(() => resolve("https://api.oskec.com"), /ending in \/api\/v1/);
  assert.throws(() => resolve("https://api.oskec.com/api/v1?debug=1"), /ending in \/api\/v1/);
  assert.throws(() => resolve("http://api.oskec.com/api/v1"), /must be https/);
});
