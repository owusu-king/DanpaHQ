/**
 * Security and Notification settings, refined on review (2026-09-15).
 *
 * Security: how the account stands leads as one panel in its own colour, the
 * devices are one glass list with the two actions kept apart, and what to watch
 * for is a note rather than a section of prose. Settings: one glass panel, with
 * the narrowing of texts nested under the switch it depends on.
 *
 * `dashboardShell` and `formControls` keep the older promises — a removed row
 * leaving straight away, and the platform's own switch; these hold the layout's.
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
const security = () => code(read("app/(app)/security.tsx"));
const settings = () => code(read("app/(app)/notification-settings.tsx"));

test("how the account stands leads, in its own colour", () => {
  const source = security();
  const panel = between(source, "function StatusPanel(", "function DeviceRow(");

  assert.match(source, /\{status \? <StatusPanel status=\{status\} devices=\{devices\?\.length \?\? 0\} \/> : null\}/);
  assert.match(panel, /const held = status\.payouts_held;/);
  assert.match(panel, /const noted = status\.reasons\.length > 0;/);
  assert.match(panel, /const tone = held \? LATERITE : noted \? HARMATTAN : KOLA;/);
  assert.match(panel, /held\s*\? "Payouts are paused for now"\s*: noted \? "Worth knowing" : "Nothing unusual on your account";/);
  // The hold says why, and for how long, rather than being discovered at a withdrawal.
  assert.match(panel, /`\$\{status\.reasons\.join\(" "\)\} This lasts about \$\{Math\.ceil\(status\.hold_remaining_hours\)\} more hours\. You can use everything else as normal\.`/);
  assert.match(panel, /\{devices\} \{devices === 1 \? "device" : "devices"\} signed in/);
  assert.match(panel, /accessibilityLabel=\{`\$\{title\}\. \$\{body\}`\}/);
  assert.match(source, /<IndexGround>/);
  assert.doesNotMatch(source, /<Surface/);
});

test("two device actions, kept apart, and neither takes a second press", () => {
  const source = security();
  const row = between(source, "function DeviceRow(", "function DeviceAction(");

  assert.match(source, /<GroupLabel count=\{devices\?\.length\}>Devices signed in<\/GroupLabel>/);
  assert.match(source, /busy=\{removingDevice === device\.id\}\s*disabled=\{removingDevice !== null\}/);
  assert.match(row, /\{!device\.is_current \? \(/);
  assert.match(row, /label=\{busy \? "Working…" : "Sign out"\}/);
  assert.match(source, /canReportStolen=\{Boolean\(status\?\.stolen_device_reporting_enabled\)\}/);
  assert.match(row, /\{canReportStolen \? \(/);
  assert.match(row, /label="Lost or stolen"\s*hint="Blocks it from signing in\. Only support can undo this\."\s*tone="danger"/);
  assert.match(row, /end=\{device\.is_current \? <Type variant="label" style=\{styles\.current\}>THIS DEVICE<\/Type> : undefined\}/);
  assert.match(row, /Last used \{lastUsed\(device\.last_seen_at\)\}/);
  // A raw locale stamp with seconds is not how somebody reads "when was this used".
  const when = between(source, "function lastUsed(", "function deviceIcon(");
  assert.match(when, /if \(at\.toDateString\(\) === now\.toDateString\(\)\) return `today at \$\{time\}`;/);
  assert.match(when, /return `yesterday at \$\{time\}`;/);
  assert.match(when, /toLocaleDateString\("en-GH", \{ day: "numeric", month: "short" \}\)\} at \$\{time\}`/);

  // Signing out is reversible and says so; reporting it lost is not, and says that.
  assert.match(source, /"It will be signed out straight away\. Signing in again on it will need a code sent to your number\."/);
  assert.match(source, /"It will be signed out and blocked from signing in again\. Only support can undo this\."/);
  assert.match(source, /style: destructiveConfirmStyle,/);
  assert.match(source, /onPress: \(\) => void act\(device, `\/me\/devices\/\$\{device\.id\}\/`, "DELETE"\),/);
  assert.match(source, /onPress: \(\) => void act\(device, `\/me\/devices\/\$\{device\.id\}\/block\/`, "POST"\),/);
});

test("what to watch for is a note, not a page of prose", () => {
  const source = security();
  assert.match(source, /number\.\{status\?\.stolen_device_reporting_enabled \? " Reporting it lost or stolen stops it signing in at all\." : ""\}/);
  assert.match(source, /<GroupLabel>Keeping your account safe<\/GroupLabel>/);
  assert.match(source, /<Type variant="bodyStrong" style=\{styles\.adviceTitle\}>Danpa HQ never asks for your code<\/Type>/);
  assert.match(source, /<Type variant="bodyStrong" style=\{styles\.adviceTitle\}>A number change pauses payouts<\/Type>/);
  assert.match(source, /<Pill label="Sign out" icon="log-out-outline" tone="quiet" onPress=\{signOut\} \/>/);
  assert.match(between(source, "function DevicesSkeleton(", "function lastUsed("), /accessibilityRole="progressbar" accessibilityLabel="Loading your devices"/);
  assert.match(source, /\{error \? <Notice tone="error" title=\{error\} \/> : null\}/);
});

test("each setting saves on its own, and a refusal puts the switch back", () => {
  const source = settings();
  assert.match(source, /setPreferences\(\{ \.\.\.preferences, \[key\]: value \}\);/);
  assert.match(source, /setPreferences\(await updateNotificationPreferences\(\{ \[key\]: value \}\)\);/);
  assert.match(source, /setPreferences\(previous\);/);
  assert.match(source, /setError\(cause instanceof ApiFailure \? cause\.error\.message : "That setting did not save\."\);/);
  assert.match(source, /<GroupLabel>What Danpa HQ may send<\/GroupLabel>/);
  assert.match(source, /<Footnote>Decisions always appear in Updates\. These control what else is sent\.<\/Footnote>/);
  assert.match(source, /\{!preferences && !error \? <PreferencesSkeleton \/> : null\}/);
  assert.match(between(source, "function PreferencesSkeleton(", "const styles = StyleSheet.create("), /accessibilityRole="progressbar" accessibilityLabel="Loading your notification settings"/);
  assert.match(source, /<IndexGround>/);
  assert.doesNotMatch(source, /variant="display2"|>SETTINGS</);
});

test("the narrowing sits under the switch it depends on", () => {
  const source = settings();
  const toggle = between(source, "function Toggle(", "function PreferencesSkeleton(");

  assert.match(source, /<Toggle\s+nested\s+icon="star-outline"\s+label="Only important texts"/);
  assert.match(source, /disabled=\{!preferences\.sms_enabled\}/);
  assert.match(toggle, /<View style=\{\[styles\.row, nested \? styles\.nested : null, disabled \? styles\.dim : null\]\}>/);
  assert.match(toggle, /\{nested \? <View style=\{styles\.rail\} \/> : \(/);
  assert.match(toggle, /\{busy \? <ActivityIndicator size="small" color=\{KOLA\} \/> : null\}/);
  assert.match(toggle, /accessibilityLabel=\{label\}/);
  assert.match(toggle, /trackColor=\{\{ true: theme\.color\.kola\["600"\], false: theme\.color\.field\["300"\] \}\}/);
  assert.match(toggle, /disabled=\{disabled \|\| busy\}/);
  assert.match(source, /nested: \{\s*paddingLeft: 26,/);
  assert.match(source, /rail: \{[\s\S]{0,200}borderBottomLeftRadius: 8,/);
});
