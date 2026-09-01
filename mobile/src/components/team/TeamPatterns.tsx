import { View } from "react-native";

import { Button, Type, space } from "@/components/ui";
import type { ManagedProperty, PortfolioMember } from "@/organizations";

/**
 * The vocabulary Team uses on both of its screens.
 *
 * Kept out of the route files because expo-router owns everything under `app/`,
 * and because the roster and the member screen have to describe a role the same
 * way — a person reading "Property manager" in the list and something else after
 * opening them would be two answers to one question.
 */

export const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Administrator" },
  { value: "property_manager", label: "Property manager" },
  { value: "accountant", label: "Accountant" },
  { value: "staff", label: "Staff" },
] as const;

const SCOPED_ROLES = ["property_manager", "accountant", "staff"];

/** Roles whose reach is decided by Property assignment rather than the Portfolio. */
export const isScoped = (role: string) => SCOPED_ROLES.includes(role);

export function roleLabel(role: string) {
  return ROLES.find((row) => row.value === role)?.label ?? role.replaceAll("_", " ");
}

export function roleArticle(role: string) {
  const label = roleLabel(role).toLocaleLowerCase("en-GH");
  return /^[aeiou]/.test(label) ? `an ${label}` : `a ${label}`;
}

/** What the role means, stated as the consequence the person will feel. */
export function roleConsequence(role: string) {
  return role === "owner"
    ? "Sees and manages every Property in this Portfolio, and can change anyone's access."
    : role === "admin"
      ? "Sees and manages every Property in this Portfolio, and can manage the Team."
      : role === "accountant"
        ? "Reads rent and payment records for the Properties you assign. No Property management."
        : role === "property_manager"
          ? "Manages only the Properties you assign, including tenants and lettings."
          : "Operates only the Properties you assign, without Team or high-trust actions.";
}

/** The server's effective access, said in the roster's voice. */
export function accessLabel(member: PortfolioMember) {
  if (member.effective_access === "portfolio_wide") return "every Property";
  const count = member.assigned_properties.length;
  if (member.effective_access === "assigned_financial") {
    return count ? `${count} assigned · financial` : "financial · nothing assigned";
  }
  return count ? `${count} assigned ${count === 1 ? "Property" : "Properties"}` : "nothing assigned yet";
}

export function PropertyScope({
  properties,
  selected,
  onToggle,
  disabled = false,
}: {
  properties: ManagedProperty[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  if (properties.length === 0) {
    return <Type variant="caption">No Property is in this Portfolio yet, so there is nothing to assign.</Type>;
  }
  return (
    <View style={{ gap: space[2] }}>
      <Type variant="caption">Assigned Properties</Type>
      {properties.map((property) => (
        <Button
          key={property.id}
          label={property.title}
          variant="secondary"
          disabled={disabled}
          selected={selected.includes(property.id)}
          onPress={() => onToggle(property.id)}
        />
      ))}
    </View>
  );
}
