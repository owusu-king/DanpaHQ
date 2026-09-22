/**
 * The forms that bring a Property and a Unit into being.
 *
 * These were the last screens written as plain stacks: a display heading, a
 * paragraph under it, a flat column of fields each carrying a sentence of hint,
 * and two to four full-width buttons at the end of the scroll. More words than
 * inputs, and no colour anywhere — which on this product reads as unfinished.
 *
 * What is pinned here is the shape a creation form takes: work grouped and
 * named, an example inside the box rather than in a line beneath it, and one
 * act pinned where a thumb is with anything quieter beside it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const FORMS = {
  "property creation": "app/(app)/private-property.tsx",
  "property setup": "app/(app)/property-setup.tsx",
  "Unit creation": "app/(app)/space-new.tsx",
};

test("a creation form groups its work and names each group", () => {
  for (const [name, path] of Object.entries(FORMS)) {
    const source = read(path);
    assert.match(source, /<GroupLabel>/, `${name} is an ungrouped stack of fields`);
    assert.doesNotMatch(source, /variant="display2"/, `${name} still shouts its heading`);
    assert.doesNotMatch(source, /<Surface/, `${name} still uses the old card`);
  }
  // The two halves of an address-bearing record, said once each.
  assert.match(read(FORMS["property creation"]), /<GroupLabel>What it is<\/GroupLabel>/);
  assert.match(read(FORMS["property creation"]), /<GroupLabel>Where it is<\/GroupLabel>/);
  assert.match(read(FORMS["Unit creation"]), /<GroupLabel>What is let here<\/GroupLabel>/);
  assert.match(read(FORMS["Unit creation"]), /<GroupLabel>Where inside the Property<\/GroupLabel>/);
});

test("an example belongs in the box, not in a line beneath it", () => {
  // Every field carried a `hint`, which is a second line of type under an
  // empty box. Where the hint was an example it is now the placeholder.
  for (const [name, path] of Object.entries(FORMS)) {
    const source = read(path);
    assert.doesNotMatch(source, /\bhint="/, `${name} still explains its fields underneath them`);
  }
  assert.match(read(FORMS["property creation"]), /placeholder="Adom Heights"/);
  assert.match(read(FORMS["property creation"]), /placeholder="GA-492-1234"/);
  assert.match(read(FORMS["Unit creation"]), /placeholder="Flat A, Room 3, Ground floor shop"/);
  assert.match(read(FORMS["Unit creation"]), /placeholder="0 for ground"/);
});

test("one act is pinned where a thumb is, and the rest are quiet", () => {
  for (const [name, path] of Object.entries(FORMS)) {
    const source = read(path);
    const bars = (source.match(/<ActionBar>/g) ?? []).length;
    const pills = (source.match(/<Pill\b/g) ?? []).length;
    assert.ok(bars > 0, `${name} leaves its act at the end of a scroll`);
    // One bar per act, so a step added later cannot quietly drop its own act
    // loose into the scroll while the others stay pinned.
    assert.equal(pills, bars, `${name} has ${pills} acts in ${bars} bars`);
    // Stacked full-width buttons are what the bar replaced.
    assert.doesNotMatch(source, /<Button\s+label=/, `${name} still stacks slabs`);
  }
  // Save-for-later and Back never compete with the act they sit beside.
  assert.match(read(FORMS["Unit creation"]), /<QuietAct label="Save for later"/);
  assert.match(read(FORMS["Unit creation"]), /<QuietAct label="Back" icon="chevron-back"/);
  assert.match(read(FORMS["property setup"]), /<QuietAct\s+label="Save and finish later"/);
});

test("two short answers share a line rather than taking one each", () => {
  // Bedrooms and bathrooms, floor and wing: four full-width boxes for four
  // short numbers is most of a screenful on a phone.
  const source = read(FORMS["Unit creation"]);
  assert.match(source, /pair: \{\n    flexDirection: "row",/);
  assert.equal((source.match(/<View style=\{styles\.pair\}>/g) ?? []).length, 2);
});

test("a set of answers is a field that opens, not chips thrown on the page", () => {
  const select = read("src/components/form/Select.tsx");

  // `Choice` wraps its options as chips, which is right for two short words
  // and wrong for five uneven ones. A `Select` wears the same frame a `Field`
  // does, so a form of questions looks like a form.
  assert.match(select, /export function Select/);
  assert.match(select, /<BottomSheet/);
  assert.match(select, /accessibilityRole="radio"/);
  assert.match(select, /aria-expanded=\{open\}/);
  assert.match(select, /name="chevron-down"/);
  // An option may say what it means underneath itself, which a chip cannot.
  assert.match(select, /detail\?: string;/);

  // Every question with more than a handful of answers now uses it.
  assert.match(read(FORMS["property setup"]), /<Select label="Water"/);
  assert.match(read(FORMS["property setup"]), /<Select label="Electricity"/);
  assert.match(read(FORMS["property setup"]), /<Select label="Compound"/);
  assert.match(read(FORMS["Unit creation"]), /<Select\n          label="Kind of space"/);
  assert.match(read("src/components/property/AuthorityClaim.tsx"), /<Select\n        label="Your relationship to this property"/);
  for (const [name, path] of Object.entries(FORMS)) {
    assert.doesNotMatch(read(path), /<Choice\b/, `${name} still throws chips across the page`);
  }
});

test("the journey is the way back to a step already done", () => {
  const journey = read("src/components/creation/CheckpointJourney.tsx");

  // It was a picture of where you are. The only way to a finished step was to
  // leave the flow and come back into it.
  assert.match(journey, /onGoTo\?: \(key: string\) => void;/);
  assert.match(journey, /const interactive = Boolean\(onGoTo\);/);
  assert.match(journey, /checkpoint\.state !== "current" && \(skipAhead \|\| checkpoint\.state !== "upcoming"\)/);
  // A progressbar that collapses its children cannot hold buttons.
  assert.match(journey, /accessible=\{!interactive\}/);
  assert.match(journey, /accessibilityElementsHidden=\{!interactive\}/);
  assert.match(journey, /`Go to \$\{checkpoint\.label\}`/);

  // The word under a checkpoint is not the glyph inside its disc. A completed
  // one fills with kola and draws a white tick on it; the same white on the
  // ivory page left the label unreadable — a button nobody could see.
  assert.match(journey, /color: palette\.label,/);
  assert.match(journey, /label: theme\.color\.kola\["800"\],/);
  assert.doesNotMatch(journey, /color: checkpoint\.state === "current" \? theme\.color\.ink\["900"\] : palette\.ink,/);

  // Property setup may be done in any order, so it can jump ahead; Unit
  // creation cannot, because each step writes to the record before it made.
  assert.match(read("src/components/property/SetupSteps.tsx"), /onGoTo=\{onGoTo\}\n      skipAhead/);
  assert.match(read(FORMS["property setup"]), /<SetupProgress steps=\{steps\} current=\{step\} onGoTo=/);
  assert.match(read(FORMS["Unit creation"]), /onGoTo=\{\(key\) => \{/);
  assert.doesNotMatch(read(FORMS["Unit creation"]), /skipAhead/);
});

test("every act in the creation flow is drawn the same way", () => {
  // These four were missed when the pages around them were done, so a step
  // could open onto a designed form and a stale grey button under it.
  for (const path of [
    "src/components/property/AuthorityClaim.tsx",
    "src/components/property/SpaceAmenities.tsx",
    "src/components/property/VerificationPanel.tsx",
    "src/components/property/SpacePhotos.tsx",
  ]) {
    assert.doesNotMatch(read(path), /<Button\b/, `${path} still uses the old button`);
  }
  for (const path of [
    "src/components/property/AuthorityClaim.tsx",
    "src/components/property/SpaceAmenities.tsx",
    "src/components/property/VerificationPanel.tsx",
  ]) {
    assert.match(read(path), /<ActionBar>/, `${path} has no pinned act`);
  }

  // A photo slot's controls belong to the slot. One bar per photograph would
  // be a page of things all asking to be pressed, so they are words instead.
  const photos = read("src/components/property/SpacePhotos.tsx");
  assert.doesNotMatch(photos, /<ActionBar>/, "a slot must not pin its own bar");
  assert.match(photos, /<QuietAct\n                  label="Make it first"/);
  assert.match(photos, /<Pill\n                label="Add photo"/);

  // And a step whose sub-panel already carries the act does not add a second
  // bar under it: moving on from Documents is a quiet word.
  const setup = read(FORMS["property setup"]);
  assert.match(setup, /<QuietAct label="Continue" icon="arrow-forward" onPress=\{onDone\} \/>/);
  // The document is a thing you attach, so it reads as a row that holds one.
  const claim = read("src/components/property/AuthorityClaim.tsx");
  assert.match(claim, /label=\{document \? \(document\.fileName \|\| "Document attached"\) : "Attach the document"\}/);
  assert.match(claim, /icon=\{document \? "checkmark-circle" : "document-attach-outline"\}/);
});

test("choosing where a Property is reads as a list of places", () => {
  // The suggestions were bare bordered rows under the field, indistinguishable
  // from the next input. They are a panel, and the chosen one is marked.
  const source = read(FORMS["property creation"]);
  assert.match(source, /<RecordPanel>\s*\{placeSuggestions\.map/);
  assert.match(source, /name="location-outline"/);
  assert.match(source, /suffix=\{selectedPlace \? <Ionicons name="checkmark-circle"/);
});
