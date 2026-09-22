import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { EDGE, INK, KOLA, MUTED, RecordPanel } from "@/components/record/RecordSurfaces";
import { Type, space } from "@/components/ui";
import type { ManagedProperty, PortfolioMember } from "@/organizations";
import { isAndroid, pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * The vocabulary Team uses on both of its screens.
 *
 * Kept out of the route files because expo-router owns everything under `app/`,
 * and because the roster and the member screen have to describe a role the same
 * way — a person reading "Property manager" in the list and something else after
 * opening them would be two answers to one question.
 *
 * The controls live here for the same reason. Granting access and changing it
 * are the same decision met twice, so the invitation sheet and the member
 * screen offer it with one set of rows rather than each rolling its own.
 */

export const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Administrator" },
  { value: "property_manager", label: "Property manager" },
  { value: "accountant", label: "Accountant" },
  { value: "staff", label: "Staff" },
] as const;

/**
 * The roles a Team screen may actually hand out.
 *
 * Owner is absent, and not because the backend would refuse it — though it
 * does. An owner carries the Portfolio's standing to operate, its plan and the
 * account its rent settles into; that moves through its own deliberate
 * transfer, never as a line in an invitation form. `ROLES` keeps it so an
 * existing owner still reads as "Owner" everywhere.
 */
export const GRANTABLE_ROLES = ROLES.filter((role) => role.value !== "owner");

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

/**
 * What a membership is waiting on, if anything — the server's own answer.
 *
 * A role that is in place but not yet whole has to say so. Somebody who reads
 * "Administrator" and then finds the Team controls refused concludes the
 * product is broken; "Administrator · verification needed" is the same fact
 * before they meet it.
 */
export function accessStateLabel(member: PortfolioMember): string {
  switch (member.access?.state) {
    case "pending_verification":
      return "verification needed";
    case "limited":
      return "limited";
    case "revoked":
      return "access ended";
    default:
      return "";
  }
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

/**
 * One choice in a panel of them.
 *
 * A radio when the answers are exclusive and a checkbox when they are not —
 * said in the accessibility state as well as in the mark, because a tick drawn
 * inside a label is invisible to a screen reader.
 */
function PickRow({
  first,
  mode,
  label,
  detail,
  selected,
  disabled = false,
  onPress,
}: {
  first: boolean;
  mode: "radio" | "check";
  label: string;
  detail?: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const radio = mode === "radio";
  return (
    <Pressable
      accessibilityRole={radio ? "radio" : "checkbox"}
      aria-selected={radio ? selected : undefined}
      aria-checked={radio ? undefined : selected}
      aria-disabled={disabled}
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      disabled={disabled}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["100"])}
      style={({ pressed }) => [
        styles.pick,
        first ? null : styles.ruled,
        selected ? styles.pickOn : null,
        disabled ? styles.dim : null,
        pressed && !isAndroid ? { backgroundColor: theme.color.field["100"] } : null,
      ]}
    >
      <Ionicons
        name={radio
          ? (selected ? "radio-button-on" : "radio-button-off")
          : (selected ? "checkbox" : "square-outline")}
        size={19}
        color={selected ? KOLA : theme.color.ink["300"]}
        style={styles.mark}
      />
      <View style={styles.pickBody}>
        <Type variant={selected ? "bodyStrong" : "body"} numberOfLines={1} style={styles.pickLabel}>{label}</Type>
        {detail ? <Type variant="caption" numberOfLines={2} style={styles.pickDetail}>{detail}</Type> : null}
      </View>
    </Pressable>
  );
}

/**
 * Which role somebody holds.
 *
 * Each role carries its own consequence on its own row, so what it means is
 * read while choosing rather than in a sentence underneath afterwards.
 */
export function RoleChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (role: string) => void;
  disabled?: boolean;
}) {
  return (
    <RecordPanel>
      <View accessibilityRole="radiogroup" accessibilityLabel="Role">
        {GRANTABLE_ROLES.map((role, index) => (
          <PickRow
            key={role.value}
            first={index === 0}
            mode="radio"
            label={role.label}
            detail={roleConsequence(role.value)}
            selected={value === role.value}
            disabled={disabled}
            onPress={() => onChange(role.value)}
          />
        ))}
      </View>
    </RecordPanel>
  );
}

/** Which Properties a scoped role may touch. */
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
    return (
      <RecordPanel>
        <View style={styles.empty}>
          <Type variant="caption" style={styles.emptyText}>
            No Property is in this Portfolio yet, so there is nothing to assign.
          </Type>
        </View>
      </RecordPanel>
    );
  }
  return (
    <RecordPanel>
      {properties.map((property, index) => (
        <PickRow
          key={property.id}
          first={index === 0}
          mode="check"
          label={property.title}
          selected={selected.includes(property.id)}
          disabled={disabled}
          onPress={() => onToggle(property.id)}
        />
      ))}
    </RecordPanel>
  );
}

const styles = StyleSheet.create({
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  pick: {
    minHeight: 60,
    flexDirection: "row",
    // Against the label, not the middle of a three-line row: a mark floating
    // beside the second line does not read as belonging to the first.
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  mark: {
    marginTop: 1,
  },
  pickOn: {
    backgroundColor: theme.color.kola["50"],
  },
  dim: {
    opacity: 0.5,
  },
  pickBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  pickLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  pickDetail: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  empty: {
    padding: 14,
  },
  emptyText: {
    color: MUTED,
  },
});
