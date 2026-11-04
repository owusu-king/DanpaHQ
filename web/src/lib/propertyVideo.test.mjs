import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
const ts = createRequire(import.meta.url)("typescript");
const source = readFileSync(new URL("./propertyVideo.ts", import.meta.url), "utf8");
function load({ duration = 1000, failTransfer = false, failComplete = false, pending = false, scanFailed = false } = {}) {
  const calls = { reservations: 0, transfers: 0, completes: 0, releases: 0, purpose: "" };
  let state = scanFailed ? "uploaded" : "awaiting_upload";
  const payload = () => ({ id: "file-1", upload_status: state, is_usable: state === "ready", scan_status: scanFailed ? "failed" : "pending", rejection_reason: "" });
  const api = async (path, options = {}) => {
    if (path === "/files/uploads/") { calls.reservations++; calls.purpose = JSON.parse(options.body).purpose; return { file_id: "file-1", url: "https://storage.example.test/upload", method: "PUT" }; }
    if (path.endsWith("/complete/")) { calls.completes++; state = pending ? "uploaded" : "ready"; if (failComplete) { failComplete = false; throw new Error("Response lost"); } }
    return payload();
  };
  const transfer = async () => { calls.transfers++; if (failTransfer) { failTransfer = false; throw new Error("Offline"); } return { ok: true }; };
  const imports = {
    "./auth": { authedFetch: api }, "./api": { idempotentMutation: () => ({ idempotencyKey: "same-selection" }) },
    "./videoClip": { videoDuration: async () => duration },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: name => { assert.ok(name in imports, name); return imports[name]; }, File, Blob, FormData,
    fetch: transfer, setTimeout: callback => { callback(); return 0; },
  });
  return { ...exports, calls };
}
const FILE = new File(["video"], "video.mp4", { type: "video/mp4" });

test("validates duration, type and size before reserving storage", async () => {
  const valid = load({ duration: 10_000 });
  await valid.validateVideo(FILE);
  for (const duration of [0, 10_001, Infinity]) {
    const bad = load({ duration });
    await assert.rejects(bad.validateVideo(FILE));
    assert.equal(bad.calls.reservations, 0);
  }
  const bad = load();
  await assert.rejects(bad.validateVideo(new File(["x"], "photo.jpg", { type: "image/jpeg" })));
  await assert.rejects(bad.validateVideo(new File([new Uint8Array(bad.MAX_VIDEO_BYTES + 1)], "large.mp4", { type: "video/mp4" })));
});

test("a failed transfer retries the same reservation", async () => {
  const lib = load({ failTransfer: true });
  const upload = lib.videoUpload(FILE, "property");
  await assert.rejects(upload(), /Offline/);
  assert.equal(await upload(), "file-1");
  assert.equal(lib.calls.reservations, 1);
  assert.equal(lib.calls.transfers, 2);
  assert.equal(lib.calls.purpose, "property_video");
});

test("a lost completion response resumes without uploading or creating another record", async () => {
  const lib = load({ failComplete: true });
  const upload = lib.videoUpload(FILE, "unit");
  await assert.rejects(upload(), /Response lost/);
  assert.equal(await upload(), "file-1");
  assert.equal(lib.calls.reservations, 1);
  assert.equal(lib.calls.transfers, 1);
  assert.equal(lib.calls.completes, 1);
});

test("a pending scan offers retry without reuploading", async () => {
  const lib = load({ pending: true });
  const upload = lib.videoUpload(FILE, "unit");
  await assert.rejects(upload(), /still being checked/);
  await assert.rejects(upload(), /still being checked/);
  assert.equal(lib.calls.reservations, 1);
  assert.equal(lib.calls.transfers, 1);
  assert.equal(lib.calls.completes, 1);
});

test("failed scanning retries the same file without another transfer", async () => {
  const lib = load({ scanFailed: true });
  const upload = lib.videoUpload(FILE, "unit");
  assert.equal(await upload(), "file-1");
  assert.equal(lib.calls.reservations, 1);
  assert.equal(lib.calls.transfers, 0);
  assert.equal(lib.calls.completes, 1);
});
