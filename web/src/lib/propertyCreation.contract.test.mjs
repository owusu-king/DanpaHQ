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

const webStep = () => read("web/app/record/property-new/page.tsx");
// Since 2026-10-20 web creation is one modal wizard; the routes render it.
const wizard = () => read("web/src/components/property/PropertyWizard.tsx");
const unitWizard = () => read("web/src/components/property/UnitWizard.tsx");
const shell = () => read("web/src/components/creation/WizardShell.tsx");
const mobileStep = () => read("mobile/app/(app)/private-property.tsx");
// Mobile creation is one modal wizard too (2026-10-20), the twin of the web one.
const mobileWizard = () => read("mobile/src/components/property/PropertyWizard.tsx");
const mobileUnitWizard = () => read("mobile/src/components/property/UnitWizard.tsx");
const webChoice = () => read("web/src/components/property/PropertyTypeChoice.tsx");
const mobileChoice = () => read("mobile/src/components/property/PropertyTypeChoice.tsx");

test("the kind of property is one compact choice on each platform", () => {
  // Web: drawn tiles in the wizard, one per category the API serves (owner,
  // 2026-10-20: a powerful, concise modal). Mobile keeps its Select sheet.
  assert.match(code(wizard()), /<ChoiceTiles\s+label="What kind\?"/);
  assert.match(code(wizard()), /options=\{types\.map\(\(row\) => \(\{/);
  assert.match(code(mobileWizard()), /<ChoiceTiles\s+label="What kind\?"/);
  assert.match(code(mobileWizard()), /options=\{types\.map\(\(row\) => \(\{/);

  // Still the backend's three, and both clients' options are the API's own
  // list rather than a copy of it.
  const model = read("backend/apps/property/models.py");
  for (const value of ["residential", "commercial", "hostel"]) {
    assert.match(model, new RegExp(`"${value}"`));
  }
  assert.match(code(wizard()), /vocabulary\?\.sale_types \?\? \[\]\) : \(vocabulary\?\.property_types \?\? \[\]\)/);
  assert.match(code(mobileWizard()), /vocabulary\?\.sale_types \?\? \[\]\) : \(vocabulary\?\.property_types \?\? \[\]\)/);
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
  assert.match(code(wizard()), /settled \? "Done" : "Create property"/);
  assert.match(code(mobileWizard()), /settled \? "Done" : "Create property"/);
  assert.doesNotMatch(code(mobileWizard()), /submitForReview|submitPropertyForVerification/);
  // The wizard's last step finishes; nothing in it asks for a review.
  assert.doesNotMatch(code(wizard()), /submitForReview|submitPropertyForVerification/);
  assert.doesNotMatch(code(webStep()), /Create private property/);
});

test("mobile creation keeps the compact journey without the desktop step block", () => {
  // Mobile: the same modal wizard behind every way in, a strip of steps on top.
  assert.match(code(read("mobile/app/(app)/private-property.tsx")), /<PropertyWizard/);
  assert.match(code(read("mobile/app/(app)/property-setup.tsx")), /<PropertyWizard/);
  assert.match(code(read("mobile/app/(app)/space-new.tsx")), /<UnitWizard/);
  assert.match(code(mobileWizard()), /<WizardFrame/);
  assert.doesNotMatch(code(mobileWizard()), /<SetupSteps/);
  // Web is one wizard behind every way in: the sheet and the three routes.
  assert.match(code(webStep()), /<PropertyWizard/);
  assert.match(code(read("web/app/record/property-setup/page.tsx")), /<PropertyWizard\s+propertyId=\{propertyId\}/);
  assert.match(code(read("web/app/record/space-new/page.tsx")), /<UnitWizard/);
  assert.match(code(wizard()), /<WizardShell/);
  // The rail jumps between steps once the record exists to hold them.
  assert.match(code(wizard()), /reachable: Boolean\(id\) && !busy \? true : key === "basics"/);
  assert.match(shell(), /aria-current=\{item\.key === step\.key \? "step" : undefined\}/);
});

test("the review shows the property, not a progress table", () => {
  const mobileReview = code(mobileWizard()).slice(code(mobileWizard()).indexOf("function ReviewStep"));
  assert.match(mobileReview, /<ReviewLine/);
  assert.match(mobileReview, /property\.water_source_label/);
  assert.match(mobileReview, /onEdit=\{\(\) => onGo\("amenities"\)\}/);
  assert.match(mobileReview, /onEdit=\{\(\) => onGo\("photos"\)\}/);

  // Web: one line per thing — its glyph, what was said, and the way back to the
  // step that owns it — rather than step names against their status.
  const review = code(wizard()).slice(code(wizard()).indexOf("function ReviewStep"));
  assert.match(review, /<ReviewLine/);
  assert.match(review, /property\.water_source_label/);
  assert.match(review, /amenities\?\.length \? amenities\.map\(\(row\) => row\.name\)/);
  assert.match(review, /onEdit=\{\(\) => onGo\("details"\)\}/);
  assert.match(review, /onEdit=\{\(\) => onGo\("amenities"\)\}/);
  assert.match(review, /onEdit=\{\(\) => onGo\("photos"\)\}/);

  const mobileSummary = read("mobile/src/components/property/PropertySummary.tsx");
  assert.match(mobileSummary, /source=\{\{ uri: property\.cover_url \}\}/);
  assert.match(mobileSummary, /onEdit\("amenities"\)/);

  // And the API actually serves what the review reads.
  const serializer = read("backend/apps/property/serializers.py");
  assert.match(serializer, /"water_source_label",/);
  assert.match(serializer, /"amenities",/);
  assert.match(read("mobile/src/provider.ts"), /amenities: SpaceAmenity\[\];/);
});

test("only what is still owed is listed, and only when something is", () => {
  // Six rows reading "Done" is not a review; it is the checklist again.
  for (const source of [wizard(), mobileWizard()]) {
    assert.match(code(source), /outstanding\.length \? \(/);
    assert.match(code(source), /outstanding\.map\(/);
  }
  // A line still owed says so in colour, not in another list.
  assert.match(code(wizard()), /tone=\{owed\.has\("photos"\) \? "todo" : undefined\}/);
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
  // §10.1: treat every visible word as having a cost. Every file in the flow,
  // and every way of writing prose.
  const files = [
    "web/app/record/property-new/page.tsx",
    "web/app/record/property-setup/page.tsx",
    "web/src/components/property/PropertyWizard.tsx",
    "web/src/components/property/UnitWizard.tsx",
    "mobile/app/(app)/private-property.tsx",
    "mobile/app/(app)/property-setup.tsx",
    "mobile/src/components/property/PropertyWizard.tsx",
    "mobile/src/components/property/UnitWizard.tsx",
  ];

  const prose = (source) => {
    const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    return [
      ...body.matchAll(/(?:summary|body|hint|placeholder)="([^"]{25,})"/g),
      ...body.matchAll(/>\s*\n?\s*([A-Z][a-z][^<>{}]{28,})\s*\n?\s*</g),
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

  // The steps are named, not described — and each keeps its own glyph.
  for (const [key, label, icon] of [
    ["basics", "The property", "home"],
    ["details", "Details", "details"],
    ["documents", "Documents", "leases"],
    ["amenities", "Amenities", "amenities"],
    ["photos", "Photos", "photos"],
    ["review", "Review", "eye"],
  ]) {
    assert.match(wizard(), new RegExp(`${key}: \\{ label: "${label}", hint: "[^"]+", icon: "${icon}" \\}`));
  }
  assert.doesNotMatch(wizard(), /label: "What the compound has"/);

  const panel = read("web/src/components/property/SetupSteps.tsx");
  assert.match(panel, /summary\?: string;/);
});

test("nothing says the same thing twice on one screen", () => {
  // Mobile says it once, on Review, in the same words as the web.
  const mobile = code(mobileWizard());
  assert.match(mobile.slice(mobile.indexOf("function ReviewStep")), /Creating it sends nothing/);
  assert.doesNotMatch(mobile.slice(0, mobile.indexOf("function ReviewStep")), /sends nothing|sent to anybody/);

  // Web: the rail's foot says it stays private; the review says creating sends
  // nothing. Neither repeats the other.
  const web = code(wizard());
  assert.equal((web.match(/Private until you send it for checking/g) ?? []).length, 1);
  assert.doesNotMatch(web.slice(web.indexOf("function ReviewStep")), /until you send it for checking/);
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
  // Web: both wizards walk the same frame, so a Unit is added the way a
  // Property is created.
  for (const source of [wizard(), unitWizard()]) {
    assert.match(code(source), /<WizardShell/);
    assert.match(code(source), /lease-wizard-sheet is-wizard creation-sheet/);
  }
  for (const source of [mobileWizard(), mobileUnitWizard()]) {
    assert.match(code(source), /<WizardFrame/);
  }

  // Required completion semantics remain separate from visual position.
  for (const steps of [webSteps(), mobileSteps()]) {
    assert.match(steps, /!step\.optional && !step\.terminal/);
    assert.match(steps, /const complete = required\.length > 0 && done === required\.length/);
  }
});

test("a finished step keeps its glyph and turns green, never a bare tick", () => {
  const source = code(shell());
  assert.match(source, /<span className="lw-rail-mark" aria-hidden="true">\s*<Icon name=\{item\.icon\} \/>/);
  assert.doesNotMatch(source, /<Icon name="check" \/>/);
  const css = read("web/src/styles/creation-wizard.css");
  const done = css.slice(css.indexOf('.lw.is-iconic .lw-rail-step[data-state="done"] .lw-rail-mark {'));
  assert.match(done.slice(0, done.indexOf("}")), /background: var\(--color-kola-600\)/);
});
