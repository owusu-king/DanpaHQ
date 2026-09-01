import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile Updates separates what wanted a reply from what merely happened", () => {
  const screen = read("mobile/app/(app)/notifications.tsx");

  assert.match(screen, /Waiting on you/);
  assert.match(screen, /needsYou/);
  assert.match(screen, /Needs a reply/);
  assert.match(screen, /accessibilityRole="tablist"/);
  // The flag has to reach a screen reader, not only the eye.
  assert.match(screen, /\$\{flagged \? "Needs a reply\. " : ""\}/);
});

test("no notification is a dead tap any more", () => {
  const meaning = read("mobile/src/notificationMeaning.ts");
  const screen = read("mobile/app/(app)/notifications.tsx");

  // Three of the seven emitted target types used to fall off the end of an
  // if-chain: the row marked itself read and moved you nowhere.
  for (const target of ["organization", "portfolio_invitation", "property_join_request"]) {
    assert.match(meaning, new RegExp(`case "${target}"`));
  }
  assert.doesNotMatch(meaning, /case "listing"/);
  assert.match(screen, /destination\(item, isProvider\)/);
  assert.doesNotMatch(screen, /else if \(item\.target_type/);
});

test("the feed is rows, and unread does not depend on colour", () => {
  const screen = read("mobile/app/(app)/notifications.tsx");

  // Every item used to be a Surface — a card per line in a feed.
  assert.doesNotMatch(screen, /<Surface/);
  assert.match(screen, /borderLeftWidth: 3/);
  assert.match(screen, /ItemSeparatorComponent/);
  assert.match(screen, /minHeight: 76/);
  assert.match(screen, /Unread/);
});

test("Explore uses a horizontal quick-filter rail with one inline control at a time", () => {
  const search = read("mobile/app/(app)/search.tsx");

  // The closed filters remain visible and thumb-reachable. Opening one reveals
  // only its choices, rather than replacing Explore with a full-page modal.
  assert.match(search, /horizontal[\s\S]{0,180}accessibilityRole="toolbar"/);
  assert.match(search, /function CompactFilter/);
  assert.match(search, /function FilterChip/);
  assert.match(search, /function ChoiceRow/);
  assert.match(search, /accessibilityRole="radio"/);
  assert.match(search, /filtering === "price"/);
  assert.doesNotMatch(search, /<Modal|presentationStyle=|<Switch/);
});
