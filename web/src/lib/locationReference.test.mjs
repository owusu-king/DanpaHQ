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
test("web autocomplete uses only bounded database lookup with cancellation", async () => {
  const controller = new AbortController();
  await exports.searchLocations(" Kanda & Osu ", controller.signal);
  assert.equal(sent.path, "/geo/locations/?q=Kanda%20%26%20Osu&limit=12");
  assert.equal(sent.options.signal, controller.signal);
  assert.equal(sent.options.maxAttempts, 1);
});
test("unknown and invalid reference coordinates never become map targets", () => {
  assert.equal(exports.referenceArea({ latitude: null, longitude: "0" }), null);
  assert.equal(exports.referenceArea({ latitude: "NaN", longitude: "0" }), null);
  assert.equal(exports.referenceArea({ latitude: "6.7", longitude: "-1.62" }).lat, 6.7);
});
test("manual location remains an explicit option and area navigation leaves the pin alone", () => {
  const picker = readFileSync(new URL("../components/property/PropertyWizard.tsx", import.meta.url), "utf8");
  assert.match(picker, /locality_id: location\.id/);
  assert.match(picker, /place_name: query\.trim\(\)/);
  const callback = picker.slice(picker.indexOf("onShowArea="), picker.indexOf("onShowArea=") + 200);
  assert.match(callback, /setAreaFocus/);
  assert.doesNotMatch(callback, /setPin/);
  const input = readFileSync(new URL("../components/property/LocationAutocomplete.tsx", import.meta.url), "utf8");
  assert.match(input, /unverified location/);
  assert.match(input, /controller\.abort\(\)/);
});


test("selecting a locality places its marker and unknown coordinates clear the previous marker", () => {
  const picker = readFileSync(new URL("../components/property/PropertyWizard.tsx", import.meta.url), "utf8");
  const body = picker.match(/onSelect=\{\(row\) => \{([\s\S]*?)\n[ \t]*\}\}/)[1];
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
