import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, "../..", path), "utf8");
// Read raw: a block-comment stripper takes the `/*` inside `accept="image/*"`
// for a comment and swallows the code after it. Every assertion below matches
// a code shape that the comments in these files do not contain.
const page = () => read("app/maintenance/page.tsx");
const report = () => read("src/components/maintenance/ReportSheet.tsx");
const record = () => read("src/components/maintenance/MaintenanceRecord.tsx");
const clip = () => read("src/lib/videoClip.ts");
const api = () => read("src/lib/maintenance.ts");

test("a report carries exactly one required photo, taken or uploaded", () => {
  const body = report();
  // Sending is refused without it, and the field says so.
  assert.match(body, /photo: !photo/);
  assert.match(body, /if \(!ready \|\| !photo \|\| !category\) return;/);
  assert.match(body, /Photo <em>Required · one<\/em>/);
  // Camera capture and a plain upload, both into the one slot.
  assert.match(body, /accept="image\/\*" capture="environment"/);
  assert.match(body, /accept="image\/jpeg,image\/png,image\/webp,image\/heic"/);
  // Through the product's own checked upload pipeline, under its own purpose.
  assert.match(body, /uploadFile\(photo\.file, "maintenance_photo"\)/);
  assert.match(body, /photo_file_id: storedPhoto\.id/);
});

test("a clip is optional and never longer than five seconds", () => {
  const body = report();
  assert.match(api(), /export const MAX_CLIP_MS = 5000;/);
  assert.match(body, /Video <em>Optional · up to 5 seconds<\/em>/);
  // Recording in the sheet stops itself at the limit.
  assert.match(body, /if \(ms >= MAX_CLIP_MS\) \{[\s\S]{0,120}media\.stop\(\)/);
  // A longer upload goes to the trimmer, which cuts the window on the device.
  assert.match(body, /if \(durationMs > MAX_CLIP_MS\) setClipStep\(\{ trim: file, durationMs \}\)/);
  assert.match(body, /const span = Math\.min\(MAX_CLIP_MS, durationMs\);/);
  assert.match(body, /await cutClip\(source, startMs, endMs, setCutting\)/);
  assert.match(clip(), /const length = Math\.min\(endMs - startMs, MAX_CLIP_MS\);/);
  // The clip goes up as its own purpose, with its measured length.
  assert.match(body, /uploadFile\(clip\.file, "maintenance_video"\)/);
  assert.match(body, /video_duration_ms: clip\?\.durationMs \?\? null/);
  // Trimming and recording are steps of the one form, not dialogs over it.
  assert.equal((body.match(/<ModalSheet\b/g) ?? []).length, 1);
});

test("what each side may do comes from the server, two buttons at most", () => {
  const body = record();
  assert.match(body, /const can = request\.permissions \?\?/);
  assert.match(body, /if \(can\.start\)/);
  assert.match(body, /if \(can\.report_fixed\)/);
  assert.match(body, /can\.confirm \? <Button[\s\S]{0,120}Yes, it’s fixed/);
  assert.match(body, /can\.reopen \? <Button variant="quiet"[\s\S]{0,120}Not fixed/);
  // Reopening must say what is still wrong.
  assert.match(body, /disabled=\{writing === "reopen" && !words\.trim\(\)\}/);
  for (const block of body.split(/<div className="rq-actions">/).slice(1)) {
    const foot = block.slice(0, block.indexOf("</div>"));
    assert.ok((foot.match(/<Button\b/g) ?? []).length <= 2, "a foot never holds more than two buttons");
  }
  // One sheet; nothing stacked on it.
  assert.equal((body.match(/<ModalSheet\b/g) ?? []).length, 1);
});

test("a windowed clip plays only its five seconds", () => {
  const body = record();
  assert.match(body, /<ClipPlayer[\s\S]{0,160}startMs=\{request\.video_clip_start_ms\}[\s\S]{0,80}endMs=\{request\.video_clip_end_ms\}/);
  assert.match(body, /if \(video\.currentTime >= endMs! \/ 1000/);
});

test("both sides reach it, and a notification lands on the request", () => {
  const nav = read("src/lib/portalNav.ts");
  assert.match(nav, /href: "\/maintenance", label: "Maintenance", icon: "wrench", hint: "Repairs your tenants report"/);
  assert.match(nav, /href: "\/maintenance", label: "Maintenance", icon: "wrench", hint: "Report a problem where you live"/);
  assert.match(nav, /"\/maintenance",\n/);
  assert.match(read("src/lib/notificationMeaning.ts"), /case "maintenance_request":\s*return `\/maintenance\?request=\$\{item\.target_id\}`;/);
  // The address keeps the open request and a report in progress.
  assert.match(page(), /search\.get\("request"\)/);
  assert.match(page(), /search\.get\("report"\)/);
  // A provider reads their Portfolio's requests; a tenant their own.
  assert.match(page(), /listOrganizationMaintenance\(organizationId\)/);
  assert.match(page(), /listMyMaintenance\(\)/);
  // A tenant reports from their home's own page too, already on it.
  assert.match(read("app/tenancies/[id]/page.tsx"), /href=\{`\/maintenance\?report=\$\{tenancy\.id\}` as never\}/);
});
