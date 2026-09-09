import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("native credentials remain in Keychain or Keystore while Expo web has a safe boundary", () => {
  const nativeStore = read("mobile/src/secure.ts");
  const webStore = read("mobile/src/secure.web.ts");

  assert.match(nativeStore, /expo-secure-store/);
  assert.match(nativeStore, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.doesNotMatch(webStore, /expo-secure-store/);
  assert.match(webStore, /window\.sessionStorage/);
  assert.match(webStore, /const fallback = new Map/);
  assert.doesNotMatch(webStore, /localStorage/);
});
