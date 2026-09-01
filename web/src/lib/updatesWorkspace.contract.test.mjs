import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("Updates separates what wanted a reply from what merely happened", () => {
  const page = read("web/app/updates/page.tsx");

  assert.match(page, /Waiting on you/);
  assert.match(page, /needsYou/);
  // Words first, colour as reinforcement — never the message.
  assert.match(page, /Needs a reply/);
  assert.match(page, /role="tablist"/);
  assert.match(page, /ArrowLeft/);
});

test("Updates is a log and says so, rather than competing with Home", () => {
  const page = read("web/app/updates/page.tsx");
  const meaning = read("web/src/lib/notificationMeaning.ts");

  // Home derives what is outstanding from live domain state. A notification only
  // knows whether it has been read, so this must not claim to be a queue.
  assert.match(page, /Home is where you see what is still outstanding/);
  assert.match(meaning, /return !item\.is_read && wantsAReply\(item\.kind\)/);
});

test("every notification lands somewhere real", () => {
  const meaning = read("web/src/lib/notificationMeaning.ts");
  const page = read("web/app/updates/page.tsx");

  // The old table covered four target types and sent the other three to the
  // properties list — including a Portfolio invitation, the one notification a
  // person cannot act on anywhere else.
  assert.match(meaning, /case "portfolio_invitation"/);
  assert.match(meaning, /case "organization"/);
  assert.match(meaning, /case "property_join_request"/);
  // "listing" was in the table and is never emitted.
  assert.doesNotMatch(meaning, /case "listing"/);
  assert.match(page, /destination\(item\)/);
});

test("rows are rows, not cards, and unread does not depend on colour", () => {
  const css = read("web/src/styles/updates-workspace.css");

  assert.match(css, /\.update-row\b/);
  assert.match(css, /border-left: var\(--border-stamp\) solid transparent/);
  assert.match(css, /\.update-row:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
