import assert from "node:assert/strict";
import test from "node:test";

import {
  describeBrowser,
  persistentDeviceFingerprint,
} from "./device.compiled.mjs";

test("the same browser profile keeps one installation id", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let generated = 0;
  const create = () => `device-${++generated}`;

  assert.equal(persistentDeviceFingerprint(storage, create), "device-1");
  assert.equal(persistentDeviceFingerprint(storage, create), "device-1");
  assert.equal(generated, 1);
});

test("disabled storage still keeps one id for the current page", () => {
  let generated = 0;
  const create = () => `memory-device-${++generated}`;

  assert.equal(persistentDeviceFingerprint(null, create), "memory-device-1");
  assert.equal(persistentDeviceFingerprint(null, create), "memory-device-1");
  assert.equal(generated, 1);
});

test("browser labels are useful rather than unknown", () => {
  assert.equal(
    describeBrowser("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"),
    "Chrome on Windows",
  );
  assert.equal(
    describeBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.5 Safari/605.1.15"),
    "Safari on macOS",
  );
  assert.equal(describeBrowser("unexpected-client"), "Web browser");
});
