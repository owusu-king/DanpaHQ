import { useState } from "react";
import { StyleSheet, View } from "react-native";

import type { PortfolioBilling, RestrictedResource } from "@/billing";
import { accessStatusOf, allowanceLine } from "@/billingPresentation";
import { PREVIEW, Panel, SheetList, SmallAct, ToneWord, ViewAll } from "@/components/billing/BillingSurfaces";
import { GroupLabel, INK, MUTED, RULE } from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Type, space } from "@/components/ui";

/**
 * What this Portfolio holds above its plan's allowance, and the way back.
 *
 * Restricted is not removed: every row keeps its records, and one winding down
 * keeps its running tenancies to their end. Reactivating is the deliberate step
 * an upgrade or a freed place makes possible — the act appears only where the
 * server says there is room, and the server decides again when it is pressed.
 *
 * Refined on review (2026-09-15): the allowance in one line, the first few
 * places, and every one of them — with the same way back — in the shared sheet.
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
  const [all, setAll] = useState(false);
  const access = billing.resource_access;
  if (!access?.restricted.length) return null;

  const room = { property: access.properties.available, unit: access.units.available };
  const hasRoom = (kind: RestrictedResource["kind"]) => room[kind] === null || (room[kind] ?? 0) > 0;
  const canChange = billing.viewer.can_change_plan;
  const anyRoom = access.restricted.some((resource) => hasRoom(resource.kind));
  const shown = access.restricted.slice(0, PREVIEW.restricted);
  const allowance = `${allowanceLine(access.properties, "Properties")} · ${allowanceLine(access.units, "Units")}`;

  const row = (resource: RestrictedResource, index: number) => {
    const status = accessStatusOf(resource.state);
    return (
      <View key={`${resource.kind}:${resource.id}`} style={[styles.row, index ? styles.ruled : null]}>
        <View style={styles.rowText}>
          <Type variant="bodyStrong" numberOfLines={1} style={styles.name}>
            {resource.name}
            {resource.kind === "unit" ? (
              <Type variant="body" style={styles.property}>{` · ${resource.property_name}`}</Type>
            ) : null}
          </Type>
          <Type variant="caption" style={styles.detail}>
            {resource.state === "wind_down"
              ? "Existing tenancies continue · no new rental activity"
              : "Records stay available · no new rental activity"}
          </Type>
        </View>
        <View style={styles.rowEnd}>
          <ToneWord tone={status.tone} label={status.label} />
          {canChange && hasRoom(resource.kind) ? (
            <SmallAct
              label="Reactivate"
              busy={busyId === resource.id}
              busyLabel="Reactivating…"
              disabled={busyId !== null}
              onPress={() => onReactivate(resource)}
            />
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <>
      <View style={styles.section}>
        <GroupLabel count={access.restricted.length}>{"Above your plan's limits"}</GroupLabel>
        <Panel>
          <Type variant="caption" style={styles.allowance}>{allowance}</Type>
          {shown.map((resource, index) => row(resource, index + 1))}
          {access.restricted.length > PREVIEW.restricted ? (
            <ViewAll count={access.restricted.length} noun="restricted" onPress={() => setAll(true)} />
          ) : null}
        </Panel>
        {canChange && !anyRoom ? (
          <Type variant="caption" style={styles.hint}>
            To reactivate one, upgrade — or archive something that is fully active to free its place.
          </Type>
        ) : null}
      </View>
      <BottomSheet visible={all} onClose={() => setAll(false)} title="Above your plan's limits" closeLabel="Close restricted list">
        <SheetList summary={allowance}>
          {access.restricted.map((resource, index) => row(resource, index))}
        </SheetList>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space[2],
  },
  allowance: {
    paddingVertical: space[3],
    paddingHorizontal: 14,
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
    fontVariant: ["tabular-nums"],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  property: {
    color: MUTED,
  },
  detail: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  rowEnd: {
    alignItems: "flex-end",
    gap: space[2],
  },
  hint: {
    paddingHorizontal: space[1],
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
});
