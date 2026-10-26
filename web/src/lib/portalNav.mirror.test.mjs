import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * `portalNav.compiled.mjs` is a hand-written JS mirror of `portalNav.ts` so the
 * navigation tests can run with no build step. Its header has always claimed the
 * two are kept in step; nothing checked it, and they drifted — Payments was
 * added to the shipping file and never reached the mirror, so for a while every
 * navigation test was proving things about a copy that was not what shipped.
 *
 * Navigation is the one place a wrong answer is visible on every screen, and a
 * test suite that passes against a stale copy is worse than no suite at all.
 * These guards compare what the two files actually declare.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(resolve(here, name), "utf8");

/** Comments legitimately differ between the two, and quote route names. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const ts = stripComments(read("./portalNav.ts"));
const mjs = stripComments(read("./portalNav.compiled.mjs"));

/**
 * Every nav item either file declares.
 *
 * Sorted, not in source order: the two files legitimately place the shared
 * account section at different points, and one wraps a long entry across lines.
 * What has to agree is the set of destinations, their labels and their icons.
 */
function items(source) {
  return [...source.matchAll(/href:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*icon:\s*"([^"]+)"/g)]
    .map((match) => `${match[1]} ${match[2]} ${match[3]}`)
    .sort();
}

/** The prefix list `isPortalRoute` matches against. */
function prefixes(source) {
  const start = source.indexOf("const PORTAL_PREFIXES");
  const end = source.indexOf("]", start);
  return [...source.slice(start, end).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("the navigation mirror declares the same items as the file that ships", () => {
  const shipped = items(ts);
  const mirrored = items(mjs);

  assert.ok(shipped.length > 0, "no items parsed out of portalNav.ts");
  assert.deepEqual(
    mirrored,
    shipped,
    "portalNav.compiled.mjs has drifted from portalNav.ts — the navigation "
      + "tests would be passing against a copy nobody ships",
  );
});

test("both files match the same portal routes", () => {
  assert.deepEqual(prefixes(mjs), prefixes(ts));
});

test("the invitation route stays its own prefix", () => {
  // Portfolio and Team are Settings panels, covered by "/settings". This one is
  // separate: an invitee arrives on it from a secure link, and the matcher is
  // exact-or-slash so nothing else covers the hyphenated route.
  const listed = prefixes(ts);
  assert.ok(listed.includes("/settings"));
  assert.ok(listed.includes("/portfolio-invitations"));
});
