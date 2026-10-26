import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../components/property/AddUnitChooser.tsx", import.meta.url), "utf8");
const body = source.match(/async function start\(\) \{([\s\S]*?)\n  \}/)[1];
const compiled = ts.transpileModule(`async function start() {${body}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const start = new Function("choices", "opening", "setOpen", "router", `${compiled}; return start();`);

test("Add Unit opens its loading sheet before the property request resolves", async () => {
  let resolve;
  const request = new Promise((done) => { resolve = done; });
  const opened = [];
  const task = start({ load: () => request }, { current: 0 }, (value) => opened.push(value), { push() { throw new Error("Multiple properties require a choice"); } });
  assert.deepEqual(opened, [true]);
  resolve([{ id: "one" }, { id: "two" }]);
  await task;
  assert.deepEqual(opened, [true]);
});

test("a cancelled chooser cannot navigate when its pending request finishes", async () => {
  let resolve;
  const request = new Promise((done) => { resolve = done; });
  const opening = { current: 0 };
  const opened = [];
  const task = start({ load: () => request }, opening, (value) => opened.push(value), { push() { throw new Error("The chooser was cancelled"); } });
  opening.current += 1;
  resolve([{ id: "only-property" }]);
  await task;
  assert.deepEqual(opened, [true]);
});

test("one property still goes directly into unit creation after loading", async () => {
  const calls = [];
  await start({ load: async () => [{ id: "only-property" }] }, { current: 0 }, (value) => calls.push(value), { push: (href) => calls.push(href) });
  assert.deepEqual(calls, [true, false, "/record/space-new?propertyId=only-property"]);
});
