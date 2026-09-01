"use client";

/**
 * One tenancy's rent account, at its own address.
 *
 * It was a modal over the payments list. That was wrong for what it holds: a
 * review queue with irreversible decisions in it, a schedule of charges, a
 * payment history, and two forms. A provider confirming that money arrived
 * often wants to check something else first — the tenancy, the agreement, their
 * own bank record — and a modal makes leaving mean losing your place. It also
 * cannot be linked to, cannot be sent to a colleague, and does not come back
 * from history.
 *
 * The lease id is the address because the rent account *is* the lease's: the
 * ledger endpoint is `/leases/<id>/charges/`, and both lists that reach this
 * page — balances and payment records — already carry `lease_id`.
 *
 * The tenant beside it comes from the Portfolio, which is the only place that
 * knows the name, the Unit and whether this provider may record money at all.
 * The ledger loads independently of it, so a rent account still renders if the
 * Portfolio lookup finds nothing — the server authorises both calls separately,
 * and it is the server that refuses.
 */

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/Notice";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { RentAccountDetail } from "@/components/payments/RentAccount";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { ApiFailure } from "@/lib/api";
import { getOrganizationPortfolio, listOrganizations, type ProviderTenant } from "@/lib/console";
import { rentStatus } from "@/lib/rentDisplay";
import { useSession } from "@/lib/session";
import { getLeaseLedger, type LeaseLedger } from "@/lib/tenant";

export default function ProviderRentAccountPage() {
  const { leaseId } = useParams<{ leaseId: string }>();
  const tenantMode = useSearchParams().get("mode") === "tenant";
  const { activeContext } = useSession();
  const [tenant, setTenant] = useState<ProviderTenant | null>(null);
  const [ledger, setLedger] = useState<LeaseLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLedger = useCallback(async () => {
    setLedger(await getLeaseLedger(leaseId));
  }, [leaseId]);

  // The Portfolio search is separate from the ledger so a slow or empty lookup
  // cannot keep the account itself off the screen.
  const findTenant = useCallback(async () => {
    const organizations = await listOrganizations();
    const preferredId = activeContext?.startsWith("organization:")
      ? activeContext.slice("organization:".length)
      : "";
    const ordered = [...organizations].sort(
      (a, b) => Number(b.id === preferredId) - Number(a.id === preferredId),
    );
    for (const organization of ordered) {
      const portfolio = await getOrganizationPortfolio(organization.id);
      const match = portfolio.tenants.find((row) => row.lease_id === leaseId);
      if (match) return match;
    }
    return null;
  }, [activeContext, leaseId]);

  const load = useCallback(async () => {
    const [ledgerResult, tenantResult] = await Promise.allSettled([
      loadLedger(),
      tenantMode ? Promise.resolve(null) : findTenant(),
    ]);
    if (tenantResult.status === "fulfilled") setTenant(tenantResult.value);
    if (ledgerResult.status === "rejected") {
      const cause = ledgerResult.reason;
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load this rent account.",
      );
      return;
    }
    setError("");
  }, [findTenant, loadLedger, tenantMode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const where = tenant
    ? `${tenant.property_title} · ${tenant.unit_label}${tenant.bed_label ? ` · ${tenant.bed_label}` : ""}`
    : ledger
      ? `${ledger.context.property_title} · ${ledger.context.unit_label}`
      : null;
  const accountName = tenant?.name ?? ledger?.context.tenant_name ?? "Rent account";

  return (
    <div className="rent-workspace">
      <EntityPath
        items={[
          {
            label: tenantMode ? "Your home" : "Payments",
            href: tenantMode ? "/home" : "/payments",
            mobileLabel: tenantMode ? "Back to your home" : "Back to Payments",
          },
          { label: accountName },
        ]}
      />
      <PageHeader title={accountName} description={where ?? undefined} />

      {tenant ? (
        <div className="rent-detail-place">
          <p className="type-body-strong">{where}</p>
          <span className={`rent-row-state is-${tenant.rent.status}`}>
            <i />
            {rentStatus(tenant)}
          </span>
        </div>
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}
      {loading && !ledger ? <LoadingRows rows={4} /> : null}

      {ledger ? (
        <div className="rent-detail">
          <RentAccountDetail
            tenant={tenant}
            tenantMode={tenantMode}
            leaseId={leaseId}
            ledger={ledger}
            onChanged={load}
          />
        </div>
      ) : null}

      {!loading && !ledger && !error ? (
        <p className="type-caption">
          <Link href={tenantMode ? "/home" : "/payments"}>Back</Link>
        </p>
      ) : null}
    </div>
  );
}
