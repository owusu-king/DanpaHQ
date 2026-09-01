/* Test-only JS mirror of providerSetup.ts, kept in step by
   src/lib/providerSetup.test.mjs. Node runs .mjs with no build step;
   providerSetup.ts is the file that ships. */

export function propertyNextStep({ canCreateProperty, hasWorkspace, organizationId = "" }) {
  if (!canCreateProperty) {
    return {
      label: "See your verification status",
      href: "/provider",
      reason:
        "Adding a property becomes available once your provider verification is approved.",
    };
  }

  if (!hasWorkspace) {
    return {
      label: "Create property",
      href: "/properties/new",
      reason:
        "Your personal Portfolio will be created automatically with this first Property. You can rename it or add a Team later.",
    };
  }

  return {
    label: "Create property",
    href: organizationId
      ? `/properties/new?organization=${encodeURIComponent(organizationId)}`
      : "/properties/new",
    reason:
      "Six steps — the property, its details, its documents, its photographs and "
      + "what the compound has. Nothing is sent to anybody until you ask for it.",
  };
}
