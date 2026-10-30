import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, require) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require });
  return exports;
}
const locations = load("./locations.ts", () => ({}));
const { locationSearchArea, uniqueLocationMatch } = load("./exploreLocation.ts", () => locations);
const row = { id: "locality-1", name: "Kumasi", label: "Kumasi · Ashanti", aliases: ["Kumase"], latitude: "6.7", longitude: "-1.62" };

test("a chosen locality supplies a stable map target, without inventing missing coordinates", () => {
  const target = locationSearchArea(row);
  assert.equal(target.ref, row.id);
  assert.ok(target.bounds.west < -1.62 && target.bounds.east > -1.62);
  assert.ok(target.bounds.south < 6.7 && target.bounds.north > 6.7);
  assert.equal(locationSearchArea({ ...row, latitude: null }), null);
  assert.equal(locationSearchArea({ ...row, latitude: "NaN" }), null);
});

test("keyboard location lookup accepts exact names and aliases but never guesses between homonyms", () => {
  assert.equal(uniqueLocationMatch("  KUMASE  ", [row]), row);
  assert.equal(uniqueLocationMatch("Kum", [row]), null);
  assert.equal(uniqueLocationMatch("Kumasi", [row, { ...row, id: "locality-2" }]), null);
  assert.equal(uniqueLocationMatch("", [row]), null);
});

test("the actual search field passes the complete suggestion and handles keyboard submission and clear", () => {
  const jsx = (type, props) => ({ type, props });
  const token = new Proxy({}, { get: (_target, key) => key === Symbol.toPrimitive ? () => 8 : token });
  const { HeroSearch } = load("./components/explore/ExploreHero.tsx", (name) => ({
    "react/jsx-runtime": { jsx, jsxs: jsx }, react: { useState: () => [false, () => {}] },
    "react-native": { StyleSheet: { create: (value) => value }, View: "View", TextInput: "TextInput", Pressable: "Pressable" },
    "@/theme": { theme: token }, "@/components/ui": { space: token, radius: token },
    "@/shell": { alpha: () => "white" }, "@/platform": { pressableFeedback: () => ({}) },
    "@/components/property/LocationAutocomplete": { LocationSuggestions: "Suggestions" },
  })[name] ?? {});
  let selected, submitted, cleared = false;
  const tree = HeroSearch({ value: "Kumasi", onChangeText: () => assert.fail("Coordinates must not be reduced to text"), onClear: () => { cleared = true; }, onSelectLocation: (value) => { selected = value; }, onSubmit: (value) => { submitted = value; } });
  const suggestions = tree.props.children.at(-1);
  suggestions.props.onSelect(row);
  assert.equal(selected, row);
  const field = tree.props.children[1];
  field.props.children[1].props.onSubmitEditing();
  assert.equal(submitted, "Kumasi");
  field.props.children[2].props.onPress();
  assert.equal(cleared, true);
});
