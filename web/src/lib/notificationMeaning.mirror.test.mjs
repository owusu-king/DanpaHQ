import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The two clients must agree about which notifications wanted a reply.
 *
 * If they drift, the same event is a thing you have to answer on one platform
 * and a receipt on the other — for the same person, about the same viewing. The
 * destination tables are deliberately *not* compared: the route shapes differ,
 * and mobile splits several by workspace.
 *
 * Skipped when the mobile tree is not reachable — the web container mounts only
 * `./web`, so this runs in CI and is a no-op there.
 */

const here = dirname(fileURLToPath(import.meta.url));

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The kinds listed in WANTS_A_REPLY, in declaration order. */
function kinds(source) {
  const start = source.indexOf("const WANTS_A_REPLY");
  const end = source.indexOf("]", start);
  return [...source.slice(start, end).matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((match) => match[1]);
}

const web = read(resolve(here, "./notificationMeaning.ts"));
const mobile = read(resolve(here, "../../../mobile/src/notificationMeaning.ts"));

test("both clients agree on which notifications wanted a reply", { skip: !web || !mobile }, () => {
  const listed = kinds(web);

  assert.ok(listed.length > 0, "no kinds parsed out of the web file");
  assert.deepEqual(
    kinds(mobile),
    listed,
    "notificationMeaning has drifted — the same event would need answering on "
      + "one platform and not the other",
  );
});

test("every kind that wants a reply is one the backend actually emits", { skip: !web }, () => {
  // The old routing table carried a "listing" branch for an event that is never
  // sent. A classification of kinds nobody emits is a guess wearing a rule's
  // clothing, so this checks the list against the handlers.
  const handlers = read(resolve(here, "../../../backend/apps/notifications/handlers.py"));
  if (!handlers) return;

  const emitted = new Set(
    [...handlers.matchAll(/kind\s*=\s*"([^"]+)"/g)].map((match) => match[1]),
  );
  for (const kind of kinds(web)) {
    assert.ok(emitted.has(kind), `${kind} is classified but never emitted`);
  }
});

test("every target type the backend emits has a destination", { skip: !web }, () => {
  const handlers = read(resolve(here, "../../../backend/apps/notifications/handlers.py"));
  if (!handlers) return;

  const emitted = new Set(
    [...handlers.matchAll(/target_type="([^"]+)"/g)].map((match) => match[1]),
  );
  const mobileSource = read(resolve(here, "../../../mobile/src/notificationMeaning.ts"));
  for (const target of emitted) {
    assert.match(web, new RegExp(`case "${target}"`), `web has no destination for ${target}`);
    if (mobileSource) {
      assert.match(mobileSource, new RegExp(`case "${target}"`), `mobile has no destination for ${target}`);
    }
  }
});
