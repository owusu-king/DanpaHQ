import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("mobile tenant displays one locally rendered QR and fallback code", () => {
  const tenant = read("mobile/app/(app)/viewing-check-in.tsx");
  assert.match(tenant, /react-native-qrcode-svg/);
  assert.match(tenant, /value=\{credential\.qr_payload\}/);
  assert.match(tenant, /credential\.code\.slice/);
  assert.match(tenant, /Expires at/);
});

test("provider scan and manual code share the server validation function", () => {
  const provider = read("mobile/app/(app)/provider-viewing-check-in.tsx");
  const viewing = read("mobile/app/(app)/provider-viewing.tsx");

  assert.match(provider, /CameraView/);
  assert.match(provider, /validate\(\{ credential: data \}\)/);
  assert.match(provider, /validate\(\{ code \}\)/);
  assert.match(provider, /validateViewingCheckIn\(viewingId, input\)/);
  assert.match(viewing, /viewing\.status === "checked_in"/);
  assert.doesNotMatch(viewing, /viewing_fee/);
});
