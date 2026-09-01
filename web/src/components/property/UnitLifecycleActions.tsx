"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { DetailDisclosure } from "@/components/property/WorkspacePatterns";
import { ApiFailure } from "@/lib/api";
import { archiveUnit, deleteUnit, type UnitDetail } from "@/lib/console";

/**
 * The reversible/permanent Unit choice supplied by backend policy.
 *
 * A clean private draft is deleted; a Unit with protected history is archived.
 * As on Property, this page never guesses from listing or tenancy state.
 */
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
    <DetailDisclosure title="Archive or delete">
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        <div>
          <h3 className="type-body-strong" style={{ margin: 0 }}>
            {deleting ? "Delete this Unit" : "Archive this Unit"}
          </h3>
          <p className="type-caption" style={{ margin: "var(--space-2) 0 0", maxWidth: "58ch" }}>
            {decision.message}
          </p>
        </div>

        {error ? <Notice tone="error" title={error} /> : null}

        {confirming ? (
          <>
            <Field
              label="Why? This is recorded."
              value={reason}
              maxLength={400}
              autoFocus
              onChange={(event) => setReason(event.target.value)}
            />
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <Button
                variant="destructive"
                busy={busy}
                busyLabel={deleting ? "Deleting…" : "Archiving…"}
                disabled={!reason.trim()}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    if (deleting) await deleteUnit(unit.id, reason.trim());
                    else await archiveUnit(unit.id, reason.trim());
                    router.replace(`/properties/${unit.property_id}` as never);
                    router.refresh();
                  } catch (cause) {
                    setError(
                      cause instanceof ApiFailure
                        ? cause.error.message
                        : `Could not ${action} this Unit.`,
                    );
                    setBusy(false);
                  }
                }}
              >
                {deleting ? "Delete it permanently" : "Archive Unit"}
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>
                Keep Unit
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              {deleting ? "Delete Unit" : "Archive Unit"}
            </Button>
          </div>
        )}
      </div>
    </DetailDisclosure>
  );
}
