import assert from "node:assert/strict";
import test from "node:test";

import {
  ORGANIZATION_ACTIVITY_OPTIONS,
  toggleOrganizationActivity,
} from "./organizationSetup.compiled.mjs";

test("Portfolio setup offers every canonical property activity", () => {
  assert.deepEqual(
    ORGANIZATION_ACTIVITY_OPTIONS.map((option) => option.value),
    ["residential", "commercial", "hostel"],
  );
});

test("commercial selection is included in and removable from the Portfolio payload", () => {
  const selected = toggleOrganizationActivity(["residential"], "commercial");
  assert.deepEqual(selected, ["residential", "commercial"]);
  assert.deepEqual(toggleOrganizationActivity(selected, "commercial"), ["residential"]);
});
