"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { Icon } from "@/components/portal/icons";
import { ViewingDetailModal } from "@/components/tenant/ViewingRecord";
import { ApiFailure } from "@/lib/api";
import {
  bySoonest,
  matchesViewingFilter,
  placeOf,
  standing,
  viewingFilters,
  whenLabel,
  type ViewingFilter,
} from "@/lib/viewingMeaning";
import { listHostViewings, type Viewing } from "@/lib/console";
import {
  PROVIDER_VIEWING_FILTERS,
  providerViewingFilterLabel,
  providerViewingMoment,
  providerViewingSort,
  providerViewingSummary,
  providerViewingView,
  viewingEmptyBody,
  viewingEmptyTitle,
  viewingSearchText,
  viewingTotals,
  type ProviderViewingFilter,
} from "@/lib/providerViewings";
import { useSession } from "@/lib/session";
import { listMyViewings, type MyViewing } from "@/lib/tenant";

/**
 * Viewing requests, from the landlord's or agent's side.
 *
 * This is a queue, so it is ordered by what needs an answer rather than by
 * date, and each row states the one decision available. A tenant waiting for a
 * reply is a tenant deciding whether this platform is worth using.
 */
/**
 * Viewings, from whichever side this account is on. Same reasoning as
 * applications: one idea, two readings, both scoped by the backend.
 */
export default function ViewingsPage() {
  const { state } = useSession();
  if (state.status === "loading") {
    return <><PageHeader title="Viewings" /><LoadingRows /></>;
  }
  if (state.status !== "signed_in") return null;
  const capabilities = state.me.capabilities;
  const asProvider =
    capabilities.active_workspace === "provider" && capabilities.provider.workspace_access;
  return asProvider ? (
    <Suspense fallback={<><PageHeader title="Viewings" /><LoadingRows rows={5} /></>}>
      <ProviderViewings />
    </Suspense>
  ) : (
    <TenantViewings />
  );
}

/**
 * The tenant's schedule.
 *
 * A viewing is an appointment, not a status. So a row says the two things
 * somebody standing at a junction needs — where, and when — and everything the
 * lifecycle might allow at that moment lives one click away.
 *
 * The old page put the whole machine on every card: the slot picker, the exact
 * directions, the appointment history, the contact number, the QR check-in, the
 * post-viewing follow-up, the attendance panel and three quiet buttons, all
 * rendered at once, on every row, forever. A tenant with three viewings read
 * that machine three times to find out what time to be somewhere.
 *
 * All opens first so the schedule and its history are immediately useful.
 * Upcoming still leads inside that view, anything waiting on the tenant is
 * pulled into its own group, and focused filters remain one tap away.
 */
