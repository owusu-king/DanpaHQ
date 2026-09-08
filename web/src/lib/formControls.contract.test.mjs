/**
 * Form controls.
 *
 * These were the last things in the product still wearing the browser's own
 * clothes. The text field had no focus state whatsoever — the input inside it
 * set `outline: none` and the shell around it never reacted — and every radio
 * and checkbox was a native control painted by the operating system, next to
 * type and colour the rest of the product chose deliberately.
 *
 * The rules here are about what must stay true of a *drawn* control: that the
 * real input is still underneath it, that state is never carried by colour
 * alone, and that turning something on never moves what is beside it.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

const forms = () => read("web/src/styles/forms.css");
const check = () => read("web/src/components/Check.tsx");
const field = () => read("web/src/components/Field.tsx");
const select = () => read("web/src/components/Select.tsx");
const mobileUi = () => read("mobile/src/components/ui.tsx");

/** Every .tsx under a directory, recursively. */
function sources(relative) {
  const out = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".tsx")) out.push(full);
    }
  })(resolve(root, relative));
  return out;
}

/** The declarations inside one CSS rule, by selector. */
function rule(css, selector) {
  const at = css.indexOf(selector + " {");
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

test("no screen paints its own checkbox or radio", () => {
  // Nine of them did, with no styling at all, so the operating system drew
  // them. A control that is native on one screen and designed on the next is
  // worse than either everywhere.
  const offenders = [];
  for (const file of [...sources("web/src"), ...sources("web/app")]) {
    const body = code(readFileSync(file, "utf8"));
    for (const match of body.matchAll(/<input[\s\S]{0,400}?\/>/g)) {
      const tag = match[0];
      if (!/type="(checkbox|radio)"/.test(tag)) continue;
      // Either it is drawn by the shared control, or it is a face of its own —
      // PropertyTypeChoice covers its input with a tile it styles itself.
      if (/control-input/.test(tag)) continue;
      if (/type-choice/.test(body) && /name="property-type"/.test(tag)) continue;
      offenders.push(file.slice(root.length + 1).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(offenders, [], `still native: ${offenders.join(", ")}`);
});

test("the drawn control keeps the real one underneath it", () => {
  // The temptation with a designed checkbox is to render a div and track state
  // in React. That control cannot be reached by a keyboard, announced by a
  // screen reader, or grouped into a set by arrow keys.
  assert.match(code(check()), /<input\s/);
  assert.match(code(check()), /type=\{kind\}/);
  // Hidden by being unpainted, not by being removed from the layout tree.
  const input = rule(forms(), ".control-input");
  assert.match(input, /opacity: 0/);
  assert.doesNotMatch(input, /display: none/);
  assert.doesNotMatch(input, /visibility: hidden/);

  // Radios need a name or they are not a set. The offered-slot list had none.
  assert.match(code(check()), /name\?: string/);
  // The offered-slot list moved onto the provider's viewing record.
  assert.match(
    code(read("web/src/components/viewings/ProviderViewingRecord.tsx")),
    /name=\{`offered-slot-/,
  );
});

test("a field says when it has focus", () => {
  // It did not. The input set `outline: none` and nothing replaced it, so
  // tabbing through a form moved a cursor nobody could see.
  const focus = rule(forms(), ".field-shell:focus-within");
  assert.match(focus, /border-color:/);
  assert.match(focus, /box-shadow:/);

  // The ring is a shadow, so gaining focus moves nothing on the page.
  assert.match(focus, /box-shadow: 0 0 0 3px/);

  // Failing is not the same as being focused, and both are visible.
  assert.match(rule(forms(), ".field-shell-error"), /--color-laterite-600/);

  // On the phone there is no :focus, so the state has to be held.
  assert.match(code(mobileUi()), /const \[focused, setFocused\] = useState\(false\)/);
  // And the caller's own handlers still run.
  assert.match(code(mobileUi()), /onFocus\?\.\(event\)/);
  assert.match(code(mobileUi()), /onBlur\?\.\(event\)/);
});

test("a select does not wear the operating system's arrow", () => {
  assert.match(rule(forms(), ".select-control"), /appearance: none/);
  // Drawn from two borders on a rotated square, in a colour that matches.
  assert.match(rule(forms(), ".select-shell::after"), /--color-ink-500/);
  assert.match(code(select()), /select-shell/);
  assert.match(code(select()), /select-control/);
  // Explore had written its own by hand and would have drifted the moment the
  // shared one was redrawn.
  assert.doesNotMatch(read("web/src/styles/explore-workspace.css"), /\.explore-drawer select/);
});

test("turning something on never moves what is beside it", () => {
  // A chip that gains a pixel of border re-wraps every chip after it, under the
  // thumb of whoever pressed it. Measured at 97px in both states.
  const on = rule(forms(), ".chip:has(.control-input:checked)");
  assert.match(on, /box-shadow: inset 0 0 0 1px/);
  assert.doesNotMatch(on, /border-width/);
  assert.doesNotMatch(on, /padding/);

  // The knob slides; it is not laid out again at a new offset.
  assert.match(rule(forms(), ".control-input:checked + .switch::after"), /transform: translateX/);

  // On the phone a border cannot be a shadow, so the padding gives back exactly
  // what the second pixel of border takes.
  assert.match(code(mobileUi()), /paddingHorizontal: selected \? space\[4\] - 1 : space\[4\]/);
  assert.match(code(mobileUi()), /borderWidth: selected \? 2 : 1/);
  // The tick that used to be prefixed to the label — and shifted it — is gone.
  assert.doesNotMatch(code(read("mobile/src/components/property/SpaceAmenities.tsx")), /"✓ "/);
});

test("state is never carried by colour alone", () => {
  // Chosen differs in weight as well as in hue, on both platforms.
  assert.match(rule(forms(), ".chip:has(.control-input:checked)"), /box-shadow: inset/);
  assert.match(code(mobileUi()), /variant=\{selected \? "bodyStrong" : "body"\}/);
  // A ticked box has a mark in it, not just a filled ground.
  assert.match(rule(forms(), ".control-input:checked + .control-box::after"), /opacity: 1/);
});

test("a stylesheet does not undo the control it now contains", () => {
  // `.viewing-slots input` is (0,1,1) and beats `.control-input` at (0,1,0):
  // the hidden input would come back at 1.125rem, drawn by the operating
  // system, beside the box that replaced it. Same shape in three workspaces.
  for (const [sheet, selector] of [
    ["viewings-tenant.css", ".viewing-slots input {"],
    ["agreements-workspace.css", ".agreement-acknowledge input {"],
    ["settings-workspace.css", ".settings-toggle input {"],
  ]) {
    assert.doesNotMatch(
      read(`web/src/styles/${sheet}`),
      new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${sheet} still sizes the input the control hides`,
    );
  }
});

test("a setting is a switch, and one of several answers is not", () => {
  // "Send me an email when rent is due" is on or off. A checkbox reads as one
  // of several answers to a question, which is a different thing.
  assert.match(code(read("web/app/settings/notifications/page.tsx")), /<Switch/);
  assert.match(code(check()), /role="switch"/);
  // The visible text belongs to the row, so the control carries its own name.
  assert.match(code(check()), /aria-label=\{label\}/);

  // The phone keeps the platform's own switch, which is what its users expect —
  // parity here is semantic, not geometric (ADR 0014).
  const mobileSettings = read("mobile/app/(app)/notification-settings.tsx");
  assert.match(mobileSettings, /from "react-native"/);
  assert.match(mobileSettings, /trackColor=/);
});

test("native desktop dialogs restore centering after the CSS reset", () => {
  // The reset removes the browser's default `dialog { margin: auto }`. Without
  // putting it back, showModal() pins an otherwise correct dialog to (0, 0).
  for (const [sheet, selector] of [
    ["payments-workspace.css", ".payment-dialog"],
    ["tenants-workspace.css", ".lease-dialog"],
    ["team-workspace.css", ".team-dialog"],
    ["listing-workspace.css", ".listing-lightbox"],
  ]) {
    assert.match(
      rule(read(`web/src/styles/${sheet}`), selector),
      /margin: auto/,
      `${selector} will open at the upper-left instead of centred`,
    );
  }
});

test("the field is drawn once, not once per screen", () => {
  // The states worth having are all pseudo-classes, and an inline style cannot
  // express one — which is why these had none.
  assert.doesNotMatch(code(field()), /style=\{\{[\s\S]{0,200}border:/);
  assert.match(code(field()), /className=\{shell\}/);
  assert.match(forms(), /\.field-shell:hover/);
  assert.match(forms(), /\.chip:hover/);
  assert.match(forms(), /\.control:hover \.control-box/);
});

test("a field is 48px, and clickable to its own edges", () => {
  // Both of these were broken by the first pass at the redesign, and both are
  // the kind of thing that reads as unfinished without being nameable.
  //
  // The input was padded to 48px inside a shell whose `min-height` was already
  // 48, so the content pushed past it and every field came out 50 — two pixels
  // taller than the buttons and selects standing beside it.
  //
  // And the horizontal padding sat on the shell, so a 12px strip down each side
  // looked like part of the field and was not part of the control. Measured in
  // a browser: 8 of 160 sampled points inside the box did not land on the
  // input. It is 0 of 360 now.
  const shell = rule(forms(), ".field-shell");
  const input = rule(forms(), ".field-input");

  // The input has to fill the frame for the frame to be the target.
  assert.match(shell, /align-items: stretch/);
  assert.match(shell, /min-height: var\(--target-min\)/);
  // Nothing may sit between the frame's edge and the control.
  assert.doesNotMatch(shell, /padding/);
  assert.match(input, /padding: 0 var\(--space-3\)/);

  // A prefix brings its own left padding rather than the shell providing it.
  assert.match(rule(forms(), ".field-prefix"), /padding-inline-start/);

  // Everything a person can reach is the same height.
  assert.match(rule(forms(), ".select-control"), /min-height: var\(--target-min\)/);

  // The phone had the same dead strip, for the same reason.
  const mobile = code(mobileUi()).replace(/\s+/g, " ");
  assert.match(mobile, /alignItems: "stretch"/);
  // The padding belongs to the control, not to the frame around it.
  assert.match(mobile, /input: \{[^}]*paddingHorizontal: space\[3\]/);
  assert.doesNotMatch(mobile, /inputShell: \{[^}]*paddingHorizontal/);
});

test("an input that is drawn as something else does not also draw a focus box", () => {
  // foundation.css gives every input a 2px ink outline on focus. It is
  // wrapped in `:where(...)`, which contributes no specificity — so the rule
  // weighs (0,1,0), exactly what a bare class weighs, and it sits later in the
  // cascade. **A single class cannot override it.** It takes a pseudo-class to
  // answer a pseudo-class, and that is not obvious from reading either rule.
  //
  // The rule used to live in globals.css. It moved to foundation.css with the
  // rest of the interaction layer; what this test guards is that exactly one
  // such rule exists and that the controls which draw their own focus still
  // suppress it, which is unchanged by where it is written.
  //
  // Wherever an input is hidden behind something that draws the focus state
  // itself, the outline landed on the input's own box — which has no radius —
  // as a square green rectangle over a rounded control. On the property type
  // tiles the input is stretched to `inset: 0`, so it framed the whole tile.
  const foundation = read("web/src/styles/foundation.css");
  assert.match(foundation, /:where\([^)]*input[^)]*\):focus-visible/);
  // And only there, so nothing can quietly reintroduce a second global ring
  // that the suppressions below were never written against.
  assert.doesNotMatch(read("web/app/globals.css"), /:where\([^)]*input[^)]*\):focus-visible/);

  for (const [sheet, selector] of [
    ["forms.css", ".field-input:focus-visible"],
    ["forms.css", ".control-input:focus-visible"],
    ["property-workspace.css", ".type-choice-option input:focus-visible"],
  ]) {
    assert.match(
      rule(read(`web/src/styles/${sheet}`), selector),
      /outline: none/,
      `${selector} must suppress the global outline`,
    );
  }

  // And the thing that replaced it still shows focus, so nothing was merely
  // switched off.
  assert.match(rule(forms(), ".field-shell:focus-within"), /box-shadow/);
  assert.match(rule(forms(), ".control-input:focus-visible + .control-box"), /box-shadow/);
  assert.match(
    rule(read("web/src/styles/property-workspace.css"), ".type-choice-option input:focus-visible + .type-choice-face"),
    /outline:/,
  );

  // A 1px input is not small enough to be safe: a 2px outline offset by 2px
  // around one is a ~9px green square beside the control it belongs to.
  // `.sr-only` clips with `clip-path`, which takes the outline with it.
  const hand = [];
  for (const file of [...sources("web/src"), ...sources("web/app")]) {
    const body = readFileSync(file, "utf8");
    if (/position: "absolute", width: 1, height: 1, opacity: 0/.test(body)) {
      hand.push(file.slice(root.length + 1).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(hand, [], `hand-hidden inputs, use .sr-only: ${hand.join(", ")}`);
});
