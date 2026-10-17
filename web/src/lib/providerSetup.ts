/**
 * What a provider's next step actually is, before they can add a property.
 *
 * Provider approval is the only prerequisite, and it is the whole of it:
 *
 * 1. the account is approved to operate  (`can_create_property`)
 * 2. that approval provisions the one Portfolio the account will ever own
 * 3. the Property is filed into it — there is nothing to set up, ever
 */

export type NextStep = {
  label: string;
  href: string;
  /** Why this is the step, for the empty state that sits under it. */
  reason: string;
};

export function propertyNextStep({
  canCreateProperty,
  hasWorkspace,
  organizationId = "",
}: {
  canCreateProperty: boolean;
  hasWorkspace: boolean;
  organizationId?: string;
}): NextStep {
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
      href: "/record/property-new",
      reason:
        "Danpa HQ files it into your Portfolio — the one your account was given when it was approved. You can rename it or add a Team later.",
    };
  }

  return {
    label: "Create property",
    href: organizationId
      ? `/record/property-new?organization=${encodeURIComponent(organizationId)}`
      : "/record/property-new",
    reason:
      "Six steps — the property, its details, its documents, its photographs and "
      + "what the compound has. Nothing is sent to anybody until you ask for it.",
  };
}
