import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const helper = readFileSync(new URL("./photoUpload.ts", import.meta.url), "utf8");
const provider = readFileSync(new URL("./provider.ts", import.meta.url), "utf8");

test("mobile photo uploads are compressed before reserve and use actual byte count", () => {
  assert.match(helper, /await import\("expo-image-manipulator"\)/);
  assert.match(helper, /ImageManipulator\.manipulate\(asset\.uri\)/);
  assert.match(helper, /blob\.size > 0 && blob\.size <= PILOT_SCAN_MAX_BYTES/);
  assert.match(helper, /DOCUMENT_PURPOSES\.has\(purpose\) \? TARGET_LONG_EDGES\.slice\(0, 2\)/);
  assert.match(provider, /await preparePhotoUpload\(asset, mime, filename, purpose\)/);
  assert.match(provider, /size_bytes: prepared\.blob\.size/);
  assert.match(provider, /uri: prepared\.uri/);
});
