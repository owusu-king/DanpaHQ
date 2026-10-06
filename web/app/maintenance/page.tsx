"use client";

/**
 * Maintenance, on the shared workspace — one address for both sides, the way
 * Payments is.
 *
 * A **tenant** sees what they have reported and where each stands, with the
 * one thing that waits on them — a fix to confirm — lifted above the list, and
 * a way to report a new problem on any active tenancy.
 *
 * A **provider** sees the requests on their Portfolio's properties by stage:
 * new (including anything a tenant reopened), in progress, waiting for the
 * tenant, completed. The oldest new request is lifted above the list.
 *
 * A request opens in its sheet over the list, kept in the address
 * (`?request=`), so a notification, Back and a copied link all return to it.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/portal/icons";
import { MaintenanceSheet } from "@/components/maintenance/MaintenanceRecord";
import { ReportSheet } from "@/components/maintenance/ReportSheet";
import { useToast } from "@/components/toast/Toaster";
import { NextUp, PanelSkeleton, PanelState, SegmentedControl, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { listOrganizations } from "@/lib/console";
import {
  listMyMaintenance,
  listOrganizationMaintenance,
  maintenanceStatusLabel,
  maintenanceTone,
  type MaintenanceRequest,
} from "@/lib/maintenance";
import { useSession } from "@/lib/session";
import { listMyTenancies, type Tenancy } from "@/lib/tenancy";
import { onDate } from "@/lib/time";

type Side = "tenant" | "provider";
type TenantStage = "open" | "completed";
type ProviderStage = "new" | "working" | "asking" | "completed";

export default function MaintenancePage() {
  return (
    <Suspense fallback={<Loading />}>
      <MaintenanceWorkspace />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="ws-page maintenance-workspace">
      <WorkspaceHead icon="wrench" title="Maintenance" />
      <section className="ws-panel" aria-busy="true" aria-label="Maintenance"><PanelSkeleton rows={4} /></section>
    </div>
  );
}

function MaintenanceWorkspace() {
  const { state } = useSession();
  if (state.status === "loading") return <Loading />;
  if (state.status !== "signed_in") return null;
  const inProvider = state.me.capabilities.active_workspace === "provider"
    && (state.me.capabilities.provider.workspace_access || state.me.capabilities.provider.exists);
  return inProvider ? <ProviderMaintenance /> : <TenantMaintenance />;
}

/** The address is the state: which request is open, which stage is shown, a report in progress. */
function useParams() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const set = useCallback((changes: Record<string, string>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as never, { scroll: false });
  }, [pathname, router, search]);
  return { search, set };
}

// --- tenant ---------------------------------------------------------------------

