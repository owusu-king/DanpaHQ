/**
 * The forms that bring a Property and a Unit into being.
 *
 * Since 2026-10-20 both are one modal wizard each (owner: "in a modal, like
 * agreement creation, but this time very simple and easy, concise, powerful"),
 * the twins of the web wizards. The routes are kept and render them, so every
 * link into creation still lands.
 *
 * What is pinned here is the shape a creation step takes: a strip of steps that
 * keep their glyphs and turn green when done, answers drawn as tiles rather
 * than hidden in sheets or thrown about as chips, an example inside the box
 * rather than in a line beneath it, and one act pinned where a thumb is with
 * the way back quiet beside it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const WIZARDS = {
  property: "src/components/property/PropertyWizard.tsx",
  unit: "src/components/property/UnitWizard.tsx",
};
const frame = () => read("src/components/creation/WizardFrame.tsx");

test("every way into creation opens the wizard, as a modal", () => {
  assert.match(read("app/(app)/private-property.tsx"), /<PropertyWizard\b/);
  assert.match(read("app/(app)/property-setup.tsx"), /<PropertyWizard\s+propertyId=\{propertyId\}/);
  assert.match(read("app/(app)/space-new.tsx"), /<UnitWizard\b/);
  const layout = read("app/(app)/_layout.tsx");
  for (const name of ["private-property", "property-setup", "space-new"]) {
    assert.match(
      layout,
      new RegExp(`name="${name}" options=\\{\\{[^}]*presentation: "modal", headerLeft: closeHeaderLeft`),
      `${name} is not a modal`,
    );
  }
  for (const path of Object.values(WIZARDS)) {
    assert.match(read(path), /<WizardFrame\b/);
    assert.doesNotMatch(read(path), /variant="display2"/);
    assert.doesNotMatch(read(path), /<Surface/);
  }
});

test("a finished step keeps its glyph and turns green, never a bare tick", () => {
  const source = frame();
  assert.match(source, /<Ionicons\s+name=\{item\.icon\}/);
  assert.match(source, /color=\{state === "done" \? PAPER : state === "current" \? KOLA_DEEP : MUTED\}/);
  assert.match(source, /markDone: \{ borderColor: KOLA, backgroundColor: KOLA \}/);
  // The strip is the way back to any step the record can hold.
  assert.match(source, /disabled=\{!item\.reachable\}/);
  assert.match(source, /onPress=\{\(\) => onGo\(item\.key\)\}/);
});

test("an example belongs in the box, not in a line beneath it", () => {
  for (const path of Object.values(WIZARDS)) {
    assert.doesNotMatch(read(path), /\bhint="/, `${path} still explains its fields underneath them`);
  }
  assert.match(read(WIZARDS.property), /"Adom Court"/);
  assert.match(read(WIZARDS.property), /placeholder="GA-492-1234"/);
  assert.match(read(WIZARDS.unit), /placeholder="e\.g\. Flat A, Room 3"/);
  // Counts are steppers, so the floor reads "Ground" rather than asking for 0.
  assert.match(read(WIZARDS.unit), /value === 0 \? "Ground"/);
});

test("one act is pinned where a thumb is, and the way back is quiet", () => {
  assert.match(frame(), /<ActionBar>\{footer\}<\/ActionBar>/);
  for (const path of Object.values(WIZARDS)) {
    const source = read(path);
    assert.match(source, /footer=\{/);
    assert.match(source, /<QuietAct label="Back" icon="chevron-back"/);
    assert.match(source, /<QuietAct label="Cancel"/);
    assert.doesNotMatch(source, /<Button\s+label=/, `${path} still stacks slabs`);
  }
  // A Documents step with nothing chosen says it skips, rather than "Save".
  assert.match(read(WIZARDS.property), /"Skip for now"/);
});

test("two short answers share a line rather than taking one each", () => {
  const source = read(WIZARDS.unit);
  assert.match(source, /counts: \{ flexDirection: "row", flexWrap: "wrap"/);
  assert.equal((source.match(/<View style=\{styles\.counts\}>/g) ?? []).length, 1);
});

test("a set of answers is drawn, not hidden in a sheet or thrown about as chips", () => {
  const property = read(WIZARDS.property);
  for (const label of ["Water source", "Power meter", "Compound"]) {
    assert.match(property, new RegExp(`<ChoiceTiles label="${label}"`));
  }
  assert.match(property, /<ChoiceTiles\s+label="What kind\?"/);
  assert.match(read(WIZARDS.unit), /<ChoiceTiles\s+label="What is being let\?"/);
  // A chosen tile's glyph turns white on kola — never grey on green.
  assert.match(frame(), /color=\{on \? PAPER : theme\.color\.ink\["700"\]\}/);
  assert.match(frame(), /choiceMarkOn: \{ backgroundColor: KOLA \}/);
  for (const path of Object.values(WIZARDS)) {
    assert.doesNotMatch(read(path), /<Choice\b/, `${path} still throws chips across the page`);
  }

  // A long list that genuinely needs one still opens a Select.
  const select = read("src/components/form/Select.tsx");
  assert.match(select, /<BottomSheet/);
  assert.match(select, /aria-expanded=\{open\}/);
  assert.match(read("src/components/property/AuthorityClaim.tsx"), /<Select\n        label="Your relationship to this property"/);
});

test("amenities are one compact grid, each with its own glyph", () => {
  const source = read("src/components/property/SpaceAmenities.tsx");
  assert.match(source, /name=\{amenityGlyph\(option\.name, option\.category\)\}/);
  assert.match(source, /width: "31\.5%"/);
  assert.doesNotMatch(source, /<Chip\b/);
  assert.doesNotMatch(source, /category\.toUpperCase\(\)/, "a heading over each pair is what it replaced");
});

test("every act in the creation flow is drawn the same way", () => {
  for (const path of [
    "src/components/property/AuthorityClaim.tsx",
    "src/components/property/SpaceAmenities.tsx",
    "src/components/property/VerificationPanel.tsx",
    "src/components/property/SpacePhotos.tsx",
  ]) {
    assert.doesNotMatch(read(path), /<Button\b/, `${path} still uses the old button`);
  }
  // Used on their own they keep their pinned act; inside the wizard the
  // wizard's one button runs them instead.
  for (const path of [
    "src/components/property/AuthorityClaim.tsx",
    "src/components/property/SpaceAmenities.tsx",
    "src/components/property/VerificationPanel.tsx",
  ]) {
    assert.match(read(path), /<ActionBar>/, `${path} has no pinned act`);
  }
  assert.match(read("src/components/property/SpaceAmenities.tsx"), /\{submitRef \? null : \(\s*<ActionBar>/);

  const photos = read("src/components/property/SpacePhotos.tsx");
  assert.doesNotMatch(photos, /<ActionBar>/, "a slot must not pin its own bar");
  assert.match(photos, /<QuietAct\n                  label="Make it first"/);
  const claim = read("src/components/property/AuthorityClaim.tsx");
  assert.match(claim, /label=\{document \? \(document\.fileName \|\| "Document attached"\) : "Attach the document"\}/);
});

test("choosing where a Property is reads as a list of places", () => {
  const source = read(WIZARDS.property);
  assert.match(source, /<View style=\{styles\.places\}>\s*\{suggestions\.map/);
  assert.match(source, /name="location-outline"/);
  assert.match(source, /suffix=\{place \? <Ionicons name="checkmark-circle"/);
});
