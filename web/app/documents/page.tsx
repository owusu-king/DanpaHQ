"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { ContractsView } from "@/components/documents/ContractsView";
import { LeasesView, type LeaseTotals } from "@/components/documents/LeasesView";
import { Icon } from "@/components/portal/icons";
import { PanelSkeleton, SegmentedControl, WorkspaceHead } from "@/components/workspace/Workspace";
import { listOrganizations } from "@/lib/console";
import { useDeepLinkedModal } from "@/lib/deepLinkedModal";
import { LEASE_FILTERS, type LeaseFilter } from "@/lib/leaseMeaning";
import { useSession } from "@/lib/session";
import { selectedPortfolio } from "@/lib/sessionPolicy";

/**
 * Documents: the agreements a Portfolio makes, and what they are made from.
 *
 * Two views under one address. **Contracts** is the controlled Danpa HQ
 * agreement and the Portfolio's own terms templates; **Leases** is every
 * agreement granted, filtered by the stage the provider works in, each opening
 * over the page. It replaces the provider's Leases page — a lease is a
 * document, and it now lives with the others. The tenant's Agreements are
 * theirs to hold and stay at `/leases`.
 *
 * View, stage, search and the open lease are all in the address, so a
 * refresh, a shared link or the back button lands where somebody was.
 */
type View = "contracts" | "leases";

export default function DocumentsPage() {
  return (
    <Suspense fallback={<DocumentsLoading />}>
      <Documents />
    </Suspense>
  );
}

function DocumentsLoading() {
  return (
    <div className="ws-page docs-workspace">
      <WorkspaceHead icon="leases" title="Documents" />
      <section className="ws-panel" aria-busy="true" aria-label="Documents"><PanelSkeleton rows={3} /></section>
    </div>
  );
}

function Documents() {
  const { state, activeContext } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [fallbackOrganization, setFallbackOrganization] = useState<string | null>();
  const [creating, setCreating] = useState(false);
  const [totals, setTotals] = useState<LeaseTotals | null>(null);

  const view: View = search.get("view") === "leases" ? "leases" : "contracts";
  const stage: LeaseFilter = LEASE_FILTERS.find((value) => value === search.get("show")) ?? "all";
  const query = search.get("q") ?? "";
  // `?lease=` from elsewhere opens that lease once.
  const [openId, setOpenLease] = useDeepLinkedModal("lease");

  const provider = state.status === "signed_in"
    && state.me.capabilities.active_workspace === "provider"
    && state.me.capabilities.provider.workspace_access;
  const preferred = selectedPortfolio(
    state.status === "signed_in" ? state.me : null, activeContext,
  )?.organization_id;
  const organizationId = preferred ?? fallbackOrganization;

  // A tenant's agreements are theirs, at /leases; Documents is the provider's.
  useEffect(() => {
    if (state.status === "signed_in" && !provider) router.replace("/leases" as never);
  }, [provider, router, state.status]);

  // Templates belong to a Portfolio: the one being operated, else the first.
  useEffect(() => {
    if (!provider || preferred) return;
    let cancelled = false;
    void listOrganizations()
      .then((rows) => { if (!cancelled) setFallbackOrganization(rows[0]?.id ?? null); })
      .catch(() => { if (!cancelled) setFallbackOrganization(null); });
    return () => { cancelled = true; };
  }, [preferred, provider]);

  // `replace`, so filtering and opening leave no history trail to walk back through.
  const setParams = useCallback((changes: Record<string, string>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const queryString = next.toString();
    router.replace((queryString ? `${pathname}?${queryString}` : pathname) as never, { scroll: false });
  }, [pathname, router, search]);

  const onTotals = useCallback((next: LeaseTotals | null) => setTotals(next), []);

  if (state.status === "loading" || (state.status === "signed_in" && !provider)) return <DocumentsLoading />;
  if (state.status !== "signed_in") return null;
  if (organizationId === undefined) return <DocumentsLoading />;

  return (
    <div className="ws-page docs-workspace">
      <WorkspaceHead
        icon="leases"
        title="Documents"
        summary={view === "contracts" ? null : totals ? (
          <>
            <strong>{totals.total} {totals.total === 1 ? "lease" : "leases"}</strong>
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {totals.active} active
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {totals.awaiting} awaiting tenant
          </>
        ) : null}
        actions={view === "contracts" ? (
          <button type="button" className="ws-action is-primary" aria-haspopup="dialog" disabled={!organizationId} onClick={() => setCreating(true)}>
            <Icon name="plus" />New template
          </button>
        ) : null}
      />

      <SegmentedControl
        label="Documents"
        value={view}
        options={[
          { key: "contracts", label: "Contracts" },
          { key: "leases", label: "Leases", count: totals?.total },
        ]}
        onChange={(next) => {
          setOpenLease("");
          setParams({ view: next === "contracts" ? "" : next, show: "", q: "" });
        }}
      />

      <div className="docs-view" key={view}>
        {view === "contracts" ? (
          <ContractsView organizationId={organizationId} creating={creating} onCreatingChange={setCreating} />
        ) : (
          <LeasesView
            key={organizationId}
            organizationId={organizationId}
            stage={stage}
            query={query}
            openId={openId || null}
            onOpenLease={setOpenLease}
            onParams={setParams}
            onTotals={onTotals}
          />
        )}
      </div>
    </div>
  );
}