function TenantViewings() {
  const [viewings, setViewings] = useState<MyViewing[] | null>(null);
  const [error, setError] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedViewingId, setSelectedViewingId] = useState<string | null>(null);
  const filterRoot = useRef<HTMLDivElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);

  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filter: ViewingFilter =
    viewingFilters.map((option) => option.id).find((id) => id === search.get("show")) ?? "all";
  const query = search.get("q") ?? "";

  const load = useCallback(async () => {
    try {
      setViewings(await listMyViewings());
      setError("");
    } catch (cause) {
      setViewings([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your viewings.");
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

  useEffect(() => {
    if (!window.location.hash.startsWith("#viewing-")) return;
    router.replace(`/viewings/${window.location.hash.slice("#viewing-".length)}` as never);
  }, [router]);

  const setParams = useCallback((changes: Record<string, string>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const queryString = next.toString();
    router.replace((queryString ? `${pathname}?${queryString}` : pathname) as never, { scroll: false });
  }, [pathname, router, search]);

  const chooseFilter = useCallback((nextFilter: ViewingFilter) => {
    setParams({ show: nextFilter === "all" ? "" : nextFilter });
    setFilterOpen(false);
    filterButton.current?.focus();
  }, [setParams]);

  const rows = useMemo<TenantViewingRow[]>(
    () => (viewings ?? []).map((viewing) => ({ viewing, state: standing(viewing) })),
    [viewings],
  );

  const counts: Record<ViewingFilter, number> = useMemo(() => ({
    all: rows.length,
    upcoming: rows.filter((row) => row.state.group === "upcoming").length,
    action: rows.filter((row) => row.state.group === "action").length,
    past: rows.filter((row) => row.state.group === "past").length,
  }), [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    const priority: Record<ReturnType<typeof standing>["group"], number> = { action: 0, upcoming: 1, past: 2 };
    return rows
      .filter((row) => matchesViewingFilter(row.state.group, filter))
      .filter((row) => !needle || [
        row.viewing.property_title,
        row.viewing.listing_headline,
        row.viewing.unit_label,
        placeOf(row.viewing),
      ].filter(Boolean).join(" ").toLocaleLowerCase("en-GH").includes(needle))
      .sort((left, right) => priority[left.state.group] - priority[right.state.group] || bySoonest(left.viewing, right.viewing));
  }, [filter, query, rows]);

  const current = visible.filter((row) => row.state.group !== "past");
  const history = visible.filter((row) => row.state.group === "past");
  const unfilteredView = filter === "all" && !query.trim();
  const initialCurrentLimit = Math.min(current.length, history.length ? 4 : 5);
  const initialHistoryLimit = Math.min(history.length, Math.max(0, 5 - initialCurrentLimit));
  const showSearch = (viewings?.length ?? 0) > 5 || Boolean(query);
  const showFilter = new Set(rows.map((row) => row.state.group)).size > 1 || filter !== "all";
  const selectedLabel = viewingFilters.find((option) => option.id === filter)?.label ?? "Viewings";
  const selectedViewing = viewings?.find((viewing) => viewing.id === selectedViewingId) ?? null;

  return (
    <div className="viewings tenant-viewings">
      <PageHeader
        title="Viewings"
        description={viewings === null || error ? undefined : tenantViewingSummary(counts, rows.length)}
      />

      {viewings === null ? (
        <TenantViewingsLoading />
      ) : error ? (
        <div className="tenant-viewings-error">
          <Notice tone="error" title={error} body="Check your connection and try again." />
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      ) : viewings.length === 0 ? (
        <div className="tenant-viewings-empty">
          <Empty
            title="No viewings yet"
            body="When you ask to see a rental, the appointment will appear here."
            action={<Link href="/rentals" className="type-body-strong">Explore rentals &rarr;</Link>}
          />
        </div>
      ) : (
        <>
          {showSearch || showFilter ? (
            <div className="tenant-viewings-tools">
              {showSearch ? (
                <label className="tenant-viewings-search">
                  <span className="sr-only">Search your viewings</span>
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
                <div className="tenant-viewings-filter" ref={filterRoot}>
                  <button
                    ref={filterButton}
                    type="button"
                    className={`tenant-viewing-filter-trigger${filter !== "all" ? " is-active" : ""}`}
                    aria-expanded={filterOpen}
                    aria-haspopup="menu"
                    aria-controls="tenant-viewing-filter-menu"
                    onClick={() => setFilterOpen((open) => !open)}
                  >
                    <Icon name="filters" />
                    <span>{filter === "all" ? "All viewings" : selectedLabel}</span>
                    <Icon name="chevron-down" />
                  </button>
                  {filterOpen ? (
                    <div id="tenant-viewing-filter-menu" className="tenant-viewing-filter-panel" role="menu" aria-label="Viewing stage">
                      <ViewingFilterOption id="all" current={filter} count={counts.all} onSelect={chooseFilter} />
                      <div className="tenant-viewing-filter-group" role="group" aria-label="Current appointments">
                        <span>Current appointments</span>
                        <ViewingFilterOption id="action" current={filter} count={counts.action} onSelect={chooseFilter} />
                        <ViewingFilterOption id="upcoming" current={filter} count={counts.upcoming} onSelect={chooseFilter} />
                      </div>
                      <div className="tenant-viewing-filter-group" role="group" aria-label="Viewing history">
                        <span>History</span>
                        <ViewingFilterOption id="past" current={filter} count={counts.past} onSelect={chooseFilter} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {visible.length ? (
            <div className="tenant-viewings-results">
              {unfilteredView ? (
                <>
                  {current.length ? <ViewingGroup title="Current" rows={current} initialLimit={initialCurrentLimit} onOpen={setSelectedViewingId} /> : null}
                  {history.length ? <ViewingGroup title="History" rows={history} initialLimit={initialHistoryLimit} historical onOpen={setSelectedViewingId} /> : null}
                </>
              ) : (
                <ViewingGroup
                  key={`${filter}:${query}`}
                  title={query ? "Matches" : selectedLabel}
                  rows={visible}
                  initialLimit={5}
                  historical={visible.every((row) => row.state.group === "past")}
                  onOpen={setSelectedViewingId}
                />
              )}
            </div>
          ) : query ? (
            <Empty title="No matching viewings" body="Try another Property, Unit or place." />
          ) : (
            <TenantViewingFilterEmpty filter={filter} />
          )}

          {selectedViewing ? (
            <ViewingDetailModal
              key={selectedViewing.id}
              viewing={selectedViewing}
              onChanged={load}
              onClose={() => setSelectedViewingId(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

type TenantViewingRow = {
  viewing: MyViewing;
  state: ReturnType<typeof standing>;
};

function tenantViewingSummary(counts: Record<ViewingFilter, number>, total: number): string {
  if (counts.action === 1) return `One viewing needs you · ${total} viewing${total === 1 ? "" : "s"}`;
  if (counts.action > 1) return `${counts.action} viewings need you · ${total} total`;
  if (counts.upcoming > 0) return `${counts.upcoming} upcoming · ${total} viewing${total === 1 ? "" : "s"}`;
  return `${total} viewing record${total === 1 ? "" : "s"}`;
}

function TenantViewingsLoading() {
  return (
    <div className="tenant-viewings-loading" role="status" aria-label="Loading viewings">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="tenant-viewing-loading-row" key={index} aria-hidden="true">
          <span className="skeleton tenant-viewing-loading-photo" />
          <span className="tenant-viewing-loading-copy"><i className="skeleton" /><i className="skeleton" /></span>
          <span className="skeleton tenant-viewing-loading-status" />
        </div>
      ))}
    </div>
  );
}

function ViewingFilterOption({
  id,
  current,
  count,
  onSelect,
}: {
  id: ViewingFilter;
  current: ViewingFilter;
  count: number;
  onSelect: (filter: ViewingFilter) => void;
}) {
  const label = viewingFilters.find((option) => option.id === id)?.label ?? id;
  const active = current === id;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`tenant-viewing-filter-option${active ? " is-selected" : ""}`}
      onClick={() => onSelect(id)}
    >
      <span>{label}</span>
      <small>{count}</small>
      <span className="tenant-viewing-filter-mark" aria-hidden="true">{active ? <Icon name="check" /> : null}</span>
    </button>
  );
}

function ViewingGroup({
  title,
  rows,
  initialLimit,
  historical = false,
  onOpen,
}: {
  title: string;
  rows: TenantViewingRow[];
  initialLimit: number;
  historical?: boolean;
  onOpen: (viewingId: string) => void;
}) {
  const pageSize = 5;
  const [limit, setLimit] = useState(initialLimit);
  const shown = rows.slice(0, limit);
  const remaining = rows.length - shown.length;

  return (
    <section className={`tenant-viewing-group${historical ? " is-history" : ""}`}>
      <header className="tenant-viewing-group-head">
        <h2>{title}</h2>
        <span aria-label={`${rows.length} ${rows.length === 1 ? "viewing" : "viewings"}`}>{rows.length}</span>
      </header>
      <ul className="tenant-viewings-list">
        {shown.map((row) => <ViewingRow key={row.viewing.id} {...row} onOpen={onOpen} />)}
      </ul>
      {remaining > 0 ? (
        <button
          type="button"
          className="tenant-viewing-load-more"
          aria-label={`Show ${Math.min(pageSize, remaining)} more ${title.toLocaleLowerCase("en-GH")} viewings`}
          onClick={() => setLimit((currentLimit) => Math.min(currentLimit + pageSize, rows.length))}
        >
          <span>Show {Math.min(pageSize, remaining)} more</span>
          <Icon name="chevron-down" />
        </button>
      ) : null}
    </section>
  );
}

function TenantViewingFilterEmpty({ filter }: { filter: ViewingFilter }) {
  const copy: Record<ViewingFilter, { title: string; body: string }> = {
    all: { title: "No viewings here", body: "Your viewing requests will appear here." },
    upcoming: { title: "No upcoming visits", body: "Confirmed visits and requests waiting for a time will appear here." },
    action: { title: "Nothing needs you", body: "You are up to date on every viewing." },
    past: { title: "No viewing history", body: "Completed and cancelled visits will remain available here." },
  };
  return (
    <div className="tenant-viewing-filter-empty" role="status">
      <strong>{copy[filter].title}</strong>
      <span>{copy[filter].body}</span>
    </div>
  );
}

function ViewingRow({
  viewing,
  state,
  onOpen,
}: TenantViewingRow & { onOpen: (viewingId: string) => void }) {
  const when = whenLabel(viewing.confirmed_starts_at);
  const property = viewing.property_title || viewing.listing_headline;
  const context = [viewing.unit_label, placeOf(viewing)].filter(Boolean).join(" · ");
  const tone = viewing.status === "checked_in" || viewing.status === "completed"
    ? "positive"
    : state.group === "action"
      ? "action"
      : state.group === "past"
        ? "past"
        : "upcoming";

  return (
    <li>
      <Link
        href={`/viewings/${viewing.id}` as never}
        className={`tenant-viewing-row is-${tone}`}
        aria-label={`${property}. ${context}. ${when ?? state.line}. ${state.callToAction ?? "View details"}.`}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onOpen(viewing.id);
        }}
      >
        <span className="viewing-photo">
          {viewing.photo_url ? (
            /* Short-lived signed URLs from the files service. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={viewing.photo_url} alt="" />
          ) : (
            <span className="viewing-photo-fallback" aria-hidden="true"><Icon name="properties" /></span>
          )}
        </span>

        <span className="viewing-identity">
          <strong>{property}</strong>
          {context ? <span className="viewing-context">{context}</span> : null}
        </span>

        <span className="viewing-schedule">
          <small>{viewing.confirmed_starts_at ? "Appointment" : "Scheduling"}</small>
          <strong>{when ?? "Time to be arranged"}</strong>
        </span>

        <span className={`viewing-standing is-${tone}`}>
          <i aria-hidden="true" />
          <strong>{state.line}</strong>
        </span>

        <span className="tenant-viewing-row-action" aria-hidden="true">
          <Icon name="chevron-down" />
        </span>
      </Link>
    </li>
  );
}
/**
 * Viewings received, for a landlord or agent.
 *
 * Laid out the way Payments, Tenancy requests and Leases are, because it is the
 * same job: a stack of records worked through in an order, each row opening one
 * where a decision gets made. A provider should learn that shape once.
 *
 * It used to be a split view with the first row always opened into the pane
 * beside it — so arriving at Viewings meant looking at somebody's appointment
 * chosen by sort order, whether or not you had asked for it.
 */
function ProviderViewings() {
  const router = useRouter();
  // A viewing is asked of a listing on a Property, so it belongs to that
  // Property's Portfolio and to no other.
  const { activeContext } = useSession();
  const preferred = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";
  const [viewings, setViewings] = useState<Viewing[] | null>(null);
  const [error, setError] = useState("");

  const search = useSearchParams();
  const pathname = usePathname();
  const view: ProviderViewingFilter =
    PROVIDER_VIEWING_FILTERS.find((value) => value === search.get("show")) ?? "action";
  const query = search.get("q") ?? "";

  const load = useCallback(async () => {
    setViewings(null);
    try {
      setViewings(
        await listHostViewings(false, preferred ? { organization: preferred } : undefined),
      );
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load viewings.");
      setViewings([]);
    }
  }, [preferred, router]);

  useEffect(() => { void load(); }, [load]);

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

  const all = useMemo(() => viewings ?? [], [viewings]);
  const counts = useMemo(() => ({
    all: all.length,
    action: all.filter((item) => providerViewingView(item) === "action").length,
    upcoming: all.filter((item) => providerViewingView(item) === "upcoming").length,
    history: all.filter((item) => providerViewingView(item) === "history").length,
  }), [all]);

  const totals = useMemo(() => viewingTotals(all), [all]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return all
      .filter((item) => view === "all" || providerViewingView(item) === view)
      .filter((item) => !needle || viewingSearchText(item).toLocaleLowerCase("en-GH").includes(needle))
      // "All" has no single order of its own, so it reads as the working list
      // does: soonest first.
      .sort(providerViewingSort(view === "all" ? "upcoming" : view));
  }, [all, query, view]);

  return (
    <div className="viewings-workspace">
      <PageHeader title="Viewings" description="Schedule visits, verify attendance and close the loop." />
      {error ? <Notice tone="error" title={error} /> : null}

      <dl className="viewings-overview">
        <ViewingCount label="Total viewings" value={totals.total} />
        <ViewingCount label="Confirmed" value={totals.confirmed} tone="confirmed" />
        <ViewingCount label="Completed" value={totals.completed} tone="completed" />
      </dl>

      <label className="viewings-search">
        <span className="sr-only">Search viewings</span>
        <input type="search" value={query} onChange={(event) => setParams({ q: event.target.value })} placeholder="Search tenant or Property…" />
      </label>

      <div className="viewings-filters" aria-label="Viewing status">
        {PROVIDER_VIEWING_FILTERS.map((value) => (
          <button key={value} type="button" aria-pressed={view === value} onClick={() => setParams({ show: value === "action" ? "" : value })}>
            {providerViewingFilterLabel(value)} <span>{counts[value]}</span>
          </button>
        ))}
      </div>

      {viewings === null ? <LoadingRows rows={5} /> : visible.length ? (
        <ul className="viewings-list" aria-label={`${providerViewingFilterLabel(view)} viewings`}>
          {visible.map((viewing) => <ProviderViewingRow key={viewing.id} viewing={viewing} />)}
        </ul>
      ) : (
        <Empty
          title={query ? "No matching viewings" : view === "all" ? "No viewings yet" : viewingEmptyTitle(view)}
          body={query ? "Try another tenant, Property or location." : view === "all" ? "Requests to visit your listings appear here." : viewingEmptyBody(view)}
          action={view === "action" && counts.upcoming ? <button type="button" className="quiet-link" onClick={() => setParams({ show: "upcoming" })}>View upcoming visits →</button> : undefined}
        />
      )}
    </div>
  );
}

function ViewingCount({ label, value, tone }: { label: string; value: number; tone?: "confirmed" | "completed" }) {
  return (
    <div>
      <dt className="type-caption">{label}</dt>
      <dd data-tone={value > 0 ? tone : undefined}>{value}</dd>
    </div>
  );
}

function ProviderViewingRow({ viewing }: { viewing: Viewing }) {
  const summary = providerViewingSummary(viewing);
  return (
    <li>
      <Link
        href={`/viewings/${viewing.id}` as never}
        className="viewing-row"
        aria-label={`Open viewing for ${viewing.tenant_name} at ${viewing.listing_headline}. ${summary.label}.`}
      >
        <span className="viewing-row-person">
          <strong>{viewing.tenant_name}</strong>
          <span>{viewing.listing_headline}</span>
        </span>
        <span className="viewing-row-place">{viewing.locality_name || "Location unavailable"}</span>
        <span className={`viewing-row-state is-${summary.tone}`}><i aria-hidden="true" />{summary.label}</span>
        <span className="viewing-row-time">{providerViewingMoment(viewing)}</span>
        <span className="viewing-row-arrow" aria-hidden="true">›</span>
      </Link>
    </li>
  );
}
