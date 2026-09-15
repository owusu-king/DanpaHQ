import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("Updates presents action, unread and domain filters as one communication system", () => {
  const page = read("web/app/updates/page.tsx");

  assert.match(page, /Action needed/);
  assert.match(page, /notificationCategory/);
  assert.match(page, /notificationSource/);
  assert.match(page, /notificationStatus/);
  assert.match(page, /notificationTone/);
  assert.match(page, /needsYou/);
  assert.match(page, /Needs your attention/);
  assert.match(page, /Today/);
  assert.match(page, /This week/);
  assert.match(page, /Earlier/);
});

test("Updates stays a log without repeating the shell title or adding a dashboard summary", () => {
  const page = read("web/app/updates/page.tsx");
  const meaning = read("web/src/lib/notificationMeaning.ts");

  // Home derives what is outstanding from live domain state. A notification only
  // knows whether it has been read, so this must not claim to be a queue.
  assert.doesNotMatch(page, /<PageHeader/);
  assert.doesNotMatch(page, /updates-overview/);
  assert.doesNotMatch(page, /communication centre/i);
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
  assert.match(css, /\.update-row\[data-tone="critical"\]/);
  assert.match(css, /\.update-row\.is-unread/);
  assert.match(css, /\.update-row:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("a row navigates immediately while its read acknowledgement settles", () => {
  const page = read("web/app/updates/page.tsx");

  assert.match(page, /void markNotificationsRead\(\[item\.id\]\)\.catch/);
  assert.match(page, /router\.push\(destination\(item\)/);
});

test("Updates presents at most ten records at once", () => {
  const page = read("web/app/updates/page.tsx");

  assert.match(page, /const PAGE_SIZE = 10/);
  assert.match(page, /orderedVisible\.slice\(\(currentPage - 1\) \* PAGE_SIZE, currentPage \* PAGE_SIZE\)/);
  assert.match(page, /\.\.\.visible\.filter\(needsYou\)/);
  assert.match(page, /aria-label="Updates pages"/);
  assert.match(page, />Previous</);
  assert.match(page, />Next</);
});
