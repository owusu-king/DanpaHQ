import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { PILOT_SCAN_MAX_BYTES, preparePhotoUpload } from "./preparePhotoUpload.ts";

const previousBitmap = globalThis.createImageBitmap;
const previousDocument = globalThis.document;

afterEach(() => {
  globalThis.createImageBitmap = previousBitmap;
  globalThis.document = previousDocument;
});

test("keeps an already-small upload byte-for-byte", async () => {
  const file = new File(["original"], "receipt.png", { type: "image/png" });
  assert.equal(await preparePhotoUpload(file, "payment_evidence"), file);
});

test("refuses an oversized PDF without trying to decode it as a photo", async () => {
  const file = new File([new Uint8Array(PILOT_SCAN_MAX_BYTES + 1)], "agreement.pdf", { type: "application/pdf" });
  await assert.rejects(preparePhotoUpload(file, "identity_document"), /smaller PDF or video/);
});

test("compresses an oversized photo, preserving a bounded image dimension", async () => {
  let closed = false;
  let drawnWidth = 0;
  globalThis.createImageBitmap = async () => ({
    width: 4000,
    height: 3000,
    close() { closed = true; },
  });
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillRect() {},
            drawImage(_image, _x, _y, width) { drawnWidth = width; },
          };
        },
        toBlob(callback) { callback(new Blob(["compressed"], { type: "image/jpeg" })); },
      };
    },
  };
  const file = new File([new Uint8Array(PILOT_SCAN_MAX_BYTES + 1)], "ghana-card.png", { type: "image/png" });
  const prepared = await preparePhotoUpload(file, "identity_document");
  assert.equal(prepared.name, "ghana-card.jpg");
  assert.equal(prepared.type, "image/jpeg");
  assert.ok(prepared.size <= PILOT_SCAN_MAX_BYTES);
  assert.equal(drawnWidth, 2400);
  assert.equal(closed, true);
});

test("rejects an image that cannot be reduced enough without further downscaling", async () => {
  let closed = false;
  let finalWidth = 0;
  globalThis.createImageBitmap = async () => ({
    width: 4000,
    height: 3000,
    close() { closed = true; },
  });
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() { return { fillRect() {}, drawImage(_image, _x, _y, width) { finalWidth = width; } }; },
        toBlob(callback) { callback(new Blob([new Uint8Array(PILOT_SCAN_MAX_BYTES + 1)])); },
      };
    },
  };
  const file = new File([new Uint8Array(PILOT_SCAN_MAX_BYTES + 1)], "card.jpg", { type: "image/jpeg" });
  await assert.rejects(preparePhotoUpload(file, "identity_document"), /cannot fit under 3.5 MB/);
  assert.equal(finalWidth, 2000);
  assert.equal(closed, true);
});
