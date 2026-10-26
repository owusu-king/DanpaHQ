import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { MUTED, Pill } from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import { endLease, offerLease } from "@/leases";
import { destructiveConfirmStyle } from "@/platform";

/**
 * What can be done with the agreement behind a request, an application or a
 * tenancy — the same three answers wherever the question is asked.
 *
 * Drawn on the record surfaces (2026-09-21): one pill for the act the lifecycle
 * allows, and a quiet line where it allows nothing, so these sit inside a panel
 * on a record page rather than as loose buttons stacked under it.
 */

type LeaseStatus = "draft" | "ready" | "offered" | "tenant_accepted" | "awaiting_activation" | "active" | "declined" | "cancelled" | "ended" | null;

/** Where the agreement has got to, when there is nothing to do about it. */
function Standing({ children }: { children: string }) {
  return <Type variant="caption" style={styles.standing}>{children}</Type>;
}

export function RequestLeaseActions({
  requestId,
  unitId,
  bedId,
  tenantId,
  leaseId,
  leaseStatus,
  onChanged,
}: {
  requestId: string;
  unitId: string;
  bedId: string | null;
  tenantId: string;
  leaseId: string | null;
  leaseStatus: LeaseStatus;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!leaseId) {
    return <LeaseComposer unitId={unitId} bedId={bedId} tenantId={tenantId} requestId={requestId} onChanged={onChanged} />;
  }
  if (leaseStatus === "draft") {
    return (
      <View style={styles.stack}>
        {error ? <Notice tone="error" title={error} /> : null}
        <Pill
          grow
          icon="send-outline"
          label="Send saved agreement"
          busy={busy}
          busyLabel="Sending…"
          onPress={async () => {
            setBusy(true); setError("");
            try { await offerLease(leaseId); await onChanged(); }
            catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the agreement."); }
            finally { setBusy(false); }
          }}
        />
      </View>
    );
  }
  return <Standing>{settled(leaseStatus)}</Standing>;
}

export function ApplicationLeaseActions({
  applicationId,
  listingId,
  unitId,
  tenantId,
  rentMinor,
  advanceMonths,
  leaseId,
  leaseStatus,
  onChanged,
}: {
  applicationId: string;
  listingId: string;
  unitId: string;
  tenantId: string;
  rentMinor: number;
  advanceMonths: number;
  leaseId: string | null;
  leaseStatus: LeaseStatus;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!leaseId) {
    return (
      <LeaseComposer
        unitId={unitId}
        bedId={null}
        tenantId={tenantId}
        applicationId={applicationId}
        listingId={listingId}
        initialRentMinor={rentMinor}
        initialAdvanceMonths={advanceMonths}
        onChanged={onChanged}
      />
    );
  }
  if (leaseStatus === "draft") {
    return (
      <View style={styles.stack}>
        {error ? <Notice tone="error" title={error} /> : null}
        <Pill
          grow
          icon="send-outline"
          label="Send saved agreement"
          busy={busy}
          busyLabel="Sending…"
          onPress={async () => {
            setBusy(true); setError("");
            try { await offerLease(leaseId); await onChanged(); }
            catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the agreement."); }
            finally { setBusy(false); }
          }}
        />
      </View>
    );
  }
  return <Standing>{settled(leaseStatus)}</Standing>;
}

export function TenantLeaseActions({
  unitId,
  bedId,
  tenantId,
  tenantName,
  leaseId,
  leaseStatus,
  allowed,
  onChanged,
}: {
  unitId: string;
  bedId: string | null;
  tenantId: string;
  tenantName: string;
  leaseId: string | null;
  leaseStatus: LeaseStatus;
  allowed: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!allowed) return <Standing>Your Property permission does not allow agreement changes.</Standing>;
  if (!leaseId) return <LeaseComposer unitId={unitId} bedId={bedId} tenantId={tenantId} onChanged={onChanged} />;

  if (leaseStatus === "draft") {
    return (
      <View style={styles.stack}>
        {error ? <Notice tone="error" title={error} /> : null}
        <Pill
          grow
          icon="send-outline"
          label="Send agreement"
          busy={busy}
          busyLabel="Sending…"
          onPress={async () => {
            setBusy(true); setError("");
            try { await offerLease(leaseId); await onChanged(); }
            catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the agreement."); }
            finally { setBusy(false); }
          }}
        />
      </View>
    );
  }
  if (leaseStatus === "offered") return <Standing>{`Waiting for ${tenantName} to accept the agreement.`}</Standing>;
  if (leaseStatus === "awaiting_activation") return <Standing>The agreement is accepted and waiting for activation.</Standing>;
  if (leaseStatus === "active") {
    return (
      <View style={styles.stack}>
        {error ? <Notice tone="error" title={error} /> : null}
        <Pill
          grow
          tone="danger"
          icon="exit-outline"
          label="End tenancy"
          busy={busy}
          busyLabel="Ending…"
          onPress={() => Alert.alert(
            "End this tenancy?",
            "Use this only after the occupant has moved out. It closes the occupancy and does not republish the Unit.",
            [
              { text: "Keep tenancy active", style: "cancel" },
              {
                text: "End tenancy",
                style: destructiveConfirmStyle,
                onPress: async () => {
                  setBusy(true); setError("");
                  try { await endLease(leaseId, "Tenant moved out", true); await onChanged(); }
                  catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not end the tenancy."); }
                  finally { setBusy(false); }
                },
              },
            ],
          )}
        />
      </View>
    );
  }
  return <Standing>{`Agreement ${humanize(leaseStatus)}`}</Standing>;
}

function LeaseComposer({
  unitId,
  bedId,
  tenantId,
  requestId,
  applicationId,
  listingId,
  initialRentMinor = 0,
  initialAdvanceMonths = 1,
  onChanged,
}: {
  unitId: string;
  bedId: string | null;
  tenantId: string;
  requestId?: string;
  applicationId?: string;
  listingId?: string;
  initialRentMinor?: number;
  initialAdvanceMonths?: number;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  void onChanged;

  function openBuilder() {
    router.push({
      pathname: "/(app)/lease-builder",
      params: {
        unitId,
        tenantId,
        ...(bedId ? { bedId } : {}),
        ...(requestId ? { sourceKind: "join_request", sourceId: requestId } : {}),
        ...(applicationId ? { sourceKind: "application", sourceId: applicationId } : {}),
        ...(listingId ? { listingId } : {}),
        rentMinor: String(initialRentMinor),
        advanceMonths: String(initialAdvanceMonths),
      },
    } as never);
  }

  return <Pill grow icon="create-outline" label="Prepare agreement" onPress={openBuilder} />;
}

/** What has become of an agreement nobody can act on from here. */
function settled(status: LeaseStatus) {
  if (status === "active") return "Tenancy active";
  if (status === "offered") return "Agreement sent · waiting for the tenant";
  return `Agreement ${humanize(status)}`;
}

function humanize(value: string | null) {
  return value?.replaceAll("_", " ") ?? "not prepared";
}

const styles = StyleSheet.create({
  stack: {
    gap: space[2],
  },
  standing: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
});
