/**
 * The tenant's Applications, read as where each stands (owner, 2026-10-06).
 *
 * An agreement ready for them leads with the way to review it on the row; then
 * what is being considered, each drawing how far its journey has come above the
 * line that says it in words; what was approved; and the past, folded. The web
 * contracts still hold the row's words and the mirrored meaning; these hold the
 * layout's promises.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
const between = (source, start, end) => {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `${start} is missing`);
  const stop = source.indexOf(end, at + start.length);
  assert.notEqual(stop, -1, `${end} is missing after ${start}`);
  return source.slice(at, stop);
};
const screen = () => code(read("app/(app)/applications.tsx"));

test("an agreement ready leads, then what is being considered, approved, and the past", () => {
  const source = screen();
  assert.match(source, /bucket: applicationBucket\(application, leases\),/);
  assert.match(source, /return \{ action: of\("action"\), open: of\("open"\), approved: of\("approved"\), past: of\("past"\) \};/);
  assert.match(source, /<Section title="Ready for you" tone=\{LATERITE\} rows=\{lanes\.action\}/);
  assert.match(source, /<Section title="Being considered" rows=\{lanes\.open\}/);
  assert.match(source, /<Section title="Approved" rows=\{lanes\.approved\}/);
  assert.match(source, /<Fold title="Past"/);
  assert.doesNotMatch(source, /<BottomSheet|<ListHead|<ChoiceRow|applicationFilters/);
  // One sentence says what needs them, or how many are moving.
  assert.match(source, /`\$\{lanes\.action\.length\} \$\{lanes\.action\.length === 1 \? "agreement is" : "agreements are"\} ready for you`/);
});

test("a row draws how far its journey has come, and says where it stands in words", () => {
  const source = screen();
  const row = between(source, "function ApplicationRow(", "function Journey(");
  assert.match(row, /<Journey steps=\{steps\} stage=\{state\.stage\} \/>/);
  assert.match(row, /<StandingLine standing=\{state\} trailing=\{timeAgo\(application\.created_at\)\} \/>/);
  assert.match(row, /const short = shortfallNote\(application\);/);
  assert.match(source, /steps=\{timeline\(row\.application, leases\)\}/);
  const journey = between(source, "function Journey(", "function ApplicationSkeleton(");
  assert.match(journey, /accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/);
  assert.match(journey, /stopped: LATERITE,/);
});

test("an agreement waiting is one tap away, and the row still opens the application", () => {
  const source = screen();
  const row = between(source, "function ApplicationRow(", "function Journey(");
  assert.match(row, /const agreement = state\.stage === "action" \? state\.leaseId : null;/);
  assert.match(row, /<Act label="Review the agreement" icon="document-text-outline" primary onPress=\{\(\) => onAgreement\(agreement\)\} \/>/);
  assert.match(row, /onPress=\{onPress\}/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/agreement\/\[id\]", params: \{ id: leaseId \} \}\)/);
  assert.match(source, /router\.push\(\{ pathname: "\/\(app\)\/application\/\[id\]", params: \{ id: application\.id \} \}\)/);
});

test("loading, nothing yet and a failure each say the right thing", () => {
  const source = screen();
  assert.match(source, /accessibilityRole="progressbar" accessibilityLabel="Loading your applications"/);
  assert.match(source, /<Empty\s+icon="document-text-outline"\s+title="No applications yet"/);
  assert.match(source, /label="Explore homes" onPress=\{\(\) => router\.push\("\/\(app\)\/\(tabs\)\/explore" as never\)\}/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
  assert.match(source, /listMyLeases\(\)\.catch\(\(\) => \[\] as Lease\[\]\)/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\);/);
});
