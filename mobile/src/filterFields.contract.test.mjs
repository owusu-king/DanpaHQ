/**
 * Explore's filters, asked in as little of the sheet as they need.
 *
 * The sheet was a wall: two labelled rent fields, every property and unit type as
 * a chip — eleven of them for units — and the order as a list of rows. It reached
 * from the home indicator to the status bar before anyone had chosen anything.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const fields = () => code(read("src/components/filters/FilterFields.tsx"));
const sheet = () => {
  const source = code(read("app/(app)/search.tsx"));
  const start = source.indexOf("function FilterSheet(");
  assert.notEqual(start, -1, "FilterSheet is missing");
  return source.slice(start, source.indexOf("\n}\n", start));
};

test("the sheet asks in seven compact rows: a range, dropdowns, a segmented choice and a switch", () => {
  const body = sheet();

  assert.equal((body.match(/<PriceRange/g) ?? []).length, 1);
  for (const label of ["Property type", "Unit type", "Maximum advance", "Sort by"]) {
    assert.match(body, new RegExp(`<SelectField\\s+label="${label}"`), `${label} is not a dropdown`);
  }
  assert.match(body, /<SegmentedField\s+label="Bedrooms"/);
  assert.match(body, /<ToggleField\s+label="Furnished only"/);

  // No rows of chips, no stacked rent inputs, no section headings.
  assert.doesNotMatch(body, /<FilterChip|<ChoiceSet|<ChoiceRow|<SheetGroup|<Field\b/);

  // The sheet design (owner, 2026-09-27, after WhatsApp's): the rows stand on
  // four white cards — cost, what it is, what it asks up front, order — with no
  // heading over any of them and no title over the sheet, and it ends with the
  // two pills every sheet shares.
  assert.match(body, /title="Filters"\s+hideTitle\s+closeLabel="Close filters"/);
  assert.equal((body.match(/<SheetCard>/g) ?? []).length, 4);
  assert.match(body, /<SheetCard>\s*<PriceRange/);
  assert.match(body, /<SheetCard>\s*<SelectField\s+label="Sort by"/);
  assert.match(body, /<SheetGlassButton label="Clear all" icon="refresh" disabled=\{!canClear\} onPress=\{onClear\} \/>/);
  assert.match(body, /<SheetPrimaryButton label=\{resultLabel\} onPress=\{onClose\} \/>/);

  // One dropdown open at a time, and none left open when the sheet comes back.
  assert.match(body, /const toggle = \(field: FilterMenu\) => setOpen\(\(current\) => \(current === field \? null : field\)\);/);
  assert.match(body, /if \(!visible\) setOpen\(null\);/);
  assert.match(body, /onPropertyTypeChange\(value\);\s*setOpen\(null\);/);
});

test("rent is one range between a minimum and a maximum", () => {
  const source = fields();

  assert.match(source, /const RENT_STOPS = \[0, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000\];/);
  // Either end of the track is no limit on that side, and the readout says so.
  assert.match(source, /const amountAt = \(index: number, edge: number\) => \(index === edge \? "" : String\(stopAt\(index\)\)\);/);
  assert.match(source, /low === 0 && high === LAST\s*\?\s*"Any price"/);

  // A thumb owns its drag, and the two never cross.
  assert.match(source, /onStartShouldSetPanResponder: \(\) => true/);
  assert.match(source, /onPanResponderTerminationRequest: \(\) => false/);
  assert.match(source, /\[Math\.min\(index, latest\[1\] - 1\), latest\[1\]\]/);
  assert.match(source, /\[latest\[0\], Math\.max\(index, latest\[0\] \+ 1\)\]/);

  // Android keeps the thumb a real view, so the list cannot intercept its drag,
  // and two thumbs at one end never trap each other.
  assert.match(source, /collapsable=\{false\}/);
  assert.match(source, /const top: Thumb = drag\?\.thumb \?\? \(low > LAST \/ 2 \? "low" : "high"\);/);
  assert.match(source, /zIndex: thumb === top \? 2 : 1/);

  // The search runs once, when the thumb is let go, not at every stop it passes.
  assert.match(source, /onPanResponderRelease: \(\) => settle\(\)/);
  assert.match(source, /commit\.current\(amountAt\(latest\[0\], 0\), amountAt\(latest\[1\], LAST\)\)/);

  // Each thumb is an adjustable that a screen reader steps one stop at a time.
  assert.match(source, /accessibilityRole="adjustable"/);
  assert.match(source, /accessibilityActions=\{ADJUST\}/);
  assert.match(source, /accessibilityLabel=\{thumb === "low" \? "Minimum rent" : "Maximum rent"\}/);
});

test("a dropdown opens in place, says what it holds, and closes on a choice", () => {
  const source = fields();

  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /accessibilityRole="radiogroup"/);
  assert.match(source, /accessibilityRole="radio"/);
  assert.match(source, /name=\{open \? "chevron-up" : "chevron-down"\}/);
  // A set answer tints its field, so a sheet with filters on reads as set.
  assert.match(source, /const chosen = Boolean\(current\) && current !== options\[0\];/);
  // It opens and closes without a jump, unless motion is turned down.
  assert.match(source, /if \(!reduceMotion\) LayoutAnimation\.configureNext/);
});

test("choosing moves nothing: segments and fields keep their size when set", () => {
  const source = fields();

  assert.match(source, /segment: \{[^}]*borderWidth: 1,[^}]*borderColor: "transparent",/);
  assert.match(source, /segmentChosen: \{[^}]*borderColor: theme\.color\.kola\["600"\],/);
  assert.match(source, /select: \{[^}]*borderWidth: 1,/);
  // A chosen or open state changes colour only.
  assert.doesNotMatch(source, /(segmentChosen|selectChosen|selectOpen): \{[^}]*borderWidth/);
  assert.doesNotMatch(source, /borderWidth: (selected|chosen|open) \?/);
});

test("every row is a thumb-sized target", () => {
  const source = fields();

  assert.match(source, /const ROW_HEIGHT = 56;/);
  assert.match(source, /const TOUCH = 48;/);
  assert.match(source, /hitSlop=\{SEGMENT_SLOP\}/);
  // The switch is the platform's own, and the whole row owns the touch.
  assert.match(source, /<View pointerEvents="none"[^>]*>\s*<Switch\s+value=\{value\}/);
});
