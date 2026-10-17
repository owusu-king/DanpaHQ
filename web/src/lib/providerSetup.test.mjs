import test from "node:test";
import assert from "node:assert/strict";

import { propertyNextStep } from "./providerSetup.compiled.mjs";

/**
 * The reported bug: the web console offered "Add private property" to a
 * provider with no workspace, and the property form was where they found out.
 * Mobile has always named the real step on the button.
 */

test("no Portfolio means the first Property creates a personal one", () => {
  const step = propertyNextStep({ canCreateProperty: true, hasWorkspace: false });

  assert.equal(step.label, "Create property");
  assert.equal(step.href, "/record/property-new");
});

test("with a workspace, the step is the property itself", () => {
  const step = propertyNextStep({
    canCreateProperty: true, hasWorkspace: true, organizationId: "org-1",
  });

  assert.equal(step.label, "Create property");
  assert.equal(step.href, "/record/property-new?organization=org-1");
});

test("an unapproved provider is sent to the review, whatever else is true", () => {
  // Approval outranks the workspace: creating one changes nothing while the
  // review is outstanding, and the backend refuses the property either way.
  for (const hasWorkspace of [true, false]) {
    const step = propertyNextStep({ canCreateProperty: false, hasWorkspace });
    assert.equal(step.href, "/provider");
    assert.equal(step.label, "See your verification status");
  }
});

test("the organization id is url-encoded", () => {
  const step = propertyNextStep({
    canCreateProperty: true, hasWorkspace: true, organizationId: "a b&c",
  });

  assert.equal(step.href, "/record/property-new?organization=a%20b%26c");
});

test("a workspace with no id still reaches the form", () => {
  const step = propertyNextStep({ canCreateProperty: true, hasWorkspace: true });
  assert.equal(step.href, "/record/property-new");
});
