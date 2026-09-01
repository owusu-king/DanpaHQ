import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { Disclosure } from "@/components/property/WorkspacePatterns";
import { archiveUnit, deleteUnit, type UnitDetail } from "@/provider";

/** Unit archive/delete follows the same backend-owned choice as Property. */
export function UnitLifecycleActions({ unit }: { unit: UnitDetail }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = unit.permitted_actions.delete;
  const archive = unit.permitted_actions.archive;
  const action = remove?.allowed ? "delete" : archive?.allowed ? "archive" : null;

  if (!action) return null;

  const decision = action === "delete" ? remove! : archive!;
  const deleting = action === "delete";

  return (
    <Disclosure title="Archive or delete">
      <View style={{ gap: space[3] }}>
        <View style={{ gap: space[1] }}>
          <Type variant="bodyStrong">
            {deleting ? "Delete this Unit" : "Archive this Unit"}
          </Type>
          <Type variant="caption">{decision.message}</Type>
        </View>

        {error ? <Notice tone="error" title={error} /> : null}

        {confirming ? (
          <>
            <Field
              label="Why? This is recorded."
              value={reason}
              maxLength={400}
              autoFocus
              onChangeText={setReason}
            />
            <Button
              label={deleting ? "Delete it permanently" : "Archive Unit"}
              variant="destructive"
              busy={busy}
              busyLabel={deleting ? "Deleting…" : "Archiving…"}
              disabled={!reason.trim()}
              onPress={async () => {
                setBusy(true);
                setError("");
                try {
                  if (deleting) await deleteUnit(unit.id, reason.trim());
                  else await archiveUnit(unit.id, reason.trim());
                  router.replace({
                    pathname: "/(app)/provider-property",
                    params: { propertyId: unit.property_id },
                  });
                } catch (cause) {
                  setError(
                    cause instanceof ApiFailure
                      ? cause.error.message
                      : `Could not ${action} this Unit.`,
                  );
                  setBusy(false);
                }
              }}
            />
            <Button
              label="Keep Unit"
              variant="quiet"
              disabled={busy}
              onPress={() => setConfirming(false)}
            />
          </>
        ) : (
          <Button
            label={deleting ? "Delete Unit" : "Archive Unit"}
            variant="secondary"
            onPress={() => setConfirming(true)}
          />
        )}
      </View>
    </Disclosure>
  );
}
