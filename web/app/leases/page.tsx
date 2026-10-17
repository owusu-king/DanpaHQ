"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AgreementSheet, agreementTone, type AgreementTone } from "@/components/tenant/AgreementRecord";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { Icon } from "@/components/portal/icons";
import { NextUp, PanelSearch, PanelSkeleton, PanelState, SegmentedControl, WorkspaceHead } from "@/components/workspace/Workspace";
import {
  agreedTerms,
  agreementFilters,
  homeOf,
  money,
  matchesAgreementFilter,
  per,
  standing,
  type AgreementFilter,
} from "@/lib/agreementMeaning";
import { ApiFailure } from "@/lib/api";
import { useDeepLinkedModal } from "@/lib/deepLinkedModal";
import { type Lease } from "@/lib/console";
import { useSession } from "@/lib/session";
import { listMyLeases } from "@/lib/tenant";
import { onDate } from "@/lib/time";

/**
 * Leases, from whichever side this account is on.
 *
 * A provider grants them; a tenant holds one. The provider's list moved into
 * Documents; the tenant's reads as Agreements.
 */
export default function LeasesPage() {
  return (
    <Suspense fallback={<><PageHeader title="Leases" /><LoadingRows /></>}>
      <LeasesContent />
    </Suspense>
  );
}

function LeasesContent() {
  const { state } = useSession();
  if (state.status === "loading") {
    return <><PageHeader title="Leases" /><LoadingRows /></>;
  }
  if (state.status !== "signed_in") return null;
  const capabilities = state.me.capabilities;
  const asProvider =
    capabilities.active_workspace === "provider" && capabilities.provider.workspace_access;
  return asProvider ? <ProviderLeases /> : <TenantLeases />;
}

/**
 * The agreements this person holds, on the shared workspace.
 *
 * The index is recognition only: home, Unit, where it stands, one useful date
 * and the way into the record. Money, parties, conditions and acceptance
 * evidence belong to the record, where the tenant can read the whole agreement
 * before acting — it opens in a sheet over the list, kept in the address. An
 * agreement waiting for their answer is lifted above the list, because it is
 * the one thing here that moves only when they do.
 */
