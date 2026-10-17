"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { ApplicationSheet, applicationTone, type ApplicationTone } from "@/components/applications/ApplicationRecord";
import { RequestModal } from "@/components/requests/RequestModal";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { Icon } from "@/components/portal/icons";
import { DonutRing, type RingTone } from "@/components/workspace/DonutRing";
import { NextUp, PanelSearch, PanelSkeleton, PanelState, SegmentedControl, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { useDeepLinkedModal } from "@/lib/deepLinkedModal";
import {
  applicationBucket,
  applicationFilters,
  matchesApplicationFilter,
  shortfallNote,
  standing,
  type ApplicationFilter,
} from "@/lib/applicationMeaning";
import { type Lease } from "@/lib/console";
import { useSession } from "@/lib/session";
import {
  formatRequestDate,
  REQUEST_FILTERS,
  requestCreatedAt,
  requestFilterLabel,
  requestOutcome,
  requestRecordId,
  requestSearchText,
  requestStage,
  requestStatus,
  requestTone,
  requestWhere,
  requestWho,
  type RequestFilter,
  type RequestItem,
} from "@/lib/tenancyRequests";
import { useProviderRequests } from "@/lib/useProviderRequests";
import { listMyApplications, listMyLeases, type MyApplication } from "@/lib/tenant";
import { onDate } from "@/lib/time";

/**
 * Applications, from whichever side this account is on.
 *
 * One route because it is one idea — "applications that concern me" — and the
 * two readings never overlap: a tenant sees what they sent, a provider sees
 * what they received. The endpoints differ and the backend scopes each to the
 * caller, so this branch is presentation, not permission.
 */
export default function ApplicationsPage() {
  const { state } = useSession();
  if (state.status === "loading") {
    return <><PageHeader title="Applications" /><LoadingRows /></>;
  }
  if (state.status !== "signed_in") return null;
  const provider = state.me.capabilities;
  const asProvider =
    provider.active_workspace === "provider" && provider.provider.workspace_access;
  return asProvider ? (
    <Suspense fallback={<><PageHeader title="Tenancy requests" /><LoadingRows rows={4} /></>}>
      <ProviderApplications />
    </Suspense>
  ) : (
    <Suspense fallback={<><PageHeader title="Applications" /><LoadingRows rows={3} /></>}>
      <TenantApplications />
    </Suspense>
  );
}

/**
 * Places this person has applied for, on the shared workspace.
 *
 * Four questions, in this order: where did I apply, where does it stand, is
 * anything needed from me, and what happens next. The head answers the third
 * in one live line; an agreement waiting for them is lifted above the list as
 * the one thing worth doing; and each row answers the rest — the photograph for
 * where (a tenant recognises a place by looking at it), `standing()` for where
 * it stands and what follows, in one line rather than a status word and an
 * explanation of it.
 *
 * Everything else — what was offered, what was told to the landlord, the
 * guarantor, the landlord's note — is in the record behind the row, which opens
 * in a sheet over the list and is kept in the address.
 */
function TenantApplications() {
  const [applications, setApplications] = useState<MyApplication[] | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filter: ApplicationFilter =
    applicationFilters.map((option) => option.id).find((id) => id === search.get("show")) ?? "all";
  const query = search.get("q") ?? "";
  // A plain click reads the record in a sheet over the list; the row is still
  // a link to `/applications/<id>`. `?application=` from elsewhere opens it once.
  const [openId, setOpenId] = useDeepLinkedModal("application");

  // A reload keeps what is on screen: the sheet reading an application must not
  // lose it mid-withdrawal because the list blanked behind it.
  const load = useCallback(async () => {
    setError("");
    try {
      // Acceptance is not the end of the story, and the story lives in the
      // lease. Read-only join: what the tenant may already see at /leases.
      const [nextApplications, nextLeases] = await Promise.all([
        listMyApplications(),
        listMyLeases().catch(() => [] as Lease[]),
      ]);
      setApplications(nextApplications);
      setLeases(nextLeases);
    } catch (cause) {
      setApplications((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your applications.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const retry = useCallback(async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  }, [load]);

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

  const chooseFilter = useCallback((nextFilter: ApplicationFilter) => {
    setParams({ show: nextFilter === "all" ? "" : nextFilter });
  }, [setParams]);

  const rows = useMemo<TenantApplicationRow[]>(
    () => (applications ?? []).map((application) => ({
      application,
      standing: standing(application, leases),
      bucket: applicationBucket(application, leases),
      tone: applicationTone(application, leases),
    })),
    [applications, leases],
  );

  const counts: Record<ApplicationFilter, number> = useMemo(() => ({
    all: rows.length,
    action: rows.filter((row) => row.bucket === "action").length,
    open: rows.filter((row) => row.bucket === "open").length,
    approved: rows.filter((row) => row.bucket === "approved").length,
    past: rows.filter((row) => row.bucket === "past").length,
  }), [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    const priority: Record<TenantApplicationRow["bucket"], number> = {
      action: 0,
      open: 1,
      approved: 2,
      past: 3,
    };
    return rows
      .filter((row) => matchesApplicationFilter(row.bucket, filter))
      .filter((row) => {
        if (!needle) return true;
        const application = row.application;
        return [
          application.property_title,
          application.unit_label,
          application.space_type_label,
          application.locality_name,
          application.listing_headline,
        ].filter(Boolean).join(" ").toLocaleLowerCase("en-GH").includes(needle);
      })
      .sort((left, right) => priority[left.bucket] - priority[right.bucket]);
  }, [filter, query, rows]);

  const loading = applications === null;
  const none = !loading && rows.length === 0;
  const failed = Boolean(error) && none;
  const current = visible.filter((row) => row.bucket !== "past");
  const history = visible.filter((row) => row.bucket === "past");
  const ready = rows.filter((row) => row.bucket === "action");
  // Controls earn their space: search once there is a list to search, the
  // stages once applications sit in more than one of them.
  const showSearch = (applications?.length ?? 0) > 5 || Boolean(query);
  const showFilter = new Set(rows.map((row) => row.bucket)).size > 1 || filter !== "all";
  const selectedLabel = applicationFilters.find((option) => option.id === filter)?.label ?? "Applications";
  const unfilteredView = filter === "all" && !query.trim();
  const initialCurrentLimit = Math.min(current.length, history.length ? 4 : 5);
  const initialHistoryLimit = Math.min(history.length, Math.max(0, 5 - initialCurrentLimit));
  const opened = openId ? applications?.find((application) => application.id === openId) ?? null : null;
  const open = setOpenId;

  return (
    <div className="ws-page applications-workspace">
      <WorkspaceHead
        icon="applications"
        title="Applications"
        summary={loading || failed ? null : none ? "Places you apply for are followed here, from sent to signed." : (
          <ApplicationSummary counts={counts} />
        )}
        actions={none || loading ? null : (
          <Link href="/rentals" className="ws-action"><Icon name="explore" />Find rentals</Link>
        )}
      />

      {unfilteredView && ready.length ? (
        <NextUp
          eyebrow={ready[0]!.standing.line}
          title={ready[0]!.application.property_title || ready[0]!.application.listing_headline}
          detail={[ready[0]!.application.unit_label, ready[0]!.application.locality_name].filter(Boolean).join(" · ")}
          hint="The landlord has sent your tenancy agreement to read and sign."
          photoUrl={ready[0]!.application.photo_url}
          icon="leases"
          more={{ count: ready.length - 1, onShow: () => chooseFilter("action") }}
          onOpen={() => open(ready[0]!.application.id)}
          action={{ label: "Review agreement", href: ready[0]!.standing.leaseId ? `/leases/${ready[0]!.standing.leaseId}` : "/leases" }}
        />
      ) : null}

      {showFilter ? (
        <SegmentedControl
          label="Application stage"
          value={filter}
          options={applicationFilters.map((option) => ({ key: option.id, label: option.label, count: counts[option.id] }))}
          onChange={chooseFilter}
        />
      ) : null}

      <section className="ws-panel applications-panel" aria-label={unfilteredView ? "Your applications" : `${selectedLabel} applications`} aria-busy={loading || undefined}>
        {showSearch ? (
          <div className="ws-panel-head">
            <PanelSearch label="Search your applications" placeholder="Search Property, Unit or place" value={query} onChange={(value) => setParams({ q: value })} />
            <p className="ws-range"><strong>{visible.length}</strong> of {counts.all}</p>
          </div>
        ) : null}

        {error && rows.length ? (
          <div className="ws-inline-error" role="alert">
            <Icon name="warning" /><span>{error}</span>
            <button type="button" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button>
          </div>
        ) : null}

        {/* The square mark is the photograph's shape, so nothing jumps when the rows land. */}
        {loading ? <PanelSkeleton rows={3} /> : failed ? (
          <PanelState
            tone="error"
            icon="warning"
            title="Applications didn’t load"
            body={`${error} Check your connection and try again.`}
            action={<button type="button" className="ws-action" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button>}
          />
        ) : none ? (
          <PanelState
            icon="applications"
            title="Your rental journey starts here"
            body="When you apply for a rental, you can follow it here — from the landlord reading it to the agreement you sign."
            action={<Link href="/rentals" className="ws-action is-primary"><Icon name="explore" />Explore rentals</Link>}
          />
        ) : visible.length ? (
          <div className="ws-panel-body applications-body" key={`${filter}:${query.trim() ? "q" : ""}`}>
            {unfilteredView ? (
              <>
                {current.length ? <ApplicationGroup title="Current" rows={current} initialLimit={initialCurrentLimit} onOpen={open} /> : null}
                {history.length ? <ApplicationGroup title="History" rows={history} initialLimit={initialHistoryLimit} historical onOpen={open} /> : null}
              </>
            ) : (
              <ApplicationGroup
                key={`${filter}:${query}`}
                title={query ? "Matches" : selectedLabel}
                // The segment above already names a chosen stage.
                quiet={!query}
                rows={visible}
                initialLimit={5}
                historical={visible.every((row) => row.bucket === "past")}
                onOpen={open}
              />
            )}
          </div>
        ) : query ? (
          <PanelState
            icon="explore"
            title={`Nothing matches “${query.trim()}”`}
            body="Try another Property, Unit or place."
            action={<button type="button" className="ws-action" onClick={() => setParams({ q: "" })}>Clear search</button>}
          />
        ) : (
          <ApplicationFilterEmpty filter={filter} onShowAll={() => chooseFilter("all")} />
        )}
      </section>

      <ApplicationSheet
        application={opened}
        leases={leases}
        onChanged={load}
        onClose={() => setOpenId("")}
      />
    </div>
  );
}

type TenantApplicationRow = {
  application: MyApplication;
  standing: ReturnType<typeof standing>;
  bucket: ReturnType<typeof applicationBucket>;
  tone: ApplicationTone;
};

/** The head's one live line: what needs them first, then what is moving. */
function ApplicationSummary({ counts }: { counts: Record<ApplicationFilter, number> }) {
  const total = counts.all;
  return (
    <>
      {counts.action === 1 ? (
        <span data-tone="good">An agreement is ready for you</span>
      ) : counts.action > 1 ? (
        <span data-tone="good">{counts.action} agreements are ready for you</span>
      ) : counts.open ? (
        <strong>{counts.open} in progress</strong>
      ) : (
        <strong>Nothing waiting on you</strong>
      )}
      <span className="ws-summary-sep" aria-hidden="true">·</span>
      {total} application{total === 1 ? "" : "s"}
    </>
  );
}

function ApplicationGroup({
  title,
  rows,
  initialLimit,
  historical = false,
  quiet = false,
  onOpen,
}: {
  title: string;
  rows: TenantApplicationRow[];
  initialLimit: number;
  historical?: boolean;
  /** No visible heading: something on screen already names this group. */
  quiet?: boolean;
  onOpen: (applicationId: string) => void;
}) {
  const pageSize = 5;
  const [limit, setLimit] = useState(initialLimit);
  const shown = rows.slice(0, limit);
  const remaining = rows.length - shown.length;
  const headingId = `applications-${title.toLocaleLowerCase("en-GH").replace(/\s+/g, "-")}`;

  return (
    <section className={`ws-group application-group${historical ? " is-history" : ""}`} aria-labelledby={headingId}>
      <h2 className={`ws-group-heading${quiet ? " ws-visually-hidden" : ""}`} id={headingId}>
        {title}<span aria-label={`${rows.length} ${rows.length === 1 ? "application" : "applications"}`}>{rows.length}</span>
      </h2>
      <ul className="applications-list">
        {shown.map((row, index) => <ApplicationRow key={row.application.id} {...row} order={index} onOpen={onOpen} />)}
      </ul>
      {remaining > 0 ? (
        <button
          type="button"
          className="application-load-more"
          aria-label={`Show ${Math.min(pageSize, remaining)} more ${title.toLocaleLowerCase("en-GH")} applications`}
          onClick={() => setLimit((currentLimit) => Math.min(currentLimit + pageSize, rows.length))}
        >
          <span>Show {Math.min(pageSize, remaining)} more</span>
          <Icon name="chevron-down" />
        </button>
      ) : null}
    </section>
  );
}

function ApplicationFilterEmpty({ filter, onShowAll }: { filter: ApplicationFilter; onShowAll: () => void }) {
  const copy: Record<ApplicationFilter, { title: string; body: string }> = {
    all: { title: "No applications here", body: "Your applications will appear here." },
    action: { title: "Nothing needs you", body: "You are up to date on every application." },
    open: { title: "Nothing in progress", body: "No application is waiting for a decision." },
    approved: { title: "No approvals yet", body: "Approved applications will stay easy to find here." },
    past: { title: "No application history", body: "Closed applications will remain available here." },
  };
  return (
    <PanelState
      icon={filter === "action" ? "check" : "applications"}
      title={copy[filter].title}
      body={copy[filter].body}
      action={filter === "all" ? undefined : <button type="button" className="ws-action" onClick={onShowAll}>Show all applications</button>}
    />
  );
}

function ApplicationRow({
  application,
  standing: state,
  bucket,
  tone,
  order,
  onOpen,
}: TenantApplicationRow & { order: number; onOpen: (applicationId: string) => void }) {
  const short = shortfallNote(application);
  const property = application.property_title || application.listing_headline;
  const unit = [application.unit_label, application.space_type_label].filter(Boolean).join(" · ");

  return (
    <li style={{ "--application-order": Math.min(order, 12) } as React.CSSProperties}>
      <Link
        href={`/applications/${application.id}` as never}
        className={`application-row is-${bucket}`}
        data-tone={tone}
        aria-haspopup="dialog"
        aria-label={`Open the application for ${property}, ${application.unit_label}. ${state.line}.`}
        onClick={(event) => {
          // A new tab or window goes to the record's own page, as a link should.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onOpen(application.id);
        }}
      >
        <span className="application-photo">
          {application.photo_url ? (
            /* Short-lived signed URLs from the files service. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={application.photo_url} alt="" />
          ) : (
            <span className="application-photo-fallback" aria-hidden="true"><Icon name="properties" /></span>
          )}
        </span>

        <span className="application-identity">
          <strong>{property}</strong>
          <span className="application-place">
            {unit ? <span className="application-unit">{unit}</span> : null}
            {application.locality_name ? <span>{application.locality_name}</span> : null}
          </span>
        </span>

        <span className={`application-standing is-${state.stage}`}>
          <span className="application-status-line"><i aria-hidden="true" /><strong>{state.line}</strong></span>
          {short ? <small>{short}</small> : null}
        </span>

        <span className="application-row-meta">
          {application.rent_formatted ? (
            <span>{application.rent_formatted}<small> / month</small></span>
          ) : null}
          <time dateTime={application.created_at}>Sent {onDate(application.created_at)}</time>
        </span>

        <svg className="application-row-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}

/**
 * Tenancy requests received, for a landlord or agent.
 *
 * The shared workspace: the counts first, as three rings — where every request
 * stands, and how often a decision went each way — then the stages as a
 * segmented control and one panel of requests. Every row is a link, so a
 * request can be opened in a new tab, sent to a colleague, or come back from
 * history — none of which a dialog could do.
 */
function ProviderApplications() {
  const router = useRouter();
  const { items, portfolioName, error, unauthorised, reload } = useProviderRequests();

  const search = useSearchParams();
  const pathname = usePathname();
  const stage: RequestFilter =
    REQUEST_FILTERS.find((value) => value === search.get("show")) ?? "action";
  const query = search.get("q") ?? "";
  // A plain click reads the request in a sheet over the list; the row is still
  // a link to `/applications/<id>`. `?request=` from a lease opens it once.
  const [openId, setOpenId] = useDeepLinkedModal("request");
  const opened = openId ? items?.find((item) => requestRecordId(item) === openId) ?? null : null;

  useEffect(() => {
    if (unauthorised) router.push("/sign-in");
  }, [router, unauthorised]);

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

  const counts = useMemo(() => {
    const rows = items ?? [];
    return {
      all: rows.length,
      action: rows.filter((item) => requestStage(item) === "action").length,
      agreement: rows.filter((item) => requestStage(item) === "agreement").length,
      history: rows.filter((item) => requestStage(item) === "history").length,
    };
  }, [items]);

  // Only decisions the server actually recorded. Somebody who withdrew their own
  // application was not declined, so the three do not sum to the total.
  const outcomes = useMemo(() => {
    const rows = items ?? [];
    return {
      total: rows.length,
      accepted: rows.filter((item) => requestOutcome(item) === "accepted").length,
      declined: rows.filter((item) => requestOutcome(item) === "declined").length,
    };
  }, [items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (items ?? [])
      .filter((item) => stage === "all" || requestStage(item) === stage)
      .filter((item) => !needle || requestSearchText(item).toLocaleLowerCase("en-GH").includes(needle));
  }, [items, query, stage]);

  const loading = items === null;
  const none = items !== null && items.length === 0;
  const decided = outcomes.accepted + outcomes.declined;
  const chooseStage = (value: RequestFilter) => setParams({ show: value === "action" ? "" : value });

  return (
    <div className="ws-page requests-workspace">
      <WorkspaceHead
        icon="applications"
        title="Tenancy requests"
        summary={loading || none ? "Review people asking to rent, then prepare an agreement when you are ready." : (
          <>
            {counts.action ? <span data-tone="warning">{counts.action} need{counts.action === 1 ? "s" : ""} a decision</span> : <strong>Nothing waiting on you</strong>}
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {counts.agreement} agreement{counts.agreement === 1 ? "" : "s"} to prepare
          </>
        )}
      />

      <dl className="requests-overview" aria-busy={loading || undefined}>
        <div className="requests-figure is-total">
          <DonutRing
            label={`${outcomes.total} requests: ${counts.action} need a decision, ${counts.agreement} need an agreement, ${counts.history} settled`}
            segments={[
              { value: counts.action, tone: "harmattan" },
              { value: counts.agreement, tone: "lagoon" },
              { value: counts.history, tone: "slate" },
            ]}
          >
            <strong>{loading ? "–" : outcomes.total}</strong>
          </DonutRing>
          <div className="requests-figure-copy">
            <dt>Total requests</dt>
            <dd>
              <ul className="requests-legend">
                <LegendItem tone="harmattan" label="Needs a decision" value={counts.action} active={stage === "action"} onPick={() => chooseStage("action")} />
                <LegendItem tone="lagoon" label="Agreement due" value={counts.agreement} active={stage === "agreement"} onPick={() => chooseStage("agreement")} />
                <LegendItem tone="slate" label="Settled" value={counts.history} active={stage === "history"} onPick={() => chooseStage("history")} />
              </ul>
            </dd>
          </div>
        </div>
        <OutcomeFigure label="Accepted" tone="accepted" value={outcomes.accepted} decided={decided} loading={loading} />
        <OutcomeFigure label="Declined" tone="declined" value={outcomes.declined} decided={decided} loading={loading} />
      </dl>

      {none ? null : (
        <SegmentedControl
          label="Request stage"
          value={stage}
          disabled={loading}
          options={REQUEST_FILTERS.map((value) => ({ key: value, label: requestFilterLabel(value), count: counts[value] }))}
          onChange={chooseStage}
        />
      )}

      <section className="ws-panel requests-panel" aria-label="Tenancy requests" aria-busy={loading || undefined}>
        {none ? null : (
          <div className="ws-panel-head">
            <PanelSearch label="Search tenancy requests" placeholder="Search person, Property or Unit" value={query} onChange={(value) => setParams({ q: value })} />
            <p className="ws-range"><strong>{visible.length}</strong> of {counts.all}</p>
          </div>
        )}

        {error && items?.length ? (
          <div className="ws-inline-error" role="alert">
            <Icon name="warning" /><span>{error}</span>
            <button type="button" onClick={() => void reload()}>Try again</button>
          </div>
        ) : null}

        {loading ? <PanelSkeleton rows={4} round /> : error && none ? (
          <PanelState tone="error" icon="warning" title="Requests didn’t load" body={error}
            action={<button type="button" className="ws-action" onClick={() => void reload()}>Try again</button>} />
        ) : none ? (
          <PanelState
            icon="applications"
            title="No tenancy requests yet"
            body="Applications against your listings and direct requests to join a Unit both arrive here."
            action={<Link href={"/units" as never} className="ws-action is-primary"><Icon name="units" />Open Units</Link>}
          />
        ) : visible.length ? (
          <ul className="requests-list">
            {visible.map((item, index) => (
              <RequestRow key={item.key} item={item} order={index} onPeek={() => setOpenId(requestRecordId(item))} />
            ))}
          </ul>
        ) : (
          <PanelState
            icon="applications"
            title={query ? "No matching requests" : stage === "action" ? "Nothing needs a decision" : stage === "agreement" ? "No agreements to prepare" : stage === "history" ? "No request history yet" : "No tenancy requests yet"}
            body={query ? "Try a different person, Property or Unit." : stage === "action" ? "New public applications and private tenancy requests appear here." : stage === "agreement" ? "Accepted requests move here until their agreement is sent." : stage === "history" ? "Settled requests remain available as a record." : "Applications against your listings and direct requests to join a Unit both arrive here."}
          />
        )}
      </section>

      <RequestModal item={opened} portfolioName={portfolioName} onClose={() => setOpenId("")} onChanged={reload} />
    </div>
  );
}

function LegendItem({ tone, label, value, active, onPick }: { tone: RingTone; label: string; value: number; active: boolean; onPick: () => void }) {
  return (
    <li>
      <button type="button" className={`requests-legend-item is-${tone}`} aria-pressed={active} onClick={onPick}>
        <i aria-hidden="true" />
        <span>{label}</span>
        <strong>{value}</strong>
      </button>
    </li>
  );
}

/** One way a decision can go, as a share of every decision made. */
function OutcomeFigure({ label, tone, value, decided, loading }: { label: string; tone: "accepted" | "declined"; value: number; decided: number; loading: boolean }) {
  const share = decided ? Math.round((value / decided) * 100) : null;
  return (
    <div className={`requests-figure is-${tone}`}>
      <DonutRing
        label={share === null ? `${label}: no decisions yet` : `${label}: ${value} of ${decided} decisions, ${share}%`}
        segments={[
          { value, tone: tone === "accepted" ? "kola" : "laterite" },
          { value: decided - value, tone: "muted" },
        ]}
      >
        <strong>{loading || share === null ? "–" : `${share}%`}</strong>
      </DonutRing>
      <div className="requests-figure-copy">
        <dt>{label}</dt>
        <dd>
          <span className="requests-figure-value" data-tone={value > 0 ? tone : undefined}>{loading ? "–" : value}</span>
          <small>{share === null ? "No decisions yet" : `of ${decided} decision${decided === 1 ? "" : "s"}`}</small>
        </dd>
      </div>
    </div>
  );
}

function RequestRow({ item, order, onPeek }: { item: RequestItem; order: number; onPeek: () => void }) {
  const who = requestWho(item);
  return (
    <li style={{ "--request-order": Math.min(order, 12) } as React.CSSProperties}>
      <Link
        href={`/applications/${requestRecordId(item)}` as never}
        className="request-row"
        aria-haspopup="dialog"
        onClick={(event) => {
          // A new tab or window goes to the request's own page, as a link should.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          onPeek();
        }}
      >
        <span className="request-row-avatar" aria-hidden="true">{initialsOf(who)}</span>
        <span className="request-row-person">
          <strong>{who}</strong>
          <span>{item.kind === "application" ? "Public listing" : "Direct request"}</span>
        </span>
        <span className="request-row-place">{requestWhere(item)}</span>
        <span className={`request-row-state is-${requestTone(item)}`}><i />{requestStatus(item)}</span>
        <span className="request-row-time">{formatRequestDate(requestCreatedAt(item))}</span>
        <svg className="request-row-arrow" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
