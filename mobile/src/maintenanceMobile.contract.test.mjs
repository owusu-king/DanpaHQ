import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const report = () => read("app/(app)/maintenance-report.tsx");
const record = () => read("app/(app)/maintenance-request.tsx");
const list = () => read("app/(app)/maintenance.tsx");
const trimmer = () => read("src/components/maintenance/ClipTrimmer.tsx");
const parts = () => read("src/components/maintenance/MaintenanceParts.tsx");
const api = () => read("src/maintenance.ts");

test("mobile and web agree on the clip limit and what each stage is called", () => {
  const web = read("../web/src/lib/maintenance.ts");
  assert.match(api(), /export const MAX_CLIP_MS = 5000;/);
  assert.match(web, /export const MAX_CLIP_MS = 5000;/);
  for (const words of ['"Confirm the fix" : "Waiting for tenant"', 'submitted: side === "tenant" ? "Sent" : "New"']) {
    assert.ok(api().includes(words), `mobile lost: ${words}`);
    assert.ok(web.includes(words), `web lost: ${words}`);
  }
});

test("a report carries exactly one required photo, from the camera or the library", () => {
  const source = report();
  assert.match(source, /if \(!tenancyId \|\| !category \|\| !photo \|\| missing\.description\) return;/);
  assert.match(source, /<GroupLabel>Photo · required, one<\/GroupLabel>/);
  assert.match(source, /ImagePicker\.launchCameraAsync\(options\)/);
  assert.match(source, /ImagePicker\.launchImageLibraryAsync\(options\)/);
  assert.match(source, /uploadImage\(photo, "maintenance_photo"\)/);
});

test("a clip is optional, recorded to five seconds, and a longer one is trimmed", () => {
  const source = report();
  assert.match(source, /<GroupLabel>Video · optional, up to 5 seconds<\/GroupLabel>/);
  assert.match(source, /videoMaxDuration: MAX_CLIP_MS \/ 1000/);
  // iOS's own library trimmer, held to the same five seconds.
  assert.match(source, /allowsEditing: source === "library" && isIOS/);
  // Whatever arrives longer — an Android library video, a camera app that
  // ignored the limit — goes to the trimmer, never straight up.
  assert.match(source, /if \(durationMs > MAX_CLIP_MS\) setTrimming\(next\);/);
  // The window travels with the upload; the backend holds it to five seconds.
  assert.match(source, /video_clip_start_ms: clip\?\.window\?\.startMs \?\? null/);
  assert.match(source, /video_clip_end_ms: clip\?\.window\?\.endMs \?\? null/);
  assert.match(trimmer(), /const span = Math\.min\(MAX_CLIP_MS, durationMs\);/);
  assert.match(trimmer(), /onDone\(\{ startMs, endMs \}\)/);
  // A drag strip claims the touch at its start and keeps it (the rent range does).
  assert.match(trimmer(), /onStartShouldSetPanResponder: \(\) => true/);
  assert.match(trimmer(), /onPanResponderTerminationRequest: \(\) => false/);
  assert.match(trimmer(), /accessibilityRole="adjustable"/);
  // Over the server's cap is refused on the phone, before any upload starts.
  assert.match(source, /const MAX_VIDEO_BYTES = 30 \* 1024 \* 1024;/);
});

test("a windowed clip plays only its five seconds", () => {
  assert.match(parts(), /if \(currentTime >= endMs \/ 1000 \|\| currentTime < startMs \/ 1000 - 0\.25\)/);
  assert.match(record(), /<ClipPlayer uri=\{request\.video\.url\} startMs=\{request\.video_clip_start_ms\} endMs=\{request\.video_clip_end_ms\} \/>/);
});

test("the record offers only what the server permits, two acts at most", () => {
  const source = record();
  assert.match(source, /const can = request\.permissions \?\?/);
  assert.match(source, /if \(can\.start\) return <Pill/);
  assert.match(source, /if \(can\.report_fixed\) return <Pill/);
  assert.match(source, /can\.confirm \? <Pill grow icon="checkmark-circle-outline" label="Yes, it’s fixed"/);
  assert.match(source, /can\.reopen \? <QuietAct label="Not fixed"/);
  assert.match(source, /disabled=\{writing === "reopen" && !words\.trim\(\)\}/);
  // Notes are written on the page, not in a sheet over it.
  assert.doesNotMatch(source, /<BottomSheet/);
});

test("every way in leads to the real screens", () => {
  assert.match(read("app/(app)/_layout.tsx"), /name="maintenance-report" options=\{\{ title: "Report a problem" \}\}/);
  assert.match(read("app/(app)/tenancy.tsx"), /pathname: "\/\(app\)\/maintenance-report", params: \{ tenancy: tenancy\.id \}/);
  assert.match(read("src/notificationMeaning.ts"), /case "maintenance_request":\s*return \{ pathname: "\/\(app\)\/maintenance-request", params: \{ id: item\.target_id \} \};/);
  assert.match(read("src/serviceCatalogue.ts"), /route: "\/\(app\)\/maintenance",/);
  // Provider new work oldest first: what has waited longest is what to start.
  assert.match(list(), /side === "provider" && stage === "new"\s*\? a\.status_changed_at\.localeCompare\(b\.status_changed_at\)/);
});
