import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./maps/bridge.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
const { parseMapMessage, safeScriptJSON, validPoint } = await import(`data:text/javascript,${encodeURIComponent(outputText)}`);
const keys = new Set(["listing:1"]);
const parse = (value, selecting = false) => parseMapMessage(JSON.stringify(value), keys, selecting);

test("the bridge accepts only known listing markers", () => {
  assert.deepEqual(parse({ type: "marker", key: "listing:1" }), { type: "marker", key: "listing:1" });
  assert.equal(parse({ type: "marker", key: "other" }), null);
});
test("pins require explicit edit mode and valid numeric coordinates", () => {
  const pin = { type: "pin", latitude: 6.700123, longitude: -1.620456 };
  assert.equal(parse(pin), null);
  assert.deepEqual(parse(pin, true), pin);
  for (const latitude of [91, -91, "6", null]) assert.equal(parse({ ...pin, latitude }, true), null);
  assert.equal(validPoint(NaN, 0), false);
  assert.equal(validPoint(0, Infinity), false);
});
test("viewport messages require ordered bounds, finite zoom and a real gesture flag", () => {
  const move = { type: "move", bounds: { west: -2, south: 5, east: 0, north: 7 }, zoom: 12, byUser: true };
  assert.deepEqual(parse(move), move);
  assert.equal(parse({ ...move, byUser: "true" }), null);
  assert.equal(parse({ ...move, zoom: 99 }), null);
  assert.equal(parse({ ...move, bounds: { ...move.bounds, west: 2 } }), null);
});
test("malformed, oversized and command-like messages are ignored", () => {
  for (const raw of ["{", "null", "[]", "x".repeat(4097), '{"type":"execute","code":"alert(1)"}']) assert.equal(parseMapMessage(raw, keys, true), null);
  assert.deepEqual(parse({ type: "unavailable" }), { type: "unavailable" });
});
test("injected map data cannot close its script element or introduce script separators", () => {
  const original = { label: "</script><script>alert(1)</script>\u2028\u2029" };
  const encoded = safeScriptJSON(original);
  assert.equal(encoded.includes("<"), false);
  assert.equal(encoded.includes("\u2028"), false);
  assert.deepEqual(JSON.parse(encoded), original);
});
