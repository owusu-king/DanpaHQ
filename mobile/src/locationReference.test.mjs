import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./locations.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
let sent;
const exports = {};
vm.runInNewContext(code, { exports, require: () => ({ apiFetch: (path, options) => { sent = { path, options }; return Promise.resolve({ results: [] }); } }) });
test("mobile location lookup is bounded, anonymous and cancellable through our API", async () => {
  const controller = new AbortController();
  await exports.searchLocations("  Kumase  ", controller.signal);
  assert.equal(sent.path, "/geo/locations/?q=Kumase&limit=12");
  assert.equal(sent.options.anonymous, true);
  assert.equal(sent.options.signal, controller.signal);
  assert.equal(sent.options.maxAttempts, 1);
});
test("an area target requires real numeric coordinates and never supplies a property pin", () => {
  assert.equal(exports.referenceArea({ latitude: null, longitude: "0" }), null);
  assert.equal(exports.referenceArea({ latitude: "NaN", longitude: "0" }), null);
  assert.equal(exports.referenceArea({ latitude: "91", longitude: "0" }), null);
  const area = exports.referenceArea({ latitude: "6.7", longitude: "-1.62" });
  assert.equal(area.lat, 6.7);
  assert.ok(area.bounds.west < area.lng && area.bounds.east > area.lng);
  const picker = readFileSync(new URL("./components/property/PropertyWizard.tsx", import.meta.url), "utf8");
  const callback = picker.slice(picker.indexOf("onShowArea="), picker.indexOf("onShowArea=") + 200);
  assert.match(callback, /setAreaFocus/);
  assert.doesNotMatch(callback, /setPin/);
});


test("selecting a locality places its marker and unknown coordinates clear the previous marker", () => {
  const picker = readFileSync(new URL("./components/property/PropertyWizard.tsx", import.meta.url), "utf8");
  const body = picker.match(/onSelect=\{\(row\) => \{([\s\S]*?)\n        \}\}/)[1];
  const state = { pin: { latitude: 1, longitude: 1 } };
  const select = vm.runInNewContext(`(row) => { ${body} }`, {
    referenceArea: exports.referenceArea,
    setLocation: (value) => { state.location = value; }, setQuery: (value) => { state.query = value; },
    setCity: (value) => { state.city = value; }, setPin: (value) => { state.pin = value; },
    setAreaFocus: (value) => { state.focus = value; },
  });
  select({ id: "locality", name: "Kanda", district_name: "Accra", latitude: "5.58", longitude: "-0.2" });
  assert.equal(state.pin.latitude, 5.58);
  assert.equal(state.pin.longitude, -0.2);
  assert.equal(state.city, "Accra");
  assert.equal(state.focus, state.pin);
  select({ id: "unknown", name: "Unlocated", district_name: "", latitude: null, longitude: null });
  assert.equal(state.pin, null);
  assert.equal(state.focus, null);
});
