/**
 * Explore's Filters panel on the web, asked in as little of the panel as it needs.
 *
 * It was a form: two labelled rent boxes, a chip for every property and unit
 * type — eleven for units — bedrooms and advance as more chips, and the order in
 * a fourth group, each under its own heading. It reached the bottom of a laptop
 * screen before anything was chosen. It now asks what the phone asks, the way the
 * phone asks it, with the rows paired two to a line where the panel has the room.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8").replaceAll("\r\n", "\n");
/** Source without its comments, so a comment naming a thing is never taken for its use. */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fields = () => code(read("web/src/components/explore/FilterFields.tsx"));
const css = () => code(read("web/src/styles/explore-workspace.css"));
const panel = () => {
  const browser = code(read("web/src/components/listings/ListingBrowser.tsx"));
  const start = browser.indexOf('<div className="explore-advanced-body">');
  assert.notEqual(start, -1, "the panel body is missing");
  return browser.slice(start, browser.indexOf('<div className="explore-advanced-actions">', start));
};
/** The first rule written for exactly this selector. */
const rule = (source, selector) => {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} is missing`);
  return source.slice(start, source.indexOf("}", start));
};

test("the panel asks in one compact grid: a rent range, dropdowns, a segmented choice and a switch", () => {
  const body = panel();

  assert.equal((body.match(/<RentRange\b/g) ?? []).length, 1);
  for (const [name, label] of [
    ["explore-property-type", "Property type"],
    ["explore-space-type", "Unit type"],
    ["explore-advance", "Maximum advance"],
    ["explore-sort", "Sort by"],
  ]) {
    assert.match(body, new RegExp(`<FilterSelect\\s+name="${name}"\\s+label="${label}"`), `${label} is not a dropdown`);
  }
  assert.match(body, /<SegmentedChoice\s+name="explore-bedrooms"\s+label="Bedrooms"/);
  assert.match(body, /<Switch checked=\{query\.furnished\}/);

  // The phone's order, paired two to a line: rent across the top, then the rest.
  const marks = ["<RentRange", 'label="Property type"', 'label="Unit type"', 'label="Bedrooms"', 'label="Maximum advance"', "Furnished only", 'label="Sort by"'];
  const order = marks.map((mark) => body.indexOf(mark));
  assert.ok(order.every((at) => at >= 0), "a row is missing");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "the rows are out of the phone's order");

  // No chips, no rent boxes, no group headings.
  assert.doesNotMatch(body, /<ChoiceSet|<Field\b|<h3|explore-filter-group|explore-choice/);

  const styles = css();
  assert.match(rule(styles, ".explore-filter-grid"), /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 17rem\), 1fr\)\);/);
  assert.match(rule(styles, ".explore-advanced"), /width: min\(calc\(100% - var\(--space-4\) \* 2\), 40rem\);/);
  assert.match(rule(styles, ".explore-filter-cell"), /min-height: 56px;/);
});

test("rent is one range over the phone's own stops", () => {
  const query = code(read("web/src/lib/exploreQuery.ts"));
  const phone = code(read("mobile/src/components/filters/FilterFields.tsx"));
  const stops = (source) => source.match(/RENT_STOPS = \[([\d, ]+)\]/)[1].split(",").map((value) => Number(value.trim()));
  assert.deepEqual(stops(query), stops(phone), "the web and the phone draw different tracks");

  // Either end of the track is no limit, and the readout says what the range means.
  assert.match(query, /export function rentAtStop\(index: number, edge: number\): string \{\s*return index === edge \? "" : String\(RENT_STOPS\[index\] \?\? 0\);/);
  assert.match(query, /return "Any price";/);
  assert.match(query, /return `From \$\{cedis\(minimum\)\}`;/);
  assert.match(query, /return `Up to \$\{cedis\(maximum\)\}`;/);

  const range = fields();
  // Two real range inputs: each thumb is announced, stepped and dragged natively.
  assert.equal((range.match(/type="range"/g) ?? []).length, 2);
  assert.match(range, /aria-label="Minimum rent"/);
  assert.match(range, /aria-label="Maximum rent"/);
  // The thumbs never cross.
  assert.match(range, /Math\.min\(Number\(event\.target\.value\), high - 1\)/);
  assert.match(range, /Math\.max\(Number\(event\.target\.value\), low \+ 1\)/);
  // Past halfway the minimum sits over the maximum, so two thumbs at one end never trap each other.
  assert.match(range, /low > RENT_LAST \/ 2 \? " is-front" : ""/);

  // Only a thumb takes the pointer, so either can be dragged wherever the other sits.
  const styles = css();
  assert.match(rule(styles, ".explore-range-input"), /pointer-events: none;/);
  assert.match(rule(styles, ".explore-range-input::-webkit-slider-thumb"), /pointer-events: auto;/);
  assert.match(rule(styles, ".explore-range-input::-moz-range-thumb"), /pointer-events: auto;/);

  // The search takes the range once the dragging settles, not at every stop.
  const browser = read("web/src/components/listings/ListingBrowser.tsx");
  assert.match(browser, /onChange=\{\(minimum, maximum\) => \{ setRentMinDraft\(minimum\); setRentMaxDraft\(maximum\); \}\}/);
  assert.match(browser, /setTimeout\(\(\) => update\(\{ rentMin: rentMinDraft, rentMax: rentMaxDraft \}\), 350\)/);
});

test("a dropdown is a real listbox the keyboard can walk, and it floats clear of the panel", () => {
  const select = fields();

  assert.match(select, /role="combobox"/);
  assert.match(select, /aria-haspopup="listbox"/);
  assert.match(select, /aria-expanded=\{open\}/);
  assert.match(select, /aria-activedescendant=\{open \? optionId\(active\) : undefined\}/);
  assert.match(select, /role="listbox"/);
  assert.match(select, /role="option"\s+aria-selected=\{at === chosenIndex\}/);
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"]) {
    assert.match(select, new RegExp(`event\\.key === "${key}"`), `${key} does nothing`);
  }
  // Escape puts the list away and leaves the panel it sits in open.
  assert.match(select, /event\.key === "Escape"\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*setOpen\(false\);/);
  // React listens on the document, beside the panel's own Escape, so the panel
  // leaves a key a list inside it has already used.
  assert.match(read("web/src/components/listings/ListingBrowser.tsx"), /if \(event\.key !== "Escape" \|\| event\.defaultPrevented\) return;/);
  // A click made by Enter or Space is the keys' to handle, so a key never opens and closes it at once.
  assert.match(select, /if \(event\.detail === 0\) return;/);
  // Below its button when it fits, above when there is more room there.
  assert.match(select, /const downward = below >= wanted \|\| below >= above;/);
  // A press elsewhere, a scroll of anything but the list, or a resize puts it away.
  assert.match(select, /if \(!field\.current\?\.contains\(event\.target as Node\)\) setOpen\(false\);/);
  assert.match(select, /if \(event\.target !== list\.current\) setOpen\(false\);/);
  // Fixed to the window, so the panel's own scroll never clips it.
  assert.match(rule(css(), ".explore-select-list"), /position: fixed;/);
  // Never the operating system's list.
  assert.doesNotMatch(select, /<select\s|<Select\s/);
});

test("choosing changes colour, never size", () => {
  const styles = css();

  assert.match(rule(styles, ".explore-segment"), /border: var\(--border-hairline\) solid transparent;/);
  assert.match(rule(styles, ".explore-segment:has(.control-input:checked)"), /border-color: var\(--color-kola-600\);/);
  assert.match(rule(styles, ".explore-select-button"), /border: var\(--border-hairline\) solid var\(--color-field-300\);/);
  assert.match(rule(styles, ".explore-select-button.is-chosen"), /background: var\(--color-kola-50\);/);
  for (const selector of [
    ".explore-segment:has(.control-input:checked)",
    ".explore-select-button.is-chosen",
    ".explore-select.is-open .explore-select-button",
  ]) {
    assert.doesNotMatch(rule(styles, selector), /border-width|border: |padding|min-height/, `${selector} changes size`);
  }
  // The segments are real radios under one name, so the arrow keys move between them.
  assert.match(fields(), /<input type="radio" name=\{name\} value=\{key\} checked=\{value === key\}/);
});

test("every row is a comfortable target, under a cursor and under a thumb", () => {
  const styles = css();

  assert.match(rule(styles, ".explore-select-button"), /min-height: 40px;/);
  assert.match(rule(styles, ".explore-range-track"), /--explore-thumb: 24px;/);
  assert.match(styles, /@media \(pointer: coarse\) \{[\s\S]*?\.explore-select-button, \.explore-segment \{ min-height: 44px; \}/);
  assert.match(styles, /@media \(pointer: coarse\) \{[\s\S]*?\.explore-range-track \{ --explore-thumb: 28px; --explore-track: 44px; \}/);
});
