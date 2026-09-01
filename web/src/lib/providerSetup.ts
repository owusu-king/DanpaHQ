/**
 * What a provider's next step actually is, before they can add a property.
 *
 * Provider approval is the only prerequisite an individual must handle first:
 *
 * 1. the account is approved to operate  (`can_create_property`)
 * 2. their first Property creates a personal Portfolio automatically
 * 3. an explicit Portfolio setup remains available for a business or team
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
