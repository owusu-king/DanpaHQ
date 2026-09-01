import test from "node:test";
import assert from "node:assert/strict";

import { safeInternalPath } from "./safeRedirect.compiled.mjs";

test("an application return path stays inside the site", () => {
  assert.equal(safeInternalPath("/apply/listing-id"), "/apply/listing-id");
  assert.equal(safeInternalPath("/applications?open=true"), "/applications?open=true");
});

test("external and protocol-relative return paths are refused", () => {
  assert.equal(safeInternalPath("https://example.com/steal-session"), null);
  assert.equal(safeInternalPath("//example.com/steal-session"), null);
  assert.equal(safeInternalPath(null), null);
});
