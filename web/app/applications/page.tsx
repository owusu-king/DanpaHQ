"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApplicationDetailModal } from "@/components/applications/ApplicationRecord";
import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { Icon } from "@/components/portal/icons";
import { ApiFailure } from "@/lib/api";
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
 * Applications received, for a landlord or agent.
 *
 * The advance shortfall leads every card. It is what the decision turns on in
 * this market, and putting it below occupation and household size would mean
 * reading four fields to reach the one that settles it.
 */
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
    <TenantApplications />
  );
}

/**
 * Places this person has applied for.
 *
 * Four questions, in this order: where did I apply, where does it stand, is
 * anything needed from me, and what happens next. The photograph answers the
 * first — a tenant recognizes a place by looking at it, not by reading a
 * headline — and `standing()` collapses the last three into one line, so a row
 * never carries a status word *and* an explanation of that status word.
 *
 * Everything else — what was offered, what was told to the landlord, the
 * guarantor, the landlord's note — is in the record behind the row. A tenant
 * scanning five applications is not re-reading their own income band.
 */
function TenantApplications() {
  const [applications, setApplications] = useState<MyApplication[] | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [error, setError] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const filterRoot = useRef<HTMLDivElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);

  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filter: ApplicationFilter =
    applicationFilters.map((option) => option.id).find((id) => id === search.get("show")) ?? "all";
  const query = search.get("q") ?? "";

  const load = useCallback(async () => {
    setApplications(null);
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
      setApplications([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your applications.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!filterOpen) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!filterRoot.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFilterOpen(false);
      filterButton.current?.focus();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [filterOpen]);

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
    setFilterOpen(false);
    filterButton.current?.focus();
  }, [setParams]);

  const rows = useMemo<TenantApplicationRow[]>(
    () => (applications ?? []).map((application) => ({
      application,
      standing: standing(application, leases),
      bucket: applicationBucket(application, leases),
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

  const current = visible.filter((row) => row.bucket !== "past");
  const history = visible.filter((row) => row.bucket === "past");
  const showSearch = (applications?.length ?? 0) > 5 || Boolean(query);
  const showFilter = new Set(rows.map((row) => row.bucket)).size > 1 || filter !== "all";
  const selectedLabel = applicationFilters.find((option) => option.id === filter)?.label ?? "Applications";
  const unfilteredView = filter === "all" && !query.trim();
  const initialCurrentLimit = Math.min(current.length, history.length ? 4 : 5);
  const initialHistoryLimit = Math.min(history.length, Math.max(0, 5 - initialCurrentLimit));
  const selectedApplication = applications?.find((application) => application.id === selectedApplicationId) ?? null;

  return (
    <div className="applications tenant-applications">
      <PageHeader
        title="Applications"
        description={applications === null || error ? undefined : applicationSummary(counts, rows.length)}
      />

      {applications === null ? (
        <ApplicationLoading />
      ) : error ? (
        <div className="applications-error">
          <Notice tone="error" title={error} body="Check your connection and try again." />
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      ) : applications.length === 0 ? (
        <div className="applications-empty">
          <Empty
            title="Your rental journey starts here"
            body="When you apply for a rental, its progress will appear here."
            action={<Link href="/rentals" className="type-body-strong">Explore rentals &rarr;</Link>}
          />
        </div>
      ) : (
        <>
          {showSearch || showFilter ? (
            <div className="applications-tools">
              {showSearch ? (
                <label className="applications-search">
                  <span className="sr-only">Search your applications</span>
                  <Icon name="explore" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setParams({ q: event.target.value })}
                    placeholder="Search Property, Unit or place"
                  />
                </label>
              ) : <span />}
              {showFilter ? (
                <div className="applications-filter" ref={filterRoot}>
                  <button
                    ref={filterButton}
                    type="button"
                    className={`application-filter-trigger${filter !== "all" ? " is-active" : ""}`}
                    aria-expanded={filterOpen}
                    aria-haspopup="menu"
                    aria-controls="application-filter-menu"
                    onClick={() => setFilterOpen((open) => !open)}
                  >
                    <Icon name="filters" />
                    <span className="application-filter-label">
                      {filter === "all" ? "All applications" : selectedLabel}
                    </span>
                    <Icon name="chevron-down" />
                  </button>

                  {filterOpen ? (
                    <div id="application-filter-menu" className="application-filter-panel" role="menu" aria-label="Application view">
                      <ApplicationFilterOption id="all" current={filter} count={counts.all} onSelect={chooseFilter} />
                      <div className="application-filter-group" role="group" aria-label="Active journey">
                        <span className="application-filter-group-label">Active journey</span>
                        {(["action", "open", "approved"] as const).map((id) => (
                          <ApplicationFilterOption key={id} id={id} current={filter} count={counts[id]} onSelect={chooseFilter} />
                        ))}
                      </div>
                      <div className="application-filter-group" role="group" aria-label="History">
                        <span className="application-filter-group-label">History</span>
                        <ApplicationFilterOption id="past" current={filter} count={counts.past} onSelect={chooseFilter} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {visible.length ? (
            <div className="applications-results">
              {unfilteredView ? (
                <>
                  {current.length ? <ApplicationGroup title="Current" rows={current} initialLimit={initialCurrentLimit} onOpen={setSelectedApplicationId} /> : null}
                  {history.length ? <ApplicationGroup title="History" rows={history} initialLimit={initialHistoryLimit} historical onOpen={setSelectedApplicationId} /> : null}
                </>
              ) : (
                <ApplicationGroup
                  key={`${filter}:${query}`}
                  title={query ? "Matches" : selectedLabel}
                  rows={visible}
                  initialLimit={5}
                  historical={visible.every((row) => row.bucket === "past")}
                  onOpen={setSelectedApplicationId}
                />
              )}
            </div>
          ) : query ? (
            <Empty title="No matching applications" body="Try another Property, Unit or place." />
          ) : (
            <ApplicationFilterEmpty filter={filter} />
          )}

          {selectedApplication ? (
            <ApplicationDetailModal
              key={selectedApplication.id}
              application={selectedApplication}
              leases={leases}
              onChanged={load}
              onClose={() => setSelectedApplicationId(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

type TenantApplicationRow = {
  application: MyApplication;
  standing: ReturnType<typeof standing>;
  bucket: ReturnType<typeof applicationBucket>;
};

function applicationSummary(counts: Record<ApplicationFilter, number>, total: number): string {
  if (counts.action === 1) return `An agreement is ready for you \u00B7 ${total} application${total === 1 ? "" : "s"}`;
  if (counts.action > 1) return `${counts.action} agreements are ready for you \u00B7 ${total} applications`;
  if (counts.open > 0) return `${counts.open} in progress \u00B7 ${total} application${total === 1 ? "" : "s"}`;
  return `${total} application record${total === 1 ? "" : "s"}`;
}

function ApplicationLoading() {
  return (
    <div className="applications-loading" role="status" aria-label="Loading applications">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="application-loading-row" key={index} aria-hidden="true">
          <span className="skeleton application-loading-photo" />
          <span className="application-loading-copy">
            <i className="skeleton" />
            <i className="skeleton" />
          </span>
          <span className="skeleton application-loading-status" />
        </div>
      ))}
    </div>
  );
}

function ApplicationFilterOption({
  id,
  current,
  count,
  onSelect,
}: {
  id: ApplicationFilter;
  current: ApplicationFilter;
  count: number;
  onSelect: (filter: ApplicationFilter) => void;
}) {
  const label = applicationFilters.find((option) => option.id === id)?.label ?? id;
  const active = current === id;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`application-filter-option${active ? " is-selected" : ""}`}
      onClick={() => onSelect(id)}
    >
      <span>{label}</span>
      <small>{count}</small>
      <span className="application-filter-mark" aria-hidden="true">
        {active ? <Icon name="check" /> : null}
      </span>
    </button>
  );
}

function ApplicationGroup({
  title,
  rows,
  initialLimit,
  historical = false,
  onOpen,
}: {
  title: string;
  rows: TenantApplicationRow[];
  initialLimit: number;
  historical?: boolean;
  onOpen: (applicationId: string) => void;
}) {
  const pageSize = 5;
  const [limit, setLimit] = useState(initialLimit);
  const shown = rows.slice(0, limit);
  const remaining = rows.length - shown.length;

  return (
    <section className={`application-group${historical ? " is-history" : ""}`}>
      <header className="application-group-head">
        <h2>{title}</h2>
        <span aria-label={`${rows.length} ${rows.length === 1 ? "application" : "applications"}`}>{rows.length}</span>
      </header>
      <ul className="applications-list">
        {shown.map((row) => <ApplicationRow key={row.application.id} {...row} onOpen={onOpen} />)}
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

function ApplicationFilterEmpty({ filter }: { filter: ApplicationFilter }) {
  const copy: Record<ApplicationFilter, { title: string; body: string }> = {
    all: { title: "No applications here", body: "Your applications will appear here." },
    action: { title: "Nothing needs you", body: "You are up to date on every application." },
    open: { title: "Nothing in progress", body: "No application is waiting for a decision." },
    approved: { title: "No approvals yet", body: "Approved applications will stay easy to find here." },
    past: { title: "No application history", body: "Closed applications will remain available here." },
  };
  return (
    <div className="application-filter-empty" role="status">
      <strong>{copy[filter].title}</strong>
      <span>{copy[filter].body}</span>
    </div>
  );
}

function ApplicationRow({
  application,
  standing: state,
  bucket,
  onOpen,
}: TenantApplicationRow & { onOpen: (applicationId: string) => void }) {
  const short = shortfallNote(application);
  const property = application.property_title || application.listing_headline;
  const unit = [application.unit_label, application.space_type_label].filter(Boolean).join(" \u00B7 ");

  return (
    <li>
      <Link
        href={`/applications/${application.id}` as never}
        className={`application-row is-${bucket}`}
        aria-label={`Open the application for ${property}, ${application.unit_label}. ${state.line}.`}
        onClick={(event) => {
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
          {unit ? <span className="application-unit">{unit}</span> : null}
          {application.locality_name ? <span className="application-place">{application.locality_name}</span> : null}
        </span>

        <span className={`application-standing is-${state.stage}`}>
          <span className="application-status-line"><i aria-hidden="true" /><strong>{state.line}</strong></span>
          {short ? <small>{short}</small> : null}
        </span>

        <span className="application-row-meta">
          {application.rent_formatted ? (
            <span>{application.rent_formatted}<small> / month</small></span>
          ) : null}
          <time dateTime={application.created_at}>Submitted {onDate(application.created_at)}</time>
        </span>

        <span className="application-row-action">
          <span className="application-row-action-label">{state.stage === "action" ? "Review" : "View"}</span>
          <Icon name="chevron-down" />
        </span>
      </Link>
    </li>
  );
}

/**
 * Tenancy requests received, for a landlord or agent.
 *
 * Laid out the way Payments is, because they are the same job: a stack of
 * things people have sent you, worked through in an order, each one opening a
 * record where a decision gets made. A provider should learn that shape once.
 *
 * Three counts across the top, then a search, then the stages as filter pills,
 * then the list. Every row is a link, so a request can be opened in a new tab,
 * sent to a colleague, or come back from history — none of which a dialog
 * could do.
 */
function ProviderApplications() {
  const router = useRouter();
  const { items, error, unauthorised } = useProviderRequests();

  const search = useSearchParams();
  const pathname = usePathname();
  const stage: RequestFilter =
    REQUEST_FILTERS.find((value) => value === search.get("show")) ?? "action";
  const query = search.get("q") ?? "";

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

  return (
    <div className="requests-workspace">
      <PageHeader title="Tenancy requests" description="Review people asking to rent, then prepare an agreement when you are ready." />
      {error ? <Notice tone="error" title={error} /> : null}

      <dl className="requests-overview">
        <CountFact label="Total requests" value={outcomes.total} />
        <CountFact label="Accepted" value={outcomes.accepted} tone="accepted" />
        <CountFact label="Declined" value={outcomes.declined} tone="declined" />
      </dl>

      <label className="requests-search">
        <span className="sr-only">Search tenancy requests</span>
        <input type="search" value={query} onChange={(event) => setParams({ q: event.target.value })} placeholder="Search person, Property or Unit" />
      </label>

      <div className="requests-filters" aria-label="Request stage">
        {REQUEST_FILTERS.map((value) => (
          <button key={value} type="button" aria-pressed={stage === value} onClick={() => setParams({ show: value === "action" ? "" : value })}>
            {requestFilterLabel(value)} <span>{counts[value]}</span>
          </button>
        ))}
      </div>

      {items === null ? <LoadingRows rows={4} /> : visible.length ? (
        <ul className="requests-list">
          {visible.map((item) => <RequestRow key={item.key} item={item} />)}
        </ul>
      ) : (
        <Empty
          title={query ? "No matching requests" : stage === "action" ? "Nothing needs a decision" : stage === "agreement" ? "No agreements to prepare" : stage === "history" ? "No request history yet" : "No tenancy requests yet"}
          body={query ? "Try a different person, Property or Unit." : stage === "action" ? "New public applications and private tenancy requests appear here." : stage === "agreement" ? "Accepted requests move here until their agreement is sent." : stage === "history" ? "Settled requests remain available as a record." : "Applications against your listings and direct requests to join a Unit both arrive here."}
        />
      )}
    </div>
  );
}

function CountFact({ label, value, tone }: { label: string; value: number; tone?: "accepted" | "declined" }) {
  return (
    <div>
      <dt className="type-caption">{label}</dt>
      <dd data-tone={value > 0 ? tone : undefined}>{value}</dd>
    </div>
  );
}

function RequestRow({ item }: { item: RequestItem }) {
  return (
    <li>
      <Link href={`/applications/${requestRecordId(item)}` as never} className="request-row">
        <span className="request-row-person">
          <strong>{requestWho(item)}</strong>
          <span>{item.kind === "application" ? "Public listing" : "Direct request"}</span>
        </span>
        <span className="request-row-place">{requestWhere(item)}</span>
        <span className={`request-row-state is-${requestTone(item)}`}><i />{requestStatus(item)}</span>
        <span className="request-row-time">{formatRequestDate(requestCreatedAt(item))}</span>
        <span className="request-row-arrow" aria-hidden="true">›</span>
      </Link>
    </li>
  );
}
