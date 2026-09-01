"use client";

/**
 * One agreement, at its own address.
 *
 * Branches the same way `/leases` does, and for the same reason: it is one idea
 * — "the agreement that concerns me" — read from whichever side this account is
 * on. A provider sends, withdraws and ends; a tenant reads the terms they are
 * being asked to be bound by, and accepts or declines. The endpoints differ and
 * the backend scopes each to the caller, so this branch is presentation, not
 * permission.
 *
 * Both were panes before, and both fell back to opening the first row, so
 * arriving at Leases meant reading somebody's agreement chosen by sort order.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AgreementRecord } from "@/components/tenant/AgreementRecord";
import { LeaseRecord } from "@/components/leases/LeaseRecord";
import { Notice } from "@/components/Notice";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { agreedTerms, homeOf, standing } from "@/lib/agreementMeaning";
import { ApiFailure } from "@/lib/api";
import { listGrantedLeases, type Lease } from "@/lib/console";
import { leasePlace, leaseTenant, providerLeaseStatus } from "@/lib/leaseMeaning";
import { useSession } from "@/lib/session";
import { getLeaseLedger, listMyLeases, type RentCharge } from "@/lib/tenant";

export default function LeaseRecordPage() {
  const { state } = useSession();
  if (state.status === "loading") {
    return (
      <>
        <PageHeader title="Agreement" />
        <LoadingRows rows={4} />
      </>
    );
  }
  if (state.status !== "signed_in") return null;
  const capabilities = state.me.capabilities;
  const asProvider =
    capabilities.active_workspace === "provider" && capabilities.provider.workspace_access;
  return asProvider ? <ProviderLease /> : <TenantAgreement />;
}

function ProviderLease() {
  const { leaseId } = useParams<{ leaseId: string }>();
  const router = useRouter();
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLeases(await listGrantedLeases());
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this agreement.");
      setLeases([]);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const lease = leases?.find((row) => row.id === leaseId) ?? null;

  return (
    <div className="leases-workspace">
      <EntityPath
        items={[
          { label: "Leases", href: "/leases", mobileLabel: "Back to Leases" },
          { label: lease ? leaseTenant(lease) : "Agreement" },
        ]}
      />

      {leases === null ? (
        <>
          <PageHeader title="Agreement" />
          <LoadingRows rows={4} />
        </>
      ) : error ? (
        <Notice tone="error" title={error} />
      ) : lease ? (
        <>
          <PageHeader
            title={leaseTenant(lease)}
            description={`${providerLeaseStatus(lease)} · ${leasePlace(lease)}`}
          />
          <LeaseRecord key={lease.id} lease={lease} onChanged={load} />
        </>
      ) : (
        <>
          <PageHeader
            title="Agreement not found"
            description="It may belong to a Portfolio you no longer manage."
          />
          <p className="type-caption">
            <Link href="/leases">Back to Leases</Link>
          </p>
        </>
      )}
    </div>
  );
}

function TenantAgreement() {
  const { leaseId } = useParams<{ leaseId: string }>();
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [charges, setCharges] = useState<RentCharge[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await listMyLeases();
      setLeases(rows);
      setError("");
      // The ledger belongs to the agreement being read, not to whichever one
      // happens to be active — this page is about one of them.
      const mine = rows.find((row) => row.id === leaseId);
      setCharges(
        mine?.status === "active"
          ? ((await getLeaseLedger(mine.id).catch(() => null))?.charges ?? [])
          : [],
      );
    } catch (cause) {
      setLeases([]);
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load your agreement.",
      );
    }
  }, [leaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const lease = leases?.find((row) => row.id === leaseId) ?? null;

  return (
    <div className="agreements">
      <EntityPath
        items={[
          { label: "Agreements", href: "/leases", mobileLabel: "Back to Agreements" },
          { label: lease ? homeOf(agreedTerms(lease)) : "Agreement" },
        ]}
      />

      {leases === null ? (
        <>
          <PageHeader title="Agreement" />
          <LoadingRows rows={4} />
        </>
      ) : error ? (
        <Notice tone="error" title={error} />
      ) : lease ? (
        <>
          <PageHeader title={homeOf(agreedTerms(lease))} description={standing(lease).line} />
          <AgreementRecord key={lease.id} lease={lease} charges={charges} onChanged={load} />
        </>
      ) : (
        <>
          <PageHeader
            title="Agreement not found"
            description="It may have been withdrawn, or it was never sent to you."
          />
          <p className="type-caption">
            <Link href="/leases">Back to Agreements</Link>
          </p>
        </>
      )}
    </div>
  );
}
