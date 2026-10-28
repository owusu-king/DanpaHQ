import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/(app)/(provider-tabs)/more.tsx", import.meta.url), "utf8");
const body = source.match(/async function switchTo\([\s\S]*?\) \{([\s\S]*?)\n  \}/)[1];
const compiled = ts.transpileModule(`async function switchTo(workspace: string, confirmation?: string) {${body}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup(existing = false) {
  const requests = [], prompts = [], routes = [];
  const switchTo = new Function("me", "setRentText", "setError", "setRentConfirmation", "setSwitching", "chooseWorkspace", "refreshMe", "router", "resolveEntryRoute", "ApiFailure", compiled + "; return switchTo;")(
    { capabilities: { tenant: { workspace_access: existing } } },
    () => {}, () => {}, value => prompts.push(value), () => {},
    async (...args) => { requests.push(args); return {}; }, async () => {},
    { replace: route => routes.push(route) }, () => "/renting", class extends Error {},
  );
  return { switchTo, requests, prompts, routes };
}

test("mobile never creates tenant standing before the exact acknowledgement", async () => {
  for (const value of [undefined, "", "rent account", "Rent Account", "Rent account "]) {
    const flow = setup();
    await flow.switchTo("tenant", value);
    assert.deepEqual(flow.requests, []);
    assert.deepEqual(flow.routes, []);
    assert.deepEqual(flow.prompts, [true]);
  }
});

test("mobile sends the explicit confirmation and refreshes before navigation", async () => {
  const flow = setup();
  await flow.switchTo("tenant", "Rent account");
  assert.deepEqual(flow.requests, [["tenant", undefined, "Rent account"]]);
  assert.deepEqual(flow.routes, ["/renting"]);
});

test("switching to an existing renting account needs no creation dialogue", async () => {
  const flow = setup(true);
  await flow.switchTo("tenant");
  assert.deepEqual(flow.requests, [["tenant", undefined, undefined]]);
  assert.deepEqual(flow.prompts, [false]);
});
