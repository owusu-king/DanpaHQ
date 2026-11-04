import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../components/property/AddUnitChooser.tsx", import.meta.url), "utf8");
const body = source.match(/async function start\(\) \{([\s\S]*?)\n  \}/)[1];
const compiled = ts.transpileModule(`async function start() {${body}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const start = new Function("choices", "opening", "setOpen", "setSelectedProperty", "initialProperty", `${compiled}; return start();`);

test("Add Unit opens its loading sheet before the property request resolves", async () => {
  let resolve;
  const request = new Promise((done) => { resolve = done; });
  const opened = [];
  const task = start({ load: () => request }, { current: 0 }, (value) => opened.push(value), () => {}, null);
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
  const task = start({ load: () => request }, opening, (value) => opened.push(value), (id) => { if (id) throw new Error("The chooser was cancelled"); }, null);
  opening.current += 1;
  resolve([{ id: "only-property" }]);
  await task;
  assert.deepEqual(opened, [true]);
});

test("one property still goes directly into unit creation after loading", async () => {
  const calls = [];
  await start({ load: async () => [{ id: "only-property" }] }, { current: 0 }, (value) => calls.push(value), (id) => calls.push(id), null);
  assert.deepEqual(calls, [null, true, "only-property"]);
});


test("a Property Details entry preselects its Property without loading a chooser", async () => {
  const selected = [], opened = [];
  await start({ load() { throw new Error("Known property needs no picker"); } }, { current: 0 }, value => opened.push(value), value => selected.push(value), "known-property");
  assert.deepEqual(selected, ["known-property"]);
  assert.deepEqual(opened, [true]);
});


test("zero or multiple eligible Properties keep the chooser open without selecting one", async () => {
  for (const properties of [[], [{ id: "a" }, { id: "b" }]]) {
    const selected = [], opened = [];
    await start({ load: async () => properties }, { current: 0 }, value => opened.push(value), value => selected.push(value), null);
    assert.deepEqual(selected, [null]);
    assert.deepEqual(opened, [true]);
  }
});

test("the chooser excludes sales, denied inventory and restricted billing", () => {
  const eligibility = source.match(/function eligibleOf[\s\S]*?\n\}/)[0];
  const compiled = ts.transpileModule(eligibility, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const eligible = new Function(compiled + "; return eligibleOf;")();
  const property = (id, extra = {}) => ({ id, title: id, purpose: "letting", capabilities: { private_inventory: { allowed: true } }, ...extra });
  const rows = [property("b"), property("a", { billing_access: { state: "full" } }), property("sale", { purpose: "sale" }), property("denied", { capabilities: {} }), property("read-only", { billing_access: { state: "read_only" } }), property("wind-down", { billing_access: { state: "wind_down" } })];
  assert.deepEqual(eligible(rows).map(row => row.id), ["a", "b"]);
});


test("dismissing Add Unit invalidates pending selection without refreshing data", () => {
  const body = source.match(/const close = \(\) => \{([\s\S]*?)\n  \};/)[1];
  const close = new Function("opening", "setOpen", "onChanged", body);
  const opening = { current: 3 }, states = [];
  close(opening, value => states.push(value), () => { throw new Error("Dismissal must not reload"); });
  assert.equal(opening.current, 4);
  assert.deepEqual(states, [false]);
});

test("unit save notification follows successful commit, not a failed validation", async () => {
  const unitSource = readFileSync(new URL("../components/property/UnitWizard.tsx", import.meta.url), "utf8");
  const advanceSource = unitSource.match(/async function advance\(\) \{([\s\S]*?)\n  \}/)[1];
  const output = ts.transpileModule('async function advance() {' + advanceSource + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const valid of [false, true]) {
    const calls = [];
    const advance = new Function("mediaBusy", "setBusy", "setError", "commitRef", "onChanged", "reload", "step", "STEPS", "at", "go", output + '; return advance;')(
      false, () => {}, message => { if (message) throw new Error(message); },
      { current: async () => { calls.push("commit"); return valid; } },
      () => calls.push("changed"), async () => { calls.push("reload"); return {}; },
      "details", [{ key: "details" }, { key: "amenities" }], 0, key => calls.push(key),
    );
    await advance();
    assert.deepEqual(calls, valid ? ["commit", "changed", "reload", "amenities"] : ["commit"]);
  }
});


test("opening a verification step reports its state without notifying a save", async () => {
  const panel = readFileSync(new URL("../components/property/VerificationPanel.tsx", import.meta.url), "utf8");
  const body = panel.match(/const load = useCallback\(async \(\) => \{([\s\S]*?)\n  \},/)[1];
  const calls = [];
  const load = new Function("getVerification", "subject", "id", "setState", "report", "onChanged", "setError", "ApiFailure", 'return async function() {' + body + '};')(
    async () => ({ status: "draft" }), "property", "p", () => calls.push("state"),
    { current: () => calls.push("reported") }, () => calls.push("changed"),
    error => { throw new Error(error); }, class extends Error {},
  );
  await load();
  assert.deepEqual(calls, ["state", "reported"]);
});
