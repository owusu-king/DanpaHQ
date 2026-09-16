/**
 * Motion.
 *
 * The app animated through two systems and agreed with itself by transcription.
 * React Native's `Animated` drove every screen; the shared duration and easing
 * tokens reached a handful of them; and the same press spring — `speed: 34,
 * bounciness: 2` — was written out by hand in four files, which is four places
 * for it to stop being the same spring.
 *
 * Everything animated now runs through Reanimated, and everything it is given
 * comes from `src/motion.ts`, which reads the same `tokens.json` the web reads.
 * The rules here are about what has to stay true of that: one system, one
 * spring, no literal milliseconds, and an answer for somebody who has asked the
 * system to stop moving things.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const motion = () => read("src/motion.ts");

/** Every .tsx under a directory, recursively. */
function sources(relative) {
  const out = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".tsx")) out.push(full);
    }
  })(resolve(root, relative));
  return out;
}

const screens = () => [...sources("src"), ...sources("app")];
const named = (file) => file.slice(root.length + 1).replace(/\\/g, "/");

/** Every file that animates anything. */
function animating() {
  return screens().filter((file) => /react-native-reanimated/.test(readFileSync(file, "utf8")));
}

test("the app has one animation system, not two", () => {
  // `Animated` from react-native and `Animated` from Reanimated are different
  // objects with overlapping names, and a codebase holding both is one import
  // line away from a component that silently never moves.
  const offenders = [];
  for (const file of screens()) {
    const body = code(readFileSync(file, "utf8"));
    if (/import\s*\{[^}]*\bAnimated\b[^}]*\}\s*from\s*"react-native"/.test(body)) {
      offenders.push(named(file));
    }
  }
  assert.deepEqual(offenders, [], `still on react-native's Animated: ${offenders.join(", ")}`);
});

test("nothing animated states a duration or a curve of its own", () => {
  // The four duration tokens are 80, 140, 220 and 320. A file that animates
  // must ask for one by name; a literal is a number that agrees with the design
  // system until somebody revises the design system.
  const offenders = [];
  for (const file of animating()) {
    if (named(file) === "src/motion.ts") continue;
    const body = code(readFileSync(file, "utf8"));
    if (/duration:\s*\d/.test(body) || /Easing\.bezier\(\s*[\d.]/.test(body)) {
      offenders.push(named(file));
    }
  }
  assert.deepEqual(offenders, [], `literal motion values: ${offenders.join(", ")}`);

  // And the module itself takes all three curves and all four durations from
  // the bridge that parses the generated theme, rather than restating them.
  const source = code(motion());
  assert.match(source, /export const duration = motion\.duration/);
  for (const curve of ["enter", "exit", "standard"]) {
    assert.match(source, new RegExp(`Easing\\.bezier\\(\\.\\.\\.motion\\.easing\\.${curve}\\)`));
  }
  // Built once. `Easing.bezier` compiles a curve, and compiling the same three
  // on every press is work nobody asked for.
  assert.match(source, /^const curve = \{/m);
});

test("one press, so two controls on a screen cannot answer a thumb differently", () => {
  assert.match(code(motion()), /export const press: WithSpringConfig/);

  // The spring was written out in four files. Nobody may describe another.
  const offenders = [];
  for (const file of animating()) {
    if (named(file) === "src/motion.ts") continue;
    const body = code(readFileSync(file, "utf8"));
    if (/\b(?:speed|bounciness|stiffness|damping|mass):/.test(body)) offenders.push(named(file));
  }
  assert.deepEqual(offenders, [], `describes its own spring: ${offenders.join(", ")}`);

  // A press is proportional, so there are exactly two scales — a glyph and a
  // tile — and both are named rather than typed at the call site.
  assert.match(code(motion()), /export const PRESS_SCALE = 0\.92/);
  assert.match(code(motion()), /export const PRESS_SCALE_TILE = 0\.97/);
});

test("every animation answers somebody who asked the system to stop", () => {
  const source = code(motion());

  // The configs carry it, so the UI thread answers without asking JavaScript.
  // Counted rather than merely matched: a new config that forgets is exactly
  // the failure this is here to catch.
  const configs = (source.match(/reduceMotion: ReduceMotion\.System/g) ?? []).length;
  assert.ok(configs >= 4, `only ${configs} configs honour Reduce Motion`);

  // Entering and exiting animations get it from Reanimated's own default, so
  // the rule for those is that nothing overrides it back to Never.
  assert.doesNotMatch(source, /ReduceMotion\.Never/);

  // And the hook still exists, still subscribes rather than reading once, and
  // is still used — the skeleton's pulse cannot be expressed as a config,
  // because the system's answer is to freeze it at its faintest value.
  assert.match(source, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(source, /addEventListener\(\s*"reduceMotionChanged"/);
  assert.match(source, /export function useSkeletonPulse\(\)/);
  assert.match(source, /if \(reduceMotion\) \{/);
});

test("a shared value is never written while the component renders", () => {
  // Reanimated is explicit that this is unsupported, and React 19 makes it
  // visible: the development render runs twice, so the second write restarts
  // the animation from wherever the first had reached.
  //
  // Checked by shape rather than by parsing: a write to `.value` belongs in an
  // effect, a callback, or a worklet, and every one of those is indented past
  // the two spaces a render-body statement sits at.
  const offenders = [];
  for (const file of animating()) {
    for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
      if (/^ {2}\w[\w.]*\.value\s*=/.test(line)) offenders.push(`${named(file)}:${index + 1}`);
    }
  }
  assert.deepEqual(offenders, [], `written during render: ${offenders.join(", ")}`);
});

test("both Homes arrive the same way, and neither of them pops", () => {
  const motionSource = code(motion());
  // A stagger, so a dashboard resolves in reading order instead of blinking
  // into existence all at once.
  assert.match(motionSource, /export function arrive\(order = 0\)/);
  assert.match(motionSource, /\.delay\(order \* STAGGER\)/);
  assert.match(motionSource, /export function depart\(\)/);

  const tenant = code(read("src/components/home/TenantHome.tsx"));
  const provider = code(read("app/(app)/(provider-tabs)/index.tsx"));
  for (const [name, screen] of [["tenant Home", tenant], ["provider Home", provider]]) {
    assert.match(screen, /entering=\{arrive\(0\)\}/, `${name} does not stagger its first module`);
    assert.match(screen, /entering=\{arrive\(1\)\}/, `${name} does not stagger its second module`);
  }

  // The skeleton leaves rather than being cut, and the column that holds both
  // animates the height between them — otherwise the swap is still a jump,
  // just a jump with a fade on one side of it.
  assert.match(tenant, /exiting=\{depart\(\)\}/);
  assert.match(tenant, /layout=\{LinearTransition\.duration\(duration\.base\)\}/);

  // Both skeletons breathe at the same rate. The provider's used to sit at a
  // flat `opacity: 0.7` beside a tenant skeleton that pulsed, which read as a
  // rendering fault rather than as loading.
  for (const path of [
    "src/components/home/HomeSkeleton.tsx",
    "app/(app)/(provider-tabs)/index.tsx",
  ]) {
    assert.match(code(read(path)), /useSkeletonPulse\(\)/, `${path} draws a still skeleton`);
  }
});
