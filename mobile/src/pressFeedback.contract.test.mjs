/**
 * How a control answers a press on Android.
 *
 * Android draws `android_ripple` across a view's rectangle whatever its corners
 * and whatever it clips, and the ripples were often in a control's full ink. So
 * a tap on a rounded button — "Join a home", the start screen's cards — flashed a
 * dark box over it (owner, 2026-09-28). Every control now answers with its own
 * pressed style on both platforms; the only ripples left are circles, which a
 * borderless ripple draws faithfully.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
    const path = join(dir, entry.name).split("\\").join("/");
    if (entry.isDirectory()) out.push(...sources(`${path}/`));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

test("the shared press feedback hands out no ripple", () => {
  const platform = code(read("src/platform.ts"));
  assert.match(platform, /export const pressableFeedback = \(_color: string\) => \(\{\}\);/);
});

test("no rounded control takes a rectangular ripple, and no press style is iOS-only", () => {
  const circles = new Set([
    "app/(app)/(provider-tabs)/_layout.tsx",
    "src/components/nav/HeaderCircleButton.tsx",
    "src/components/nav/MainTabBar.tsx",
  ]);
  for (const path of [...sources("app/"), ...sources("src/")]) {
    const source = code(read(path));
    if (circles.has(path)) {
      // The circles keep their ripple, and it is borderless — a circle, not a box.
      assert.match(source, /borderless: true/, `${path}: its ripple must be a circle`);
      continue;
    }
    assert.doesNotMatch(source, /android_ripple/, `${path} draws a rectangular ripple`);
    assert.doesNotMatch(source, /pressed && !isAndroid|pressed && Platform\.OS !== "android"/, `${path} leaves Android without a press state`);
  }
});
