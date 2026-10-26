/**
 * The archive, as a recovery list.
 *
 * Archiving is not deleting: the history stays, and so does the possibility of
 * restoring — but only while the current lifecycle allows it, which the server
 * decides per resource. That answer is the whole point of the screen, so it is
 * what the summary counts and what every row says.
 *
 * `dashboardShell` pins that both clients reach the same endpoints.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const screen = () => read("app/(app)/archive.tsx");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

test("what is archived leads, with how much of it can come back", () => {
  const source = screen();
  assert.match(source, /label="In archive"/);
  assert.match(source, /const ready = \[\.\.\.properties, \.\.\.spaces\]\.filter\(\(item\) => item\.restore\.allowed\)\.length;/);
  assert.match(source, /\$\{ready\} of \$\{total\} can be restored now/);
  assert.match(source, /text: "None can be restored yet", tone: "alert"/);
  assert.match(source, /\{ label: "Properties", value: String\(properties\.length\) \}/);
  assert.match(source, /\{ label: "Units", value: String\(spaces\.length\) \}/);

  // The stack header says "Archive"; the page does not say it again.
  assert.doesNotMatch(code(source), />\s*Archive\s*<\/Type>/);
});

test("each kind is grouped, and a row says only what it is and whether it can return", () => {
  const source = screen();
  assert.match(source, /\{ key: "properties", title: "Properties", items: properties as Item\[\] \}/);
  assert.match(source, /\{ key: "units", title: "Units", items: spaces as Item\[\] \}/);

  // One word on the right, in its own colour, carrying the server's answer.
  assert.match(source, /const standing = restorable \? "Can restore" : "Held";/);
  assert.match(source, /color: restorable \? KOLA : HARMATTAN/);
  assert.match(source, /Archived \{formatDate\(item\.archived_at\)\}/);
});

test("the reason and the blockers open on the row rather than filling the list", () => {
  const source = screen();
  // A rarely visited recovery list stays a list; the paragraphs are one tap in.
  assert.match(source, /closeLabel="Close details"/);
  assert.match(source, /No reason was recorded for this older archive entry\./);
  assert.match(source, /title="Cannot restore yet"/);
  assert.match(
    source,
    /\[item\.restore\.message, \.\.\.item\.restore\.blockers\.map\(\(blocker\) => blocker\.message\)\]\.join\(" "\)/,
  );
});

test("restoring is offered only where the server allows it, and closes what it empties", () => {
  const source = screen();
  assert.match(source, /footer=\{selected\?\.restore\.allowed \? \(/);
  assert.match(source, /label="Restore"/);
  assert.match(source, /busyLabel="Restoring…"/);
  assert.match(source, /if \(resource\.resource_type === "property"\) await restoreProperty\(resource\.id\);/);
  assert.match(source, /else await restoreSpace\(resource\.id\);/);
  // The row it was opened from is about to leave the list.
  assert.match(source, /setSelected\(null\);/);
  assert.match(source, /await load\(\);/);
});

test("an empty archive, and the wait, each say the right thing", () => {
  const source = screen();
  assert.match(source, /title="Your archive is empty"/);
  assert.match(source, /accessibilityLabel="Loading your archive"/);
  assert.match(source, /listMyArchive/);
});