function TenantMaintenance() {
  const { search, set } = useParams();
  const { toast } = useToast();
  const [requests, setRequests] = useState<MaintenanceRequest[] | null>(null);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [error, setError] = useState("");
  const stage: TenantStage = search.get("show") === "completed" ? "completed" : "open";
  const openId = search.get("request") ?? "";
  // `?report=1`, or `?report=<tenancy id>` from a tenancy's own page.
  const reporting = search.get("report") ?? "";

  const load = useCallback(async () => {
    try {
      const [rows, homes] = await Promise.all([listMyMaintenance(), listMyTenancies()]);
      setRequests(rows);
      setTenancies(homes.filter((row) => row.status === "active"));
      setError("");
    } catch (cause) {
      setRequests((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your requests.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = (requests ?? []).filter((row) => row.status !== "completed");
  const done = (requests ?? []).filter((row) => row.status === "completed");
  const asking = open.filter((row) => row.status === "awaiting_tenant_confirmation");
  const shown = stage === "completed" ? done : open;
  const canReport = tenancies.length > 0;
  const firstAsking = asking[0];

  return (
    <div className="ws-page maintenance-workspace">
      <WorkspaceHead
        icon="wrench"
        title="Maintenance"
        summary={requests === null ? null : requests.length ? (
          <>
            <strong>{open.length} open</strong>
            {asking.length ? <><span className="ws-summary-sep" aria-hidden="true">·</span><span data-tone="warning">{asking.length} to confirm</span></> : null}
            {done.length ? <><span className="ws-summary-sep" aria-hidden="true">·</span>{done.length} completed</> : null}
          </>
        ) : "Report anything that needs fixing where you live."}
        actions={canReport ? (
          <button type="button" className="ws-action is-primary" onClick={() => set({ report: "1" })}><Icon name="plus" />Report a problem</button>
        ) : null}
      />

      {firstAsking ? (
        <NextUp
          eyebrow="Confirm the fix"
          title={firstAsking.category_display}
          detail={firstAsking.place.unit_label}
          hint="Your landlord says it is fixed. Tell them whether it is."
          photoUrl={firstAsking.photo?.url}
          icon="wrench"
          more={asking.length > 1 ? { count: asking.length - 1, onShow: () => set({ show: "" }) } : undefined}
          onOpen={() => set({ request: firstAsking.id })}
          action={{ label: "Confirm", onClick: () => set({ request: firstAsking.id }) }}
        />
      ) : null}

      {requests !== null && requests.length ? (
        <SegmentedControl<TenantStage>
          label="Requests"
          value={stage}
          onChange={(next) => set({ show: next === "open" ? "" : next })}
          options={[
            { key: "open", label: "Open", count: open.length },
            { key: "completed", label: "Completed", count: done.length },
          ]}
        />
      ) : null}

      <section className="ws-panel maintenance-panel" aria-label="Your requests" aria-busy={requests === null || undefined}>
        {requests === null ? (
          <PanelSkeleton rows={3} />
        ) : error && !requests.length ? (
          <PanelState tone="error" icon="warning" title="Your requests didn’t load" body={error} action={<button type="button" className="ws-action" onClick={() => void load()}>Try again</button>} />
        ) : !requests.length ? (
          <PanelState
            icon="wrench"
            title="Nothing reported"
            body={canReport ? "A leak, a fault, a broken lock — report it with a photo and your landlord is told at once." : "Once your tenancy is active you can report problems here."}
            action={canReport ? <button type="button" className="ws-action is-primary" onClick={() => set({ report: "1" })}><Icon name="plus" />Report a problem</button> : null}
          />
        ) : !shown.length ? (
          <PanelState icon={stage === "open" ? "check" : "wrench"} title={stage === "open" ? "Nothing open" : "Nothing completed yet"} body={stage === "open" ? "Every request you made has been confirmed fixed." : "Requests you confirm as fixed are kept here."} />
        ) : (
          <RequestRows rows={shown} side="tenant" onOpen={(id) => set({ request: id })} />
        )}
      </section>

      <MaintenanceSheet requestId={openId || null} side="tenant" onClose={() => set({ request: "" })} onChanged={load} />
      <ReportSheet
        open={Boolean(reporting) && canReport}
        tenancies={tenancies}
        initialTenancyId={reporting === "1" ? undefined : reporting}
        onClose={() => set({ report: "" })}
        onSent={async (created) => {
          await load();
          toast({ tone: "success", title: "Report sent", description: "Your landlord has been told. You can follow it here." });
          set({ report: "", show: "", request: created.id });
        }}
      />
    </div>
  );
}

// --- provider -------------------------------------------------------------------

const PROVIDER_STAGES: Record<ProviderStage, MaintenanceRequest["status"][]> = {
  new: ["submitted", "reopened"],
  working: ["in_progress"],
  asking: ["awaiting_tenant_confirmation"],
  completed: ["completed"],
};

function ProviderMaintenance() {
  const { activeContext } = useSession();
  const { search, set } = useParams();
  const [organizationId, setOrganizationId] = useState("");
  const [requests, setRequests] = useState<MaintenanceRequest[] | null>(null);
  const [error, setError] = useState("");
  const stage: ProviderStage = (["new", "working", "asking", "completed"] as const).find((value) => value === search.get("show")) ?? "new";
  const openId = search.get("request") ?? "";

  useEffect(() => {
    let live = true;
    listOrganizations().then((rows) => {
      if (!live) return;
      const preferred = activeContext?.startsWith("organization:") ? activeContext.slice("organization:".length) : "";
      const chosen = rows.find((row) => row.id === preferred)?.id ?? rows[0]?.id ?? "";
      setOrganizationId(chosen);
      if (!chosen) setRequests([]);
    }).catch((cause) => { if (live) { setRequests([]); setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your Portfolios."); } });
    return () => { live = false; };
  }, [activeContext]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      setRequests(await listOrganizationMaintenance(organizationId));
      setError("");
    } catch (cause) {
      setRequests((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load maintenance requests.");
    }
  }, [organizationId]);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const rows = requests ?? [];
    return Object.fromEntries(
      (Object.keys(PROVIDER_STAGES) as ProviderStage[]).map((key) => [key, rows.filter((row) => PROVIDER_STAGES[key].includes(row.status))]),
    ) as Record<ProviderStage, MaintenanceRequest[]>;
  }, [requests]);
  // Oldest first among new work: what has waited longest is what to start.
  const waiting = [...counts.new].sort((a, b) => a.status_changed_at.localeCompare(b.status_changed_at));
  const shown = counts[stage];
  const firstWaiting = waiting[0];

  return (
    <div className="ws-page maintenance-workspace">
      <WorkspaceHead
        icon="wrench"
        title="Maintenance"
        summary={requests === null ? null : requests.length ? (
          <>
            <strong>{counts.new.length} new</strong>
            <span className="ws-summary-sep" aria-hidden="true">·</span>{counts.working.length} in progress
            {counts.asking.length ? <><span className="ws-summary-sep" aria-hidden="true">·</span>{counts.asking.length} waiting for tenants</> : null}
          </>
        ) : "Repairs your tenants report, from new to confirmed fixed."}
      />

      {firstWaiting ? (
        <NextUp
          tone={firstWaiting.status === "reopened" ? "overdue" : undefined}
          eyebrow={firstWaiting.status === "reopened" ? "Reopened by the tenant" : "New request"}
          title={firstWaiting.category_display}
          detail={`${firstWaiting.tenant.name} · ${firstWaiting.place.unit_label}`}
          hint={`Reported ${onDate(firstWaiting.created_at)}. Start the work when someone is on it.`}
          photoUrl={firstWaiting.photo?.url}
          icon="wrench"
          more={waiting.length > 1 ? { count: waiting.length - 1, onShow: () => set({ show: "" }) } : undefined}
          onOpen={() => set({ request: firstWaiting.id })}
          action={{ label: "Open", onClick: () => set({ request: firstWaiting.id }) }}
        />
      ) : null}

      {requests !== null && requests.length ? (
        <SegmentedControl<ProviderStage>
          label="Stage"
          value={stage}
          onChange={(next) => set({ show: next === "new" ? "" : next })}
          options={[
            { key: "new", label: "New", count: counts.new.length },
            { key: "working", label: "In progress", count: counts.working.length },
            { key: "asking", label: "Waiting for tenant", count: counts.asking.length },
            { key: "completed", label: "Completed", count: counts.completed.length },
          ]}
        />
      ) : null}

      <section className="ws-panel maintenance-panel" aria-label="Maintenance requests" aria-busy={requests === null || undefined}>
        {requests === null ? (
          <PanelSkeleton rows={4} />
        ) : error && !requests.length ? (
          <PanelState tone="error" icon="warning" title="Maintenance didn’t load" body={error} action={<button type="button" className="ws-action" onClick={() => void load()}>Try again</button>} />
        ) : !requests.length ? (
          <PanelState icon="wrench" title="No maintenance requests" body="When a tenant reports a problem it arrives here with their photo, and you are notified." />
        ) : !shown.length ? (
          <PanelState
            icon={stage === "new" ? "check" : "wrench"}
            title={{ new: "Nothing new", working: "Nothing in progress", asking: "Nobody to wait on", completed: "Nothing completed yet" }[stage]}
            body={{ new: "Every request has been started.", working: "Start a new request and it moves here.", asking: "Fixes you report wait here for the tenant to confirm.", completed: "Repairs tenants confirm are kept here." }[stage]}
          />
        ) : (
          <RequestRows rows={shown} side="provider" onOpen={(id) => set({ request: id })} />
        )}
      </section>

      <MaintenanceSheet requestId={openId || null} side="provider" onClose={() => set({ request: "" })} onChanged={load} />
    </div>
  );
}

// --- rows -------------------------------------------------------------------------

function RequestRows({ rows, side, onOpen }: { rows: MaintenanceRequest[]; side: Side; onOpen: (id: string) => void }) {
  return (
    <ul className="mt-rows">
      {rows.map((row, index) => (
        <li key={row.id} style={{ "--mt-order": index } as React.CSSProperties}>
          <Link
            href={`/maintenance?request=${row.id}` as never}
            className={`mt-row is-${maintenanceTone(row.status)}`}
            // A plain click reads it over the list; a modified click is still a link.
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onOpen(row.id);
            }}
          >
            <span className="mt-row-photo" aria-hidden="true">
              {/* Short-lived signed URL, issued to a party to the request. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {row.photo ? <img src={row.photo.url} alt="" /> : <Icon name="wrench" />}
              {row.video ? <i className="mt-row-video"><Icon name="video" /></i> : null}
            </span>
            <span className="mt-row-copy">
              <strong>{row.category_display}</strong>
              <small>
                {side === "provider" ? <span>{row.tenant.name}</span> : null}
                <span>{row.place.unit_label}{row.place.bed_label ? ` · ${row.place.bed_label}` : ""}</span>
                <span>{row.place.property_title}</span>
              </small>
            </span>
            <span className="mt-row-side">
              <span className={`mt-pill is-${maintenanceTone(row.status)}`}><i aria-hidden="true" />{maintenanceStatusLabel(row.status, side)}</span>
              <small>{onDate(row.status_changed_at)}</small>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
