/**
 * Every screen a tab does not hold open has a way out.
 *
 * The native back button renders only when the stack has history, and several
 * routes here arrive without any. `router.replace` from a tab drops the tabs
 * out of the stack entirely — Tenancy requests is reached that way from
 * `?view=requests` — so the screen opened with no back button *and* no tab bar.
 * On iOS, with no hardware back, that is a dead end.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const layout = () => read("mobile/app/(app)/_layout.tsx");
const control = () => read("mobile/src/components/nav/BackControl.tsx");

test("the way out is drawn once and used everywhere", () => {
  // In `screenOptions`, so a screen has to opt *out* rather than remember to
  // opt in — a new route added tomorrow gets it without anyone noticing.
  assert.match(layout(), /headerLeft: backHeaderLeft,/);
  assert.match(layout(), /headerBackVisible: false,/);
  assert.doesNotMatch(layout(), /headerBackTitle/);
});

test("it goes back when it can and home when it cannot", () => {
  const source = control();

  // Asking only "can I go back" is what left people on a screen with no exit.
  assert.match(source, /canGoBack \?\? router\.canGoBack\(\)/);
  assert.match(source, /router\.back\(\)/);
  // The fallback is the same entry route the app resolves at sign-in, so it
  // lands on the surface this person actually uses rather than a fixed guess.
  assert.match(source, /resolveEntryRoute\(state\.me, activeContext\)/);
  assert.match(source, /router\.replace\(home as never\)/);
});

test("a modal is closed, not returned from", () => {
  const source = layout();
  const modals = source.match(/presentation: "modal"/g) ?? [];
  assert.ok(modals.length >= 1, "expected focused modal routes to still be modals");

  // Applications, Viewings and Agreements left the set deliberately. They are
  // substantial records with resumable context and multiple possible actions;
  // a sheet that dismisses on a downward swipe is for a focused task, not a
  // workspace.
  //
  // Plain string checks: the route name contains brackets and a slash, and an
  // escaped regex for it is harder to read than the line it is matching.
  const applicationLine = source
    .split(/\r?\n/)
    .find((line) => line.includes('name="application/[id]"'));
  assert.ok(applicationLine, "the application route should still be registered");
  assert.ok(
    applicationLine.includes('title: "Application"'),
    "the application route should keep its title",
  );
  assert.ok(
    !applicationLine.includes("presentation"),
    "the application record is a pushed screen, not a modal",
  );
  const viewingLine = source
    .split(/\r?\n/)
    .find((line) => line.includes('name="viewing/[id]"'));
  assert.ok(viewingLine, "the viewing route should still be registered");
  assert.ok(
    !viewingLine.includes("presentation"),
    "the viewing record is a pushed screen, not a modal",
  );
  const agreementLine = source
    .split(/\r?\n/)
    .find((line) => line.includes('name="agreement/[id]"'));
  assert.ok(agreementLine, "the agreement route should still be registered");
  assert.ok(
    !agreementLine.includes("presentation"),
    "the agreement record is a pushed screen, not a modal",
  );

  // Every modal route carries the close variant. On iOS a modal shows no back
  // button at all, so those had nothing in the header but a title.
  for (const line of source.split(/\r?\n/)) {
    if (line.includes('presentation: "modal"')) {
      assert.match(line, /headerLeft: closeHeaderLeft/);
    }
  }
  assert.match(control(), /name=\{mode === "close" \? "close" : "chevron-back"\}/);
});

test("a terminal screen is not given a door to nowhere", () => {
  // Access is limited and the entry route the fallback would use is the very
  // surface being withheld, so a back control there is a loop.
  assert.match(
    layout(),
    /name="restricted"[\s\S]{0,140}headerLeft: \(\) => null/,
  );
});

test("the control is a thumb-sized target", () => {
  const source = control();
  // 44pt is the smallest reliably hittable target, and the measurement that
  // decides whether a header control feels considered or fiddly.
  assert.match(source, /minWidth: 44/);
  assert.match(source, /minHeight: 44/);
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityLabel=\{mode === "close" \? "Close" : "Go back"\}/);
});

test("every screen outside the tabs is registered with a title", () => {
  const source = layout();
  const dir = resolve(root, "mobile/app/(app)");

  const entries = readdirSync(dir, { withFileTypes: true });
  const routes = [
    ...entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
      .map((entry) => entry.name.replace(/\.tsx$/, "")),
    // A parenthesised folder is a tab group and contributes nothing to the
    // path; the rest are real routes one level down.
    ...entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("("))
      .flatMap((entry) =>
        readdirSync(resolve(dir, entry.name))
          .filter((file) => file.endsWith(".tsx") && file !== "_layout.tsx")
          .map((file) => `${entry.name}/${file.replace(/\.tsx$/, "")}`),
      ),
  ].filter((name) => name !== "_layout");

  // An unregistered route still inherits the header, but its title falls back
  // to the filename — "restricted" and "tenancy" both shipped that way.
  const missing = routes.filter((name) => !source.includes(`name="${name}"`));
  assert.deepEqual(missing, []);
  // Guard the guard: if the walk stopped finding routes it would pass silently.
  assert.ok(routes.length > 30, `expected the whole route tree, saw ${routes.length}`);
});
