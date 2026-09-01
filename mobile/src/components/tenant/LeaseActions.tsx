import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Notice, Type, space } from "@/components/ui";
import { endLease, offerLease } from "@/leases";

type LeaseStatus = "draft" | "ready" | "offered" | "tenant_accepted" | "awaiting_activation" | "active" | "declined" | "cancelled" | "ended" | null;

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
    return <View style={{ gap: space[2] }}>{error ? <Notice tone="error" title={error} /> : null}<Button label="Send saved agreement" busy={busy} onPress={async () => {
      setBusy(true); setError("");
      try { await offerLease(leaseId); await onChanged(); }
      catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the agreement."); }
      finally { setBusy(false); }
    }} /></View>;
  }
  return <Type variant="caption">{leaseStatus === "active" ? "Tenancy active" : leaseStatus === "offered" ? "Agreement sent · waiting for the tenant" : `Agreement ${humanize(leaseStatus)}`}</Type>;
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
  if (!leaseId) return <LeaseComposer unitId={unitId} bedId={null} tenantId={tenantId} applicationId={applicationId} listingId={listingId} initialRentMinor={rentMinor} initialAdvanceMonths={advanceMonths} onChanged={onChanged} />;
  if (leaseStatus === "draft") return <View style={{ gap: space[2] }}>{error ? <Notice tone="error" title={error} /> : null}<Button label="Send saved agreement" busy={busy} onPress={async () => {
    setBusy(true); setError("");
    try { await offerLease(leaseId); await onChanged(); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the agreement."); }
    finally { setBusy(false); }
  }} /></View>;
  return <Type variant="caption">{leaseStatus === "active" ? "Tenancy active" : leaseStatus === "offered" ? "Agreement sent · waiting for the tenant" : `Agreement ${humanize(leaseStatus)}`}</Type>;
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
  if (!allowed) return <Type variant="caption">Your Property permission does not allow agreement changes.</Type>;
  if (!leaseId) return <LeaseComposer unitId={unitId} bedId={bedId} tenantId={tenantId} onChanged={onChanged} />;
  if (leaseStatus === "draft") return <Button label="Send agreement" busy={busy} onPress={async () => {
    setBusy(true); setError("");
    try { await offerLease(leaseId); await onChanged(); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the agreement."); }
    finally { setBusy(false); }
  }} />;
  if (leaseStatus === "offered") return <Type variant="caption">Waiting for {tenantName} to accept the agreement.</Type>;
  if (leaseStatus === "awaiting_activation") return <Type variant="caption">The agreement is accepted and waiting for activation.</Type>;
  if (leaseStatus === "active") {
    return (
      <View style={{ gap: space[2] }}>
        {error ? <Notice tone="error" title={error} /> : null}
        <Button label="End tenancy" variant="destructive" busy={busy} onPress={() => Alert.alert(
          "End this tenancy?",
          "Use this only after the occupant has moved out. It closes the occupancy and does not republish the Unit.",
          [
            { text: "Keep tenancy active", style: "cancel" },
            { text: "End tenancy", style: "destructive", onPress: async () => {
              setBusy(true); setError("");
              try { await endLease(leaseId, "Tenant moved out", true); await onChanged(); }
              catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not end the tenancy."); }
              finally { setBusy(false); }
            } },
          ],
        )} />
      </View>
    );
  }
  return <Type variant="caption">Agreement {humanize(leaseStatus)}</Type>;
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

  return (
    <Button label="Prepare agreement" variant="secondary" onPress={openBuilder} />
  );
}

function humanize(value: string | null) {
  return value?.replaceAll("_", " ") ?? "not prepared";
}
