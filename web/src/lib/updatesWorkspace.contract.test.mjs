import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("Updates is what is new and what happened recently, never a log", () => {
  const page = read("web/app/updates/page.tsx");

  // New first — what needs an answer, then the rest unread — then recent activity.
  assert.match(page, /title: "Needs your attention"/);
  assert.match(page, /title: "New"/);
  assert.match(page, /title: "Recent activity"/);
  assert.match(page, /notificationSource/);
  assert.match(page, /notificationStatus/);
  assert.match(page, /notificationTone/);
  assert.match(page, /needsYou/);

  // No history to page through, no filters over it.
  assert.doesNotMatch(page, /Pagination|aria-label="Updates pages"|PAGE_SIZE/);
  assert.doesNotMatch(page, /DropdownMenu|SegmentedControl/);
  assert.doesNotMatch(page, /"This week"|"Earlier"/);
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
  const page = read("web/app/updates/page.tsx");

  assert.match(css, /\.update-row\b/);
  // A group is not a boxed, shadowed card inside the panel.
  assert.doesNotMatch(read("web/src/styles/workspace.css"), /\.ws-rows \{[^}]*box-shadow/);
  assert.match(css, /\.update-row\[data-tone="critical"\]/);
  // Unread is a shape and a weight as well as a colour.
  assert.match(css, /\.update-row\.is-unread \.update-row-dot \{ opacity: 1/);
  assert.match(css, /\.update-row\.is-unread \.update-row-title \{[^}]*font-weight: 650/);
  assert.match(page, /\$\{item\.is_read \? "" : "Unread\. "\}/);
  assert.match(css, /\.update-row:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("secondary actions are disclosed, not stacked on every row", () => {
  const page = read("web/app/updates/page.tsx");
  const css = read("web/src/styles/updates-workspace.css");

  // Mark-as-read is a sibling of the row button (never nested in it) and shows on intent.
  assert.match(page, /className="update-row-mark"/);
  assert.match(css, /\.update-item:hover \.update-row-mark/);
  assert.match(css, /@media \(hover: none\)/);
});

test("the shell badge follows the page, and Back returns to the same place", () => {
  const page = read("web/app/updates/page.tsx");
  const shell = read("web/src/components/portal/PortalShell.tsx");

  assert.match(page, /new CustomEvent\("rooomly:unread"/);
  assert.match(shell, /addEventListener\("rooomly:unread"/);
  assert.match(page, /sessionStorage\.setItem\(RETURN_KEY/);
  assert.match(page, /Try again/);
});

test("a row navigates immediately while its read acknowledgement settles", () => {
  const page = read("web/app/updates/page.tsx");

  assert.match(page, /void markNotificationsRead\(\[item\.id\]\)\.catch/);
  assert.match(page, /router\.push\(destination\(item\)/);
});

test("a reminder leaves once read; only the ten most recent activities stay", () => {
  const page = read("web/app/updates/page.tsx");
  const types = read("web/src/lib/console.ts");

  // The server says which a record is; the client never guesses from the kind.
  assert.match(types, /record: "informational" \| "activity"/);
  assert.match(page, /const RECENT_KEPT = 10/);
  assert.match(page, /item\.record === "activity" && \(item\.is_read \|\| stale\(item\)\)\)\s*\.slice\(0, RECENT_KEPT\)/);
  // Unread activity weeks old is past, not new, and New is capped too — a
  // tenant had 72 unread rows under New (owner, 2026-10-05: "listing too many").
  assert.match(page, /const STALE_DAYS = 14;/);
  assert.match(page, /const stale = \(item: Notification\) => new Date\(item\.created_at\)\.getTime\(\) < staleBefore;/);
  // Repeats about the same thing keep only the newest.
  assert.match(page, /const key = `\$\{item\.kind\}:\$\{item\.target_type\}:\$\{item\.target_id\}`;/);
  assert.match(page, /const other = fresh\.filter\(\(item\) => !needsYou\(item\)\)\.slice\(0, RECENT_KEPT\);/);
  // Reading a reminder removes it here as the server deletes it.
  assert.match(page, /filter\(\(row\) => !\(row\.id === item\.id && row\.record === "informational"\)\)/);
  assert.match(page, /filter\(\(item\) => item\.record !== "informational"\)/);
});
