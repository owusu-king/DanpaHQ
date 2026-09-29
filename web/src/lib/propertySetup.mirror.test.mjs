import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * `mobile/src/propertySetup.ts` is a deliberate mirror of the web file, the same
 * way `verification.ts` mirrors its twin. A provider who starts a property on
 * their phone and finishes it on a laptop has to see the same steps in the same
 * state.
 *
 * Two copies of a pure function drift silently, and the failure would be the two
 * platforms disagreeing about what is finished — one telling somebody to add a
 * photograph while the other says they are done. That is worth a cheap guard.
 *
 * It compares the function bodies rather than the whole file, because the two
 * legitimately differ around them: the mobile copy carries an extra adapter for
 * the shapes that client holds, and each has its own header.
 *
 * Skipped when the mobile tree is not reachable — the web container mounts only
 * `./web`, so this runs in CI (whole repo checked out) and is a no-op locally.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(here, "../../../mobile/src/propertySetup.ts");
const WEB = resolve(here, "./propertySetup.ts");

/** The text of one exported function, brace-matched from its signature. */
function functionBody(source, name) {
  const start = source.indexOf(`export function ${name}`);
  if (start === -1) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source
          .slice(open, i + 1)
          // Comments and blank lines may legitimately differ in wording.
          .replace(/\/\/[^\n]*/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }
  return null;
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const mobile = read(MOBILE);
const web = read(WEB);

test("the mobile mirror agrees with the web original", { skip: !mobile || !web }, () => {
  for (const name of ["describePropertySetup", "isSetupComplete", "resumeAt"]) {
    const a = functionBody(web, name);
    const b = functionBody(mobile, name);

    assert.ok(a, `${name} not found in the web file`);
    assert.ok(b, `${name} not found in the mobile mirror`);
    assert.equal(
      b,
      a,
      `${name} has drifted between web and mobile — the two platforms would ` +
        "disagree about what is finished",
    );
  }
});

test("both files still declare the same steps", { skip: !mobile || !web }, () => {
  const keys = (source) => [...source.matchAll(/key: "([a-z_]+)"/g)].map((m) => m[1]);

  assert.deepEqual(keys(mobile), keys(web));
  // `sale` is declared for properties sold whole (owner, 2026-09-28); letting
  // never reaches it, and land skips `details` and `amenities`.
  assert.deepEqual(keys(web), [
    "basics",
    "details",
    "sale",
    "documents",
    "photos",
    "amenities",
    "review",
  ]);
});
