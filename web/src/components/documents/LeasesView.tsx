"use client";

/**
 * Leases: every agreement the Portfolio has granted, as documents.
 *
 * What used to be the Leases page, now a view of Documents. The stages are the
 * ones the provider works in (To send, Current, History) and filter the list;
 * a row opens the agreement over the page in the lease modal. The row is still
 * a link to `/leases/<id>`, so a new tab or a copied address reaches the full
 * record page as before.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LeaseModal } from "@/components/leases/LeaseModal";
import { Icon } from "@/components/portal/icons";
import { PanelSearch, PanelSkeleton, PanelState, SegmentedControl } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { listGrantedLeases, type Lease } from "@/lib/console";
import {
  LEASE_FILTERS,
  leaseFilterLabel,
  leasePlace,
  leaseSearchText,
  leaseTenant,
  leaseTotals,
  providerLeaseDate,
  providerLeaseMoveIn,
  providerLeaseRent,
  providerLeaseStage,
  providerLeaseStatus,
  providerLeaseTone,
  type LeaseFilter,
} from "@/lib/leaseMeaning";

export type LeaseTotals = ReturnType<typeof leaseTotals>;

export function LeasesView({
  organizationId,
  stage,
  query,
  openId,
  onOpenLease,
  onParams,
  onTotals,
}: {
  organizationId: string | null;
  stage: LeaseFilter;
  query: string;
  /** The lease open in the modal, held by the page. */
  openId: string | null;
  onOpenLease: (leaseId: string) => void;
  onParams: (changes: Record<string, string>) => void;
  onTotals: (totals: LeaseTotals | null) => void;
}) {
  const router = useRouter();
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLeases(await listGrantedLeases(organizationId ? { organization: organizationId } : undefined));
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load agreements.");
      setLeases((current) => current ?? []);
    }
  }, [organizationId, router]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => (leases ? leaseTotals(leases) : null), [leases]);
  useEffect(() => { onTotals(totals); }, [onTotals, totals]);

  const counts = useMemo(() => {
    const rows = leases ?? [];
    return {
      all: rows.length,
      send: rows.filter((lease) => providerLeaseStage(lease) === "send").length,
      current: rows.filter((lease) => providerLeaseStage(lease) === "current").length,
      history: rows.filter((lease) => providerLeaseStage(lease) === "history").length,
    };
  }, [leases]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (leases ?? [])
      .filter((lease) => stage === "all" || providerLeaseStage(lease) === stage)
      .filter((lease) => !needle || leaseSearchText(lease).toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [leases, query, stage]);

  const loading = leases === null;
  const none = leases !== null && leases.length === 0;
  const openLease = leases?.find((lease) => lease.id === openId) ?? null;

  return (
    <>
      <section className="ws-panel docs-leases" aria-label="Leases" aria-busy={loading || undefined}>
        {none ? null : (
          <div className="ws-panel-head docs-leases-head">
            <PanelSearch label="Search leases" placeholder="Search tenant, Property or Unit" value={query} onChange={(value) => onParams({ q: value })} />
            <SegmentedControl
              inline
              label="Agreement stage"
              value={stage}
              disabled={loading}
              options={LEASE_FILTERS.map((key) => ({ key, label: key === "all" ? "All leases" : leaseFilterLabel(key), count: counts[key] }))}
              onChange={(key) => onParams({ show: key === "all" ? "" : key })}
            />
          </div>
        )}

        {error && leases?.length ? (
          <div className="ws-inline-error" role="alert">
            <Icon name="warning" /><span>{error}</span>
            <button type="button" onClick={() => void load()}>Try again</button>
          </div>
        ) : null}

        {loading ? <PanelSkeleton rows={4} round /> : null}

        {error && none ? (
          <PanelState tone="error" icon="warning" title="Leases didn’t load" body={error}
            action={<button type="button" className="ws-action" onClick={() => void load()}>Try again</button>} />
        ) : none ? (
          <PanelState
            icon="leases"
            title="No leases yet"
            body="Agreements you prepare from approved tenancy requests appear here, from draft to signed."
            action={<Link href={"/applications" as never} className="ws-action is-primary"><Icon name="applications" />Open tenancy requests</Link>}
          />
        ) : !loading && !visible.length ? (
          <PanelState
            icon="leases"
            title={query ? "No matching leases" : stage === "send" ? "Nothing to send" : stage === "current" ? "No current leases" : "No lease history yet"}
            body={query ? "Try a different tenant, Property or Unit." : stage === "send" ? "Drafts you prepare wait here until you send them." : stage === "current" ? "Sent, accepted and active agreements appear here." : "Declined, withdrawn and ended agreements stay here as records."}
          />
        ) : !loading ? (
          <ul className="docs-lease-rows">
            {visible.map((lease, index) => (
              <LeaseRow key={lease.id} lease={lease} order={index} onOpen={() => onOpenLease(lease.id)} />
            ))}
          </ul>
        ) : null}
      </section>

      <LeaseModal
        leaseId={openId}
        initial={openLease}
        onClose={() => onOpenLease("")}
        onChanged={load}
      />
    </>
  );
}

function LeaseRow({ lease, order, onOpen }: { lease: Lease; order: number; onOpen: () => void }) {
  const tone = providerLeaseTone(lease);
  return (
    <li style={{ "--docs-order": Math.min(order, 12) } as React.CSSProperties}>
      <Link
        href={`/record/lease?leaseId=${lease.id}` as never}
        className="docs-lease-row"
        aria-haspopup="dialog"
        onClick={(event) => {
          // A plain press opens it here; a new tab still gets the record page.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onOpen();
        }}
      >
        <span className="docs-lease-avatar" aria-hidden="true">{initials(leaseTenant(lease))}</span>
        <span className="docs-lease-who">
          <strong>{leaseTenant(lease)}</strong>
          <small>{leasePlace(lease)}</small>
        </span>
        <span className="docs-lease-money">
          {providerLeaseRent(lease)}
          <small>{providerLeaseMoveIn(lease)} to move in</small>
        </span>
        <span className={`docs-lease-state is-${tone}`}><i aria-hidden="true" />{providerLeaseStatus(lease)}</span>
        <span className="docs-lease-date">{providerLeaseDate(lease)}</span>
        <svg className="docs-lease-row-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
