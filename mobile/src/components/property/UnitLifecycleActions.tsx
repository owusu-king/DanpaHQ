import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { ApiFailure } from "@/api";
import { Pill, QuietAct, RecordPanel, StandingLine } from "@/components/record/RecordSurfaces";
import { Field, Notice, Type, space } from "@/components/ui";
import { archiveUnit, deleteUnit, type UnitDetail } from "@/provider";
import { theme } from "@/theme";

/** Which removal the backend allows for this Unit, if either — delete wins, as for a Property. */
export function unitRemoval(unit: UnitDetail): "delete" | "archive" | null {
  if (unit.permitted_actions.delete?.allowed) return "delete";
  if (unit.permitted_actions.archive?.allowed) return "archive";
  return null;
}

/**
 * Why neither is allowed, in the backend's own words — so a Unit somebody
 * lives in says "end the tenancy first" instead of offering a sheet with
 * nothing in it (owner, 2026-10-06).
 */
export function unitRemovalBlocker(unit: UnitDetail): string {
  return unit.permitted_actions.archive?.message
    || unit.permitted_actions.delete?.message
    || "This Unit cannot be archived or deleted right now.";
}

/**
 * Archiving or deleting, in the sheet the Unit page's own row opens. The row
 * was the first step, so the sheet is the confirmation: what happens, why
 * (recorded, per ADR 0021), and one laterite pill that does it. The sheet only
 * opens when the backend allows one of the two.
 */
export function UnitLifecycleActions({ unit, onCancel }: { unit: UnitDetail; onCancel: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const action = unitRemoval(unit);
  if (!action) return null;
  const deleting = action === "delete";
  const decision = deleting ? unit.permitted_actions.delete! : unit.permitted_actions.archive!;

  return (
    <View style={{ gap: space[3] }}>
      <RecordPanel style={{ gap: space[3], padding: space[4] }}>
        <StandingLine tone="alert" line={deleting ? "Deleting cannot be undone" : "Archived, it leaves this Property"} />
        <Type variant="caption" style={{ color: theme.color.ink["700"] }}>{decision.message}</Type>
        <Field label="Why? This is recorded." value={reason} maxLength={400} onChangeText={setReason} />
      </RecordPanel>
      {error ? <Notice tone="error" title={error} /> : null}
      <Pill
        grow
        tone="danger"
        icon={deleting ? "trash-outline" : "archive-outline"}
        label={deleting ? "Delete permanently" : "Archive Unit"}
        busy={busy}
        busyLabel={deleting ? "Deleting…" : "Archiving…"}
        disabled={!reason.trim()}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            if (deleting) await deleteUnit(unit.id, reason.trim());
            else await archiveUnit(unit.id, reason.trim());
            router.replace({ pathname: "/(app)/provider-property", params: { propertyId: unit.property_id } });
          } catch (cause) {
            setError(cause instanceof ApiFailure ? cause.error.message : `Could not ${action} this Unit.`);
            setBusy(false);
          }
        }}
      />
      <QuietAct label="Keep this Unit" disabled={busy} onPress={onCancel} />
    </View>
  );
}