function TenantLeases() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filter: AgreementFilter =
    agreementFilters.map((option) => option.id).find((id) => id === search.get("show")) ?? "all";
  const query = search.get("q") ?? "";
  // A plain click reads the agreement in a sheet over the list; the row is
  // still a link to `/leases/<id>`. `?agreement=` from elsewhere opens it once.
  const [openId, setOpenId] = useDeepLinkedModal("agreement");

  // A reload keeps what is on screen, so an accepted agreement updates in the
  // open sheet rather than the sheet losing it.
  const load = useCallback(async () => {
    setError("");
    try {
      setLeases(await listMyLeases());
    } catch (cause) {
      setLeases((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your agreements.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const retry = useCallback(async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  }, [load]);

  // Preserve old pane-era deep links by resolving them to the durable record.
  useEffect(() => {
    if (window.location.hash.startsWith("#agreement-")) {
      router.replace(`/record/lease?leaseId=${window.location.hash.slice("#agreement-".length)}` as never);
      return;
    }
    const requested = search.get("open");
    if (requested) router.replace(`/record/lease?leaseId=${requested}` as never);
  }, [router, search]);

  // `replace`, so filtering does not build a history trail somebody has to walk
  // back through to leave the page.
  const setParams = useCallback((changes: Record<string, string>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const queryString = next.toString();
    router.replace((queryString ? `${pathname}?${queryString}` : pathname) as never, { scroll: false });
  }, [pathname, router, search]);

  const chooseFilter = useCallback((nextFilter: AgreementFilter) => {
    setParams({ show: nextFilter === "all" ? "" : nextFilter });
  }, [setParams]);

  const rows = useMemo<TenantAgreementRow[]>(
    () => (leases ?? []).map((lease) => ({ lease, state: standing(lease), tone: agreementTone(lease) })),
    [leases],
  );

  const counts: Record<AgreementFilter, number> = useMemo(() => ({
    all: rows.length,
    action: rows.filter((row) => row.state.stage === "action").length,
    active: rows.filter((row) => row.state.stage === "active").length,
    past: rows.filter((row) => row.state.stage === "past").length,
  }), [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    const priority: Record<ReturnType<typeof standing>["stage"], number> = { action: 0, active: 1, past: 2 };
    return rows
      .filter((row) => matchesAgreementFilter(row.state.stage, filter))
      .filter((row) => {
        if (!needle) return true;
        const terms = agreedTerms(row.lease);
        return [terms.propertyTitle, terms.unitLabel, terms.bedLabel, terms.landlordName, row.lease.locality_name]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("en-GH")
          .includes(needle);
      })
      .sort((left, right) => priority[left.state.stage] - priority[right.state.stage]);
  }, [filter, query, rows]);

  const loading = leases === null;
  const none = !loading && rows.length === 0;
  const failed = Boolean(error) && none;
  const current = visible.filter((row) => row.state.stage !== "past");
  const history = visible.filter((row) => row.state.stage === "past");
  const waiting = rows.filter((row) => row.state.decisionOpen);
  // Controls earn their space: search once there is a list to search, the
  // stages once agreements sit in more than one of them.
  const showSearch = (leases?.length ?? 0) > 5 || Boolean(query);
  const showFilter = new Set(rows.map((row) => row.state.stage)).size > 1 || filter !== "all";
  const selectedLabel = agreementFilters.find((option) => option.id === filter)?.label ?? "Agreements";
  const unfilteredView = filter === "all" && !query.trim();
  const initialCurrentLimit = Math.min(current.length, history.length ? 4 : 5);
  const initialHistoryLimit = Math.min(history.length, Math.max(0, 5 - initialCurrentLimit));
  const opened = openId ? leases?.find((lease) => lease.id === openId) ?? null : null;
  const open = useCallback((lease: Lease) => setOpenId(lease.id), [setOpenId]);
  const first = waiting[0] ? agreedTerms(waiting[0].lease) : null;

  return (
    <div className="ws-page agreements-workspace">
      <WorkspaceHead
        icon="leases"
        title="Agreements"
        summary={loading || failed ? null : none ? "Tenancy agreements landlords send you wait here for your answer." : (
          <AgreementSummary counts={counts} />
        )}
      />

      {unfilteredView && waiting[0] && first ? (
        <NextUp
          eyebrow={waiting[0].state.line}
          title={first.propertyTitle}
          detail={[first.unitLabel, waiting[0].lease.locality_name].filter(Boolean).join(" · ")}
          hint={`${first.landlordName} sent this on ${onDate(waiting[0].lease.created_at)}. Read it, then accept or decline.`}
          icon="leases"
          more={{ count: waiting.length - 1, onShow: () => chooseFilter("action") }}
          onOpen={() => open(waiting[0]!.lease)}
          action={{ label: "Review & decide", onClick: () => open(waiting[0]!.lease) }}
        />
      ) : null}

      {showFilter ? (
        <SegmentedControl
          label="Agreement stage"
          value={filter}
          options={agreementFilters.map((option) => ({ key: option.id, label: option.label, count: counts[option.id] }))}
          onChange={chooseFilter}
        />
      ) : null}

      <section className="ws-panel agreements-panel" aria-label={unfilteredView ? "Your agreements" : `${selectedLabel} agreements`} aria-busy={loading || undefined}>
        {showSearch ? (
          <div className="ws-panel-head">
            <PanelSearch label="Search your agreements" placeholder="Search Property, Unit or landlord" value={query} onChange={(value) => setParams({ q: value })} />
            <p className="ws-range"><strong>{visible.length}</strong> of {counts.all}</p>
          </div>
        ) : null}

        {error && rows.length ? (
          <div className="ws-inline-error" role="alert">
            <Icon name="warning" /><span>{error}</span>
            <button type="button" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button>
          </div>
        ) : null}

        {loading ? <PanelSkeleton rows={3} /> : failed ? (
          <PanelState
            tone="error"
            icon="warning"
            title="Agreements didn’t load"
            body={`${error} Check your connection and try again.`}
            action={<button type="button" className="ws-action" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button>}
          />
        ) : none ? (
          <PanelState
            icon="leases"
            title="No agreement yet"
            body="When a landlord accepts your application and sends an agreement, it waits here for you to read and answer."
            action={<Link href="/applications" className="ws-action is-primary"><Icon name="applications" />See your applications</Link>}
          />
        ) : visible.length ? (
          <div className="ws-panel-body agreements-body" key={`${filter}:${query.trim() ? "q" : ""}`}>
            {unfilteredView ? (
              <>
                {current.length ? <AgreementGroup title="Current" rows={current} initialLimit={initialCurrentLimit} onOpen={open} /> : null}
                {history.length ? <AgreementGroup title="History" rows={history} initialLimit={initialHistoryLimit} historical onOpen={open} /> : null}
              </>
            ) : (
              <AgreementGroup
                key={`${filter}:${query}`}
                title={query ? "Matches" : selectedLabel}
                // The segment above already names a chosen stage.
                quiet={!query}
                rows={visible}
                initialLimit={5}
                historical={visible.every((row) => row.state.stage === "past")}
                onOpen={open}
              />
            )}
          </div>
        ) : query ? (
          <PanelState
            icon="explore"
            title={`Nothing matches “${query.trim()}”`}
            body="Try another Property, Unit or landlord."
            action={<button type="button" className="ws-action" onClick={() => setParams({ q: "" })}>Clear search</button>}
          />
        ) : (
          <AgreementFilterEmpty filter={filter} onShowAll={() => chooseFilter("all")} />
        )}
      </section>

      <AgreementSheet lease={opened} onChanged={load} onClose={() => setOpenId("")} />
    </div>
  );
}

type TenantAgreementRow = {
  lease: Lease;
  state: ReturnType<typeof standing>;
  tone: AgreementTone;
};

/** The head's one live line: what needs them first, then what is in place. */
function AgreementSummary({ counts }: { counts: Record<AgreementFilter, number> }) {
  const total = counts.all;
  return (
    <>
      {counts.action === 1 ? (
        <span data-tone="good">One agreement is waiting for your answer</span>
      ) : counts.action > 1 ? (
        <span data-tone="good">{counts.action} agreements are waiting for your answer</span>
      ) : counts.active ? (
        <strong>{counts.active} current</strong>
      ) : (
        <strong>Nothing waiting on you</strong>
      )}
      <span className="ws-summary-sep" aria-hidden="true">·</span>
      {total} agreement{total === 1 ? "" : "s"}
    </>
  );
}

function AgreementGroup({
  title,
  rows,
  initialLimit,
  historical = false,
  quiet = false,
  onOpen,
}: {
  title: string;
  rows: TenantAgreementRow[];
  initialLimit: number;
  historical?: boolean;
  /** No visible heading: something on screen already names this group. */
  quiet?: boolean;
  onOpen: (lease: Lease) => void;
}) {
  const pageSize = 5;
  const [limit, setLimit] = useState(initialLimit);
  const shown = rows.slice(0, limit);
  const remaining = rows.length - shown.length;
  const headingId = `agreements-${title.toLocaleLowerCase("en-GH").replace(/\s+/g, "-")}`;

  return (
    <section className={`ws-group agreement-group${historical ? " is-history" : ""}`} aria-labelledby={headingId}>
      <h2 className={`ws-group-heading${quiet ? " ws-visually-hidden" : ""}`} id={headingId}>
        {title}<span aria-label={`${rows.length} ${rows.length === 1 ? "agreement" : "agreements"}`}>{rows.length}</span>
      </h2>
      <ul className="agreements-list">
        {shown.map((row, index) => <AgreementRow key={row.lease.id} {...row} order={index} onOpen={onOpen} />)}
      </ul>
      {remaining > 0 ? (
        <button
          type="button"
          className="agreement-load-more"
          aria-label={`Show ${Math.min(pageSize, remaining)} more ${title.toLocaleLowerCase("en-GH")} agreements`}
          onClick={() => setLimit((currentLimit) => Math.min(currentLimit + pageSize, rows.length))}
        >
          <span>Show {Math.min(pageSize, remaining)} more</span>
          <Icon name="chevron-down" />
        </button>
      ) : null}
    </section>
  );
}

function AgreementFilterEmpty({ filter, onShowAll }: { filter: AgreementFilter; onShowAll: () => void }) {
  const copy: Record<AgreementFilter, { title: string; body: string }> = {
    all: { title: "No agreements here", body: "Your agreements will appear here." },
    action: { title: "Nothing needs you", body: "You have answered every agreement sent to you." },
    active: { title: "No current agreements", body: "Accepted agreements will stay easy to find here." },
    past: { title: "No agreement history", body: "Ended or declined agreements will remain available here." },
  };
  return (
    <PanelState
      icon={filter === "action" ? "check" : "leases"}
      title={copy[filter].title}
      body={copy[filter].body}
      action={filter === "all" ? undefined : <button type="button" className="ws-action" onClick={onShowAll}>Show all agreements</button>}
    />
  );
}

function agreementDate(lease: Lease, state: ReturnType<typeof standing>): { label: string; value: string } {
  const terms = agreedTerms(lease);
  if (state.stage === "action") return { label: "Sent", value: lease.created_at };
  if (state.stage === "past" && terms.endsOn) return { label: "Ended", value: terms.endsOn };
  if (lease.status === "active" && terms.endsOn) return { label: "Ends", value: terms.endsOn };
  if (terms.startsOn) return { label: "Starts", value: terms.startsOn };
  return { label: "Created", value: lease.created_at };
}

function AgreementRow({
  lease,
  state,
  tone,
  order,
  onOpen,
}: TenantAgreementRow & { order: number; onOpen: (lease: Lease) => void }) {
  const terms = agreedTerms(lease);
  const unit = [terms.unitLabel, terms.bedLabel].filter(Boolean).join(" · ");
  const date = agreementDate(lease, state);

  return (
    <li style={{ "--agreement-order": Math.min(order, 12) } as React.CSSProperties}>
      <Link
        href={`/record/lease?leaseId=${lease.id}` as never}
        className={`agreement-row is-${state.stage}`}
        data-tone={tone}
        aria-haspopup="dialog"
        aria-label={`Open the agreement for ${homeOf(terms)}. ${state.line}.`}
        onClick={(event) => {
          // A new tab or window goes to the record's own page, as a link should.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onOpen(lease);
        }}
      >
        <span className="agreement-row-mark" aria-hidden="true"><Icon name="leases" /></span>

        <span className="agreement-row-identity">
          <strong>{terms.propertyTitle}</strong>
          <span className="agreement-row-place">
            {unit ? <span className="agreement-row-unit">{unit}</span> : null}
            {lease.locality_name ? <span>{lease.locality_name}</span> : null}
          </span>
        </span>

        <span className={`agreement-row-standing is-${state.stage}`}>
          <i aria-hidden="true" />
          <strong>{state.line}</strong>
        </span>

        <span className="agreement-row-meta">
          <span>{money(terms.rentMinor, terms.rentCurrency)}<small> / {per(terms.rentPeriod)}</small></span>
          <time dateTime={date.value}>{date.label} {onDate(date.value)}</time>
        </span>

        <svg className="agreement-row-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}

/**
 * The provider's Leases page moved into Documents.
 *
 * A lease is a document, so it lives with the others at `/documents`, in its
 * Leases view, and opens over that page. Old addresses still arrive: the stage
 * and search carry across, and a `#lease-` link from the pane era opens that
 * agreement.
 */
function ProviderLeases() {
  const router = useRouter();
  const search = useSearchParams();

  useEffect(() => {
    const next = new URLSearchParams({ view: "leases" });
    const show = search.get("show");
    const query = search.get("q");
    if (show) next.set("show", show);
    if (query) next.set("q", query);
    if (window.location.hash.startsWith("#lease-")) next.set("lease", window.location.hash.slice("#lease-".length));
    router.replace(`/documents?${next.toString()}` as never);
  }, [router, search]);

  return <><PageHeader title="Documents" /><LoadingRows /></>;
}
