import { View } from "react-native";

import type { PortfolioBilling, RestrictedResource } from "@/billing";
import { accessStatusOf, allowanceLine } from "@/billingPresentation";
import { SectionTitle, StatusBadge } from "@/components/billing/BillingParts";
import { Button, Type, space } from "@/components/ui";
import { theme } from "@/theme";

/**
 * What this Portfolio holds above its plan's allowance, and the way back.
 *
 * The web's section, stacked for a phone. Restricted is not removed: every row
 * keeps its records, and one winding down keeps its running tenancies to their
 * end. Reactivating is the deliberate step an upgrade or a freed place makes
 * possible — the button appears only where the server says there is room, and
 * the server decides again when it is pressed.
 */
export function RestrictedResources({
  billing,
  busyId,
  onReactivate,
}: {
  billing: PortfolioBilling;
  busyId: string | null;
  onReactivate: (resource: RestrictedResource) => void;
}) {
  const access = billing.resource_access;
  if (!access?.restricted.length) return null;

  const room = { property: access.properties.available, unit: access.units.available };
  const hasRoom = (kind: RestrictedResource["kind"]) => room[kind] === null || (room[kind] ?? 0) > 0;
  const canChange = billing.viewer.can_change_plan;
  const anyRoom = access.restricted.some((resource) => hasRoom(resource.kind));

  return (
    <View style={{ gap: space[2] }}>
      <SectionTitle>{"Above your plan's limits"}</SectionTitle>
      <Type variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
        {allowanceLine(access.properties, "Properties")} · {allowanceLine(access.units, "Units")}
      </Type>
      <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
        {access.restricted.map((resource) => {
          const status = accessStatusOf(resource.state);
          return (
            <View
              key={`${resource.kind}:${resource.id}`}
              style={{ gap: space[3], paddingVertical: space[4], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Type variant="bodyStrong">
                    {resource.name}
                    {resource.kind === "unit" ? (
                      <Type variant="body" style={{ color: theme.color.ink["500"] }}>{` · ${resource.property_name}`}</Type>
                    ) : null}
                  </Type>
                  <Type variant="caption">
                    {resource.state === "wind_down"
                      ? "Existing tenancies continue · no new rental activity"
                      : "Records stay available · no new rental activity"}
                  </Type>
                </View>
                <StatusBadge tone={status.tone} label={status.label} />
              </View>
              {canChange && hasRoom(resource.kind) ? (
                <Button
                  label="Reactivate"
                  variant="secondary"
                  busy={busyId === resource.id}
                  busyLabel="Reactivating…"
                  disabled={busyId !== null}
                  onPress={() => onReactivate(resource)}
                />
              ) : null}
            </View>
          );
        })}
      </View>
      {canChange && !anyRoom ? (
        <Type variant="caption">To reactivate one, upgrade — or archive something that is fully active to free its place.</Type>
      ) : null}
    </View>
  );
}
