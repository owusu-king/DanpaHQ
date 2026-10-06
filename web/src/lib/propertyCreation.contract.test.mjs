/**
 * Creating a property.
 *
 * The journey itself was already right and is left alone: one flow of six
 * steps ending in *Create property*, drawn as a status checklist rather than a
 * forced wizard because documents, photographs and amenities are three
 * independent piles of work on a record that already exists. `propertySetup`
 * derives every step from server state and is mirrored, so a provider who
 * starts on a phone and finishes on a laptop sees the same thing.
 *
 * What was wrong was the single most consequential field in it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const webStep = () => read("web/app/properties/new/page.tsx");
const mobileStep = () => read("mobile/app/(app)/private-property.tsx");
const webChoice = () => read("web/src/components/property/PropertyTypeChoice.tsx");
const mobileChoice = () => read("mobile/src/components/property/PropertyTypeChoice.tsx");

test("the kind of property is one compact choice on each platform", () => {
  // A dropdown on both (owner, 2026-10-05 — "it needs to be a dropdown for
  // selection"); the tiles were rows of cards for a three-way choice. On a
  // phone it is the bottom-sheet Select every other question uses.
  assert.match(code(webStep()), /<PropertyTypeChoice/);
  assert.match(webChoice(), /<Select/);
  assert.doesNotMatch(webChoice(), /type-choice-grid/);
  assert.match(code(mobileStep()), /<PropertyTypeChoice/);
  assert.match(mobileChoice(), /<Select\s+label="Property type"/);
  assert.match(read("mobile/src/components/property/PurposeChoice.tsx"), /<Select\s+label="Purpose"/);

  // Still the backend's three, and both clients' options are the API's own
  // list rather than a copy of it.
  const model = read("backend/apps/property/models.py");
  for (const value of ["residential", "commercial", "hostel"]) {
    assert.match(model, new RegExp(`"${value}"`));
  }
  assert.match(webChoice(), /types\.map\(\(type\) => \[type\.value, type\.label\]/);
  assert.match(mobileChoice(), /types\.map\(\(type\) => \(\{/);
});

test("each choice says what it buys, from the API rather than from copy", () => {
  // "Apartment · House · Studio · Room" is `space_rules` talking. Written out
  // by hand it would drift the first time the vocabulary changed, and could
  // describe a combination the backend would refuse.
  // Mobile under each answer in the sheet; web in one line under the dropdown.
  assert.match(mobileChoice(), /type\.space_types/);
  assert.match(webChoice(), /chosen\?\.space_types/);
  for (const source of [webChoice(), mobileChoice()]) {
    assert.match(source, /\.join\(" · "\)/);
  }
  assert.match(read("backend/apps/property/space_rules.py"), /residential/);
});

test("choosing looks chosen, and moves nothing", () => {
  // Web is a native select now, so the browser carries state and keys. Purpose
  // is one too: two cards for a two-way choice were "unnecessary".
  assert.match(read("web/src/components/property/PurposeChoice.tsx"), /<Select\s+label="Purpose"/);

  // Mobile's Select sheet marks the chosen answer itself, as a radio group.
  assert.match(read("mobile/src/components/form/Select.tsx"), /accessibilityRole="radio"/);
});

test("creating a property is not submitting it for verification", () => {
  // Two different acts, and the flow used to end in a button that could be
  // read as either.
  for (const source of [
    read("web/app/properties/[id]/setup/page.tsx"),
    read("mobile/app/(app)/property-setup.tsx"),
  ]) {
    assert.match(source, /"Create property"/);
  }
  // And step one continues rather than finishing: the record is written there
  // only because documents and photographs need something to attach to.
  assert.doesNotMatch(code(webStep()), /Create private property/);
});

test("mobile creation keeps the compact journey without the desktop step block", () => {
  const first = code(read("mobile/app/(app)/private-property.tsx"));
  const setup = code(read("mobile/app/(app)/property-setup.tsx"));
  const webSetup = code(read("web/app/properties/[id]/setup/page.tsx"));

  for (const source of [first, setup]) {
    assert.match(source, /<SetupProgress/);
    assert.doesNotMatch(source, /<SetupSteps/);
  }
  // Web too, now: the tracker's icons move between sections (owner, 2026-10-05:
  // "omit the little side nav and allow jumping … via the tracking icons").
  assert.doesNotMatch(webSetup, /<SetupSteps/);
  assert.doesNotMatch(code(webStep()), /<SetupSteps/);
  assert.match(webSetup, /<SetupProgress steps=\{steps\} current=\{active\.key\} onSelect=\{\(key\) => setStep\(key as StepKey\)\} \/>/);
  const journey = read("web/src/components/creation/CheckpointJourney.tsx");
  assert.match(journey, /onSelect && \(canSelect \? canSelect\(checkpoint\) : true\) \? \(\s*<button/);
  assert.match(journey, /aria-current=\{checkpoint\.state === "current" \? "step" : undefined\}/);
  // Unit creation jumps too, once the Unit exists to hold the later steps.
  assert.match(read("web/app/properties/[id]/spaces/new/page.tsx"), /canSelect=\{\(checkpoint\) => canJump \|\| checkpoint\.key === "details"\}/);
});

test("the review shows the property, not a progress table", () => {
  const webReview = read("web/app/properties/[id]/setup/page.tsx");
  const mobileReview = read("mobile/app/(app)/property-setup.tsx");

  // It listed step names against their status — "Photos: 2 of 5 added". The
  // last thing somebody saw before creating a building they had just
  // photographed was a checklist of their own progress.
  for (const source of [webReview, mobileReview]) {
    assert.match(source, /<PropertySummary property=\{property\} onEdit=\{onGoTo\} \/>/);
    assert.doesNotMatch(code(source), /Not done yet/);
  }

  // The photograph they took is the first thing on it. Asserted on the *render*
  // rather than a mention: `cover_url` appears twice in each file, so checking
  // that the name occurs passed happily with the image switched off.
  const webSummary = read("web/src/components/property/PropertySummary.tsx");
  const mobileSummary = read("mobile/src/components/property/PropertySummary.tsx");
  assert.match(webSummary, /<img src=\{property\.cover_url\}/);
  assert.match(mobileSummary, /source=\{\{ uri: property\.cover_url \}\}/);
  assert.match(webSummary, /\{property\.cover_url \? \(/);
  assert.match(mobileSummary, /\{property\.cover_url \? \(/);

  for (const summary of [webSummary, mobileSummary]) {
    assert.match(summary, /property\.title/);
    assert.match(summary, /property\.amenities/);
    assert.match(summary, /water_source/);
    // Edit sits beside the group it changes, not at the end of the page.
    assert.match(summary, /onEdit\("details"\)/);
    assert.match(summary, /onEdit\("amenities"\)/);
  }

  // And the API actually serves what the summary reads.
  const serializer = read("backend/apps/property/serializers.py");
  assert.match(serializer, /"cover_url",/);
  assert.match(serializer, /"amenities",/);
  assert.match(read("mobile/src/provider.ts"), /amenities: SpaceAmenity\[\];/);
});

test("only what is still owed is listed, and only when something is", () => {
  // Six rows reading "Done" is not a review; it is the checklist again.
  for (const source of [
    read("web/app/properties/[id]/setup/page.tsx"),
    read("mobile/app/(app)/property-setup.tsx"),
  ]) {
    assert.match(code(source), /outstanding\.length \? \(/);
    assert.match(code(source), /outstanding\.map\(/);
  }
});

test("a step row says its state, never a description of itself", () => {
  // Falling back to `summary` put an explanatory sentence under every step
  // nobody had reached — five stacked in a navigation list. §10.1: a row that
  // names its destination needs nothing under it.
  const steps = read("web/src/components/property/SetupSteps.tsx");
  assert.doesNotMatch(code(steps), /step\.summary/);
  assert.match(code(steps), /step\.detail \?\? \(step\.status === "done" \? "Done" : null\)/);
  // The summaries still exist for the panel that opens, which is where an
  // explanation belongs.
  assert.match(read("mobile/src/propertySetup.ts"), /summary: "/);
});

test("a step explains itself in a heading, not in a paragraph", () => {
  // §10.1: treat every visible word as having a cost. The flow carried a 29-word
  // page header, a notice the review already made, and step summaries of up to
  // 42 words — "Setting a property up here does not record you as holding it —
  // anyone could type an address. A document does, once our team has read it…"
  // over a step already titled Documents.
  //
  // **Every file in the flow, and every way of writing prose.** The first
  // version of this test read one file and quoted only attributes, so it went
  // green while step one — the screen that forms the first impression — still
  // carried 86 words across a header, a summary, a hint and a notice body.
  const files = [
    "web/app/properties/new/page.tsx",
    "web/app/properties/[id]/setup/page.tsx",
    "mobile/app/(app)/private-property.tsx",
    "mobile/app/(app)/property-setup.tsx",
  ];

  const prose = (source) => {
    const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    return [
      ...body.matchAll(/(?:summary|body|hint|placeholder)="([^"]{25,})"/g),
      // Text between tags, which is how mobile writes captions and how the web
      // page headers are written.
      ...body.matchAll(/>\s*\n?\s*([A-Z][a-z][^<>{}]{28,})\s*\n?\s*</g),
      // Ternary branches rendered into the page.
      ...body.matchAll(/[?:]\s*"([A-Z][^"]{28,})"/g),
    ].map((match) => match[1].split(/\s+/).filter(Boolean).join(" "));
  };

  for (const file of files) {
    for (const line of prose(read(file))) {
      if (/var\(--|rgb\(|repeat\(/.test(line)) continue; // style values, not prose
      const words = line.split(" ").length;
      assert.ok(words <= 16, `${file}: ${words} words where a heading would do — "${line}"`);
    }
  }

  // The steps are named, not described.
  const setup = read("web/app/properties/[id]/setup/page.tsx");
  for (const title of [
    "The property",
    "Property details",
    "Documents",
    "Photos",
    "Shared amenities",
    "Review",
  ]) {
    assert.match(setup, new RegExp(`title="${title}"`));
  }
  assert.doesNotMatch(setup, /title="What the compound has"/);
  assert.doesNotMatch(setup, /title="Photos of the building"/);

  // A summary is optional, so a step that needs no line does not get one.
  const panel = read("web/src/components/property/SetupSteps.tsx");
  assert.match(panel, /summary\?: string;/);
  assert.match(panel, /\{summary \? \(/);
});

test("nothing says the same thing twice on one screen", () => {
  const web = read("web/app/properties/[id]/setup/page.tsx");
  const mobile = read("mobile/app/(app)/property-setup.tsx");

  // "Nothing has been sent to anybody" was on the page header, on a notice
  // above the steps, and in the review panel.
  for (const source of [web, mobile]) {
    assert.equal(
      (source.match(/sent to anybody/g) ?? []).length,
      1,
      "the reassurance belongs in one place",
    );
  }
  // And the notice that duplicated the review is gone from both.
  for (const source of [web, mobile]) {
    assert.doesNotMatch(source, /Finish creating it, and you can decide about verification/);
  }
});

const webPanel = () => read("web/src/components/property/VerificationPanel.tsx");
const mobilePanel = () => read("mobile/src/components/property/VerificationPanel.tsx");
const webSteps = () => read("web/src/components/property/SetupSteps.tsx");
const mobileSteps = () => read("mobile/src/components/property/SetupSteps.tsx");
const workspaceCss = () => read("web/src/styles/property-workspace.css");

test("a photograph is added by its own square, not by a block of buttons", () => {
  // The slot used to end in a control block of a fixed ~200px — thumbnail,
  // Replace, Remove, none of them allowed to wrap — so every pixel the column
  // lost fell on the reason beside it. Measured in a browser: at 420px, the
  // width of the step column, the reason ran to three lines and the slot stood
  // 113px tall; at 280px it took four and stood 157px.
  //
  // The photograph is the control now: one fixed 64px item per row, and
  // nothing else in it that refuses to shrink.
  for (const panel of [webPanel(), mobilePanel()]) {
    assert.match(panel, /function EvidenceTile\(/);
    // Add and replace are the same gesture on the same square.
    assert.match(panel, /Replace the photo of \$\{slot\.label\}/);
    assert.match(panel, /Add a photo of \$\{slot\.label\}/);
  }

  // The bordered Replace button and the "Add photo" button are both gone.
  assert.doesNotMatch(code(webPanel()), /"Add photo"|>Add photo</);
  assert.doesNotMatch(code(mobilePanel()), /label=\{[^}]*"Add photo"|label="Add photo"/);
  assert.doesNotMatch(code(webPanel()), /"Replace"/);
  assert.doesNotMatch(code(mobilePanel()), /"Replace"/);

  // Remove survives on its own, because it is the one action here that
  // destroys something.
  assert.match(code(webPanel()), /evidence-slot-remove/);
  assert.match(code(mobilePanel()), /Remove the photo of/);
});

test("a slot cannot push the step panel past its column", () => {
  // A flex or grid item's default minimum is its own content, so one
  // unshrinkable child anywhere in the chain widens every ancestor until
  // something scrolls. The panel sits two levels inside the step card.
  assert.match(code(webPanel()), /display: "grid", gap: "var\(--space-4\)", minWidth: 0/);

  const css = workspaceCss();
  for (const rule of [".evidence-slots", ".evidence-slot-what"]) {
    const block = css.slice(css.indexOf(rule + " {"), css.indexOf("}", css.indexOf(rule + " {")));
    assert.ok(block.includes("min-width: 0"), `${rule} must be allowed to shrink`);
  }

  // The tile is the only fixed width, and it is fixed on purpose.
  const tile = css.slice(css.indexOf(".evidence-tile {"), css.indexOf("}", css.indexOf(".evidence-tile {")));
  assert.match(tile, /width: 64px/);
  assert.match(tile, /flex: 0 0 auto/);

  // On the phone the row is the same shape, and the 140px-tall banner that made
  // six slots run past 1,700px is gone along with the card around each one.
  assert.doesNotMatch(code(mobilePanel()), /height: 140/);
  assert.doesNotMatch(code(mobilePanel()), /<Surface/);
});

test("creation progress is a named checkpoint journey, not an anonymous strip", () => {
  const webJourney = read("web/src/components/creation/CheckpointJourney.tsx");
  const mobileJourney = read("mobile/src/components/creation/CheckpointJourney.tsx");
  const journeyCss = read("web/src/styles/creation-journey.css");

  // Property state is still derived from the server, but every meaningful
  // stage — including optional work and Review — now has an identity.
  for (const steps of [webSteps(), mobileSteps()]) {
    assert.match(steps, /steps\.map\(\(step\) =>/);
    assert.match(steps, /<CheckpointJourney/);
    assert.match(steps, /step\.status === "started"[\s\S]{0,100}"attention"/);
    assert.match(steps, /READY TO REVIEW/);
    assert.match(steps, /BUILDING PROPERTY/);
  }

  for (const source of [webJourney, mobileJourney]) {
    assert.match(source, /"completed" \| "current" \| "upcoming" \| "attention"/);
    assert.match(source, /checkpoints\.findIndex/);
    assert.match(source, /of \$\{checkpoints\.length\}/);
  }

  assert.match(journeyCss, /\.checkpoint-completed/);
  assert.match(journeyCss, /\.checkpoint-current/);
  assert.match(journeyCss, /\.checkpoint-attention/);
  assert.match(journeyCss, /\.checkpoint-upcoming/);
  assert.match(journeyCss, /\.checkpoint-connector/);
  assert.doesNotMatch(journeyCss, /width:\s*\d+%/);
});

test("phones show nearby checkpoint context without squeezing the whole journey", () => {
  const mobileJourney = read("mobile/src/components/creation/CheckpointJourney.tsx");

  assert.match(mobileJourney, /currentIndex - 1/);
  assert.match(mobileJourney, /checkpoints\.length - 3/);
  assert.match(mobileJourney, /nearby\.map/);
  assert.match(mobileJourney, /accessibilityRole="progressbar"/);
  assert.match(mobileJourney, /useReduceMotion/);
});

test("Property and Unit creation speak the same checkpoint language", () => {
  const webUnit = read("web/app/properties/[id]/spaces/new/page.tsx");
  const mobileUnit = read("mobile/app/(app)/space-new.tsx");

  for (const source of [webUnit, mobileUnit]) {
    assert.match(source, /<CheckpointJourney/);
    assert.match(source, /BUILDING UNIT/);
    assert.doesNotMatch(code(source), /STEP \{n\} OF 4/);
  }

  // Required completion semantics remain separate from visual position.
  for (const steps of [webSteps(), mobileSteps()]) {
    assert.match(steps, /!step\.optional && !step\.terminal/);
    assert.match(steps, /const complete = required\.length > 0 && done === required\.length/);
  }
});
