/* Test-only JS mirror of providerSetup.ts, kept in step by
   src/lib/providerSetup.test.mjs. Node runs .mjs with no build step;
   providerSetup.ts is the file that ships. */

export function propertyNextStep({ canCreateProperty, hasWorkspace, organizationId = "" }) {
  if (!canCreateProperty) {
    return {
      label: "See your approval status",
      href: "/provider",
      reason:
        "Adding a property becomes available once your provider account is approved.",
    };
  }

  if (!hasWorkspace) {
    return {
      label: "Create property",
      href: "/record/property-new",
      reason: "",
    };
  }

  return {
    label: "Create property",
    href: organizationId
      ? `/record/property-new?organization=${encodeURIComponent(organizationId)}`
      : "/record/property-new",
    reason: "",
  };
}
