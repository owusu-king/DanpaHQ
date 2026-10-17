"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { Icon } from "@/components/portal/icons";
import { ViewingSheet, tenantViewingTone, type TenantViewingTone } from "@/components/tenant/ViewingRecord";
import { Countdown, SoonChip, countsDown, useNow } from "@/components/viewings/Countdown";
import { ViewingModal } from "@/components/viewings/ViewingModal";
import { NextUp, PanelSearch, PanelSkeleton, PanelState, SegmentedControl, WorkspaceHead, gridKeyNavigation } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { useDeepLinkedModal } from "@/lib/deepLinkedModal";
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
    <Suspense fallback={<><PageHeader title="Viewings" /><LoadingRows rows={3} /></>}>
      <TenantViewings />
    </Suspense>
  );
}

/**
 * The tenant's schedule, on the shared workspace and drawn like the host's
 * agenda: each viewing a card whose face is its date, so both sides of one
 * appointment look like one appointment.
 *
 * A viewing is an appointment, not a status. So a card says the two things
 * somebody standing at a junction needs — where, and when — and everything the
 * lifecycle might allow at that moment lives one click away, in a sheet over
 * the schedule that the address keeps. What is waiting on the tenant is lifted
 * above it; when nothing is, the next confirmed visit is, with a countdown once
 * it is close enough to matter.
 */
function TenantViewings() {
  const [viewings, setViewings] = useState<MyViewing[] | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);

  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filter: ViewingFilter =
    viewingFilters.map((option) => option.id).find((id) => id === search.get("show")) ?? "all";
  const query = search.get("q") ?? "";
  // A plain click reads the viewing in a sheet over the schedule; the card is
  // still a link to `/viewings/<id>`. `?viewing=` from elsewhere opens it once.
  const [openId, setOpenId] = useDeepLinkedModal("viewing");

  // A reload keeps what is on screen, so a confirmed time updates in the open
  // sheet instead of the sheet losing its viewing.
  const load = useCallback(async () => {
    try {
      setViewings(await listMyViewings());
      setError("");
    } catch (cause) {
      setViewings((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your viewings.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const retry = useCallback(async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  }, [load]);

  // Reminders sent before viewings had addresses still point at one appointment.
  useEffect(() => {
    if (!window.location.hash.startsWith("#viewing-")) return;
    router.replace(`/record/viewing?viewingId=${window.location.hash.slice("#viewing-".length)}` as never);
  }, [router]);

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

  const chooseFilter = useCallback((nextFilter: ViewingFilter) => {
    setParams({ show: nextFilter === "all" ? "" : nextFilter });
  }, [setParams]);

  const rows = useMemo<TenantViewingRow[]>(
    () => (viewings ?? []).map((viewing) => ({ viewing, state: standing(viewing), tone: tenantViewingTone(viewing) })),
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

  const loading = viewings === null;
  const none = !loading && rows.length === 0;
  const failed = Boolean(error) && none;
  const waiting = visible.filter((row) => row.state.group === "action");
  const upcoming = visible.filter((row) => row.state.group === "upcoming");
  // History reads most recent first; the rest soonest first.
  const history = visible.filter((row) => row.state.group === "past").reverse();
  const unfilteredView = filter === "all" && !query.trim();
  const showSearch = (viewings?.length ?? 0) > 5 || Boolean(query);
  const showFilter = new Set(rows.map((row) => row.state.group)).size > 1 || filter !== "all";
  const selectedLabel = viewingFilters.find((option) => option.id === filter)?.label ?? "Viewings";
  const opened = openId ? viewings?.find((viewing) => viewing.id === openId) ?? null : null;
  const open = setOpenId;

  const firstAction = rows.find((row) => row.state.group === "action") ?? null;
  // The next visit actually booked: the one a countdown is for.
  const nextBooked = rows
    .filter((row) => row.viewing.status === "confirmed" && row.viewing.confirmed_starts_at)
    .sort((left, right) => bySoonest(left.viewing, right.viewing))[0] ?? null;

  return (
    <div className="ws-page viewings-workspace tenant-viewings">
      <WorkspaceHead
        icon="viewings"
        title="Viewings"
        summary={loading || failed ? null : none ? "Places you ask to see are scheduled here." : (
          <TenantViewingSummary counts={counts} />
        )}
        actions={none || loading ? null : (
          <Link href="/rentals" className="ws-action"><Icon name="explore" />Find rentals</Link>
        )}
      />

      {unfilteredView && firstAction ? (
        <NextUp
          eyebrow={firstAction.state.line}
          title={firstAction.viewing.property_title || firstAction.viewing.listing_headline}
          detail={[firstAction.viewing.unit_label, placeOf(firstAction.viewing)].filter(Boolean).join(" · ")}
          hint={firstAction.viewing.status === "offered" ? "The landlord offered times. Pick the one that suits you." : "This viewing is waiting for your answer."}
          photoUrl={firstAction.viewing.photo_url}
          icon="viewings"
          more={{ count: counts.action - 1, onShow: () => chooseFilter("action") }}
          onOpen={() => open(firstAction.viewing.id)}
          action={{ label: firstAction.state.callToAction ?? "Open", onClick: () => open(firstAction.viewing.id) }}
        />
      ) : unfilteredView && nextBooked ? (
        <NextVisit row={nextBooked} onOpen={open} />
      ) : null}

      {showFilter ? (
        <SegmentedControl
          label="Viewing stage"
          value={filter}
          options={viewingFilters.map((option) => ({ key: option.id, label: option.label, count: counts[option.id] }))}
          onChange={chooseFilter}
        />
      ) : null}

      <section className="ws-panel tenant-viewings-panel" aria-label={unfilteredView ? "Your viewings" : `${selectedLabel} viewings`} aria-busy={loading || undefined}>
        {showSearch ? (
          <div className="ws-panel-head">
            <PanelSearch label="Search your viewings" placeholder="Search Property, Unit or place" value={query} onChange={(value) => setParams({ q: value })} />
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
            title="Viewings didn’t load"
            body={`${error} Check your connection and try again.`}
            action={<button type="button" className="ws-action" disabled={retrying} onClick={() => void retry()}>{retrying ? "Retrying…" : "Try again"}</button>}
          />
        ) : none ? (
          <PanelState
            icon="viewings"
            title="No viewings yet"
            body="When you ask to see a rental, the appointment appears here — with the time, the way in and a countdown when it is close."
            action={<Link href="/rentals" className="ws-action is-primary"><Icon name="explore" />Explore rentals</Link>}
          />
        ) : visible.length ? (
          <div className="ws-panel-body viewings-agenda tenant-viewings-agenda" key={`${filter}:${query.trim() ? "q" : ""}`} onKeyDown={moveTenantViewingFocus}>
            {/* "All" is one set of cards, as the host's agenda draws it: what needs
                you, then the soonest ahead, then the most recent past. Groups
                would each start a row of their own and leave every row short. */}
            {unfilteredView ? (
              <ViewingGroup title="All viewings" quiet rows={[...waiting, ...upcoming, ...history]} initialLimit={8} onOpen={open} />
            ) : (
              <ViewingGroup
                key={`${filter}:${query}`}
                title={query ? "Matches" : selectedLabel}
                quiet={!query}
                rows={filter === "past" ? history : visible}
                initialLimit={8}
                historical={visible.every((row) => row.state.group === "past")}
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
          <TenantViewingFilterEmpty filter={filter} onShowAll={() => chooseFilter("all")} />
        )}
      </section>

      <ViewingSheet viewing={opened} onChanged={load} onClose={() => setOpenId("")} />
    </div>
  );
}

type TenantViewingRow = {
  viewing: MyViewing;
  state: ReturnType<typeof standing>;
  tone: TenantViewingTone;
};

/** Arrow keys move between cards the way the eye does. */
const moveTenantViewingFocus = gridKeyNavigation("a.tenant-viewing-row");

/** The head's one live line: what needs them, then what is coming. */
function TenantViewingSummary({ counts }: { counts: Record<ViewingFilter, number> }) {
  const total = counts.all;
  return (
    <>
      {counts.action === 1 ? (
        <span data-tone="warning">One viewing needs you</span>
      ) : counts.action > 1 ? (
        <span data-tone="warning">{counts.action} viewings need you</span>
      ) : counts.upcoming ? (
        <strong>{counts.upcoming} upcoming</strong>
      ) : (
        <strong>Nothing waiting on you</strong>
      )}
      <span className="ws-summary-sep" aria-hidden="true">·</span>
      {total} viewing{total === 1 ? "" : "s"}
    </>
  );
}

/**
 * The next booked visit, lifted above the schedule: the date as its face, the
 * place, and — within a week — a live countdown. The way in is check-in once
 * it opens, else the viewing itself.
 */
function NextVisit({ row, onOpen }: { row: TenantViewingRow; onOpen: (viewingId: string) => void }) {
  const { viewing, state } = row;
  const now = useNow(viewing.confirmed_starts_at);
  const at = new Date(viewing.confirmed_starts_at!);
  const close = countsDown(viewing.confirmed_starts_at, now);
  const property = viewing.property_title || viewing.listing_headline;
  return (
    <section className="tenant-next-visit" data-close={close || undefined} aria-label="Your next viewing">
      <button type="button" className="tenant-next-visit-open" aria-haspopup="dialog" onClick={() => onOpen(viewing.id)}>
        <span className="tenant-next-visit-date" aria-hidden="true">
          <strong>{at.toLocaleDateString("en-GH", { day: "numeric" })}</strong>
          <small>{at.toLocaleDateString("en-GH", { month: "short" })}</small>
        </span>
        <span className="tenant-next-visit-copy">
          <small>Your next viewing</small>
          <strong>{property}</strong>
          <span>{[whenLabel(viewing.confirmed_starts_at), viewing.unit_label, placeOf(viewing)].filter(Boolean).join(" · ")}</span>
        </span>
      </button>
      {close ? (
        <div className="tenant-next-visit-count">
          <Countdown target={viewing.confirmed_starts_at!} />
        </div>
      ) : null}
      <Button className="tenant-next-visit-action" variant={state.callToAction ? "primary" : "secondary"} onClick={() => onOpen(viewing.id)}>
        {state.callToAction ? <><Icon name="verification" />{state.callToAction}</> : "Details"}
      </Button>
    </section>
  );
}

function ViewingGroup({
  title,
  rows,
  initialLimit,
  historical = false,
  quiet = false,
  onOpen,
}: {
  title: string;
  rows: TenantViewingRow[];
  initialLimit: number;
  historical?: boolean;
  /** No visible heading: something on screen already names this group. */
  quiet?: boolean;
  onOpen: (viewingId: string) => void;
}) {
  // Two rows of four at a time, so a disclosed page fills the grid.
  const pageSize = 8;
  const [limit, setLimit] = useState(initialLimit);
  const shown = rows.slice(0, limit);
  const remaining = rows.length - shown.length;
  const headingId = `viewings-${title.toLocaleLowerCase("en-GH").replace(/\s+/g, "-")}`;

  return (
    <section className={`ws-group viewings-day tenant-viewing-group${historical ? " is-history" : ""}`} aria-labelledby={headingId}>
      <h2 className={`ws-group-heading viewings-day-heading${quiet ? " ws-visually-hidden" : ""}`} id={headingId}>
        {title}<span aria-label={`${rows.length} ${rows.length === 1 ? "viewing" : "viewings"}`}>{rows.length}</span>
      </h2>
      <ul className="viewings-list">
        {shown.map((row, index) => <ViewingCard key={row.viewing.id} {...row} order={index} onOpen={onOpen} />)}
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

function TenantViewingFilterEmpty({ filter, onShowAll }: { filter: ViewingFilter; onShowAll: () => void }) {
  const copy: Record<ViewingFilter, { title: string; body: string }> = {
    all: { title: "No viewings here", body: "Your viewing requests will appear here." },
    upcoming: { title: "No upcoming visits", body: "Confirmed visits and requests waiting for a time will appear here." },
    action: { title: "Nothing needs you", body: "You are up to date on every viewing." },
    past: { title: "No viewing history", body: "Completed and cancelled visits will remain available here." },
  };
  return (
    <PanelState
      icon={filter === "action" ? "check" : "viewings"}
      title={copy[filter].title}
      body={copy[filter].body}
      action={filter === "all" ? undefined : <button type="button" className="ws-action" onClick={onShowAll}>Show all viewings</button>}
    />
  );
}

/**
 * A viewing as the host's agenda draws one — the date as its face — with the
 * place where the host has the person, and a countdown once it is close.
 */
function ViewingCard({
  viewing,
  state,
  tone,
  order,
  onOpen,
}: TenantViewingRow & { order: number; onOpen: (viewingId: string) => void }) {
  const when = whenLabel(viewing.confirmed_starts_at);
  const property = viewing.property_title || viewing.listing_headline;
  const context = [viewing.unit_label, placeOf(viewing)].filter(Boolean).join(" · ");
  const at = viewing.confirmed_starts_at ? new Date(viewing.confirmed_starts_at) : null;
  const today = new Date();
  const sameDay = at ? at.toDateString() === today.toDateString() : false;
  const dayWhen = !at ? "none" : sameDay ? "today" : at.getTime() < today.getTime() ? "past" : "ahead";
  const time = at ? at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" }) : null;

  return (
    <li className="viewing-item" data-past={state.group === "past" || undefined} style={{ "--viewing-order": Math.min(order, 12) } as React.CSSProperties}>
      <Link
        href={`/record/viewing?viewingId=${viewing.id}` as never}
        className="viewing-row tenant-viewing-row"
        data-when={dayWhen}
        data-tone={tone}
        aria-haspopup="dialog"
        aria-label={`${property}. ${context}. ${when ?? state.line}. ${state.callToAction ?? "View details"}.`}
        onClick={(event) => {
          // A new tab or window goes to the viewing's own page, as a link should.
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onOpen(viewing.id);
        }}
      >
        <span className="viewing-row-date" aria-hidden="true">
          {at ? (
            <>
              <strong className="viewing-row-day">{at.toLocaleDateString("en-GH", { day: "numeric" })}</strong>
              <span className="viewing-row-daytext">
                <span>{sameDay ? "Today" : at.toLocaleDateString("en-GH", { weekday: "long" })}</span>
                <small>{at.toLocaleDateString("en-GH", { month: "long" })}</small>
              </span>
            </>
          ) : (
            <>
              <strong className="viewing-row-day is-open">—</strong>
              <span className="viewing-row-daytext">
                <span>{viewing.status === "offered" ? "Times offered" : "No time yet"}</span>
                <small>{viewing.status === "offered" ? "Pick one" : "Being arranged"}</small>
              </span>
            </>
          )}
          <span className="tenant-viewing-photo">
            {viewing.photo_url ? (
              /* Short-lived signed URLs from the files service. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={viewing.photo_url} alt="" />
            ) : <Icon name="properties" />}
          </span>
        </span>

        {time ? (
          <span className="viewing-row-time">
            <Icon name="clock" />
            {time}
            {viewing.status === "confirmed" ? <SoonChip target={viewing.confirmed_starts_at} /> : null}
          </span>
        ) : null}

        <span className="viewing-row-person">
          <strong>{property}</strong>
          {context ? <span>{context}</span> : null}
        </span>

        <span className="viewing-row-foot">
          <span className={`viewing-row-state is-${tone}`}><i aria-hidden="true" />{state.line}</span>
          <span className="tenant-viewing-row-arrow" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
              <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Viewings received, for a landlord or agent.
 *
 * An agenda, because a viewing is an appointment: what needs an answer first,
 * then the days ahead, each day read down by time the way a diary is. A row is
 * a link to the viewing's own address; a plain click opens the same record in
 * a sheet over the agenda, so a decision does not cost the place in the list.
 * A modified click still opens the page. Nothing is opened for anyone on
 * arrival.
 *
 * The counts moved into the one line under the title. Tiles above the stages
 * said the same kind of number twice and pushed the work below the fold.
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
  const [retrying, setRetrying] = useState(false);
  const [returnedTo, setReturnedTo] = useState<string | null>(null);
  const pendingReturn = useRef<HostReturnPoint | null>(null);

  const search = useSearchParams();
  const pathname = usePathname();
  const view: ProviderViewingFilter =
    PROVIDER_VIEWING_FILTERS.find((value) => value === search.get("show")) ?? "action";
  const query = search.get("q") ?? "";
  const [openId, setOpenId] = useDeepLinkedModal("viewing");

  const load = useCallback(async () => {
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
      setViewings((current) => current ?? []);
    }
  }, [preferred, router]);

  useEffect(() => {
    // Restored in an effect rather than initial state, so the server render and
    // the first client render agree. The filter already lives in the address.
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(HOST_RETURN_KEY) ?? "null") as HostReturnPoint | null;
      window.sessionStorage.removeItem(HOST_RETURN_KEY);
      if (saved && Date.now() - saved.at < HOST_RETURN_WINDOW_MS) pendingReturn.current = saved;
    } catch {
      // Storage can be unavailable; the page simply opens at the top.
    }
  }, []);

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

  const days = useMemo(() => agendaOf(visible, view === "history", view === "all"), [visible, view]);
  const opened = openId ? all.find((item) => item.id === openId) ?? null : null;

  // Coming back from a viewing: the same place, and a brief mark on the row
  // that was opened so the eye finds its way back.
  useLayoutEffect(() => {
    const saved = pendingReturn.current;
    if (!saved || !viewings) return;
    pendingReturn.current = null;
    window.scrollTo({ top: saved.y, behavior: "instant" });
    setReturnedTo(saved.id);
    document.querySelector<HTMLAnchorElement>(`[data-viewing-id="${CSS.escape(saved.id)}"]`)?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setReturnedTo(null), 1600);
    return () => window.clearTimeout(timer);
  }, [viewings]);

  function remember(viewing: Viewing) {
    try {
      const point: HostReturnPoint = { id: viewing.id, y: window.scrollY, at: Date.now() };
      window.sessionStorage.setItem(HOST_RETURN_KEY, JSON.stringify(point));
    } catch {
      // Without storage, Back simply opens Viewings at the top.
    }
  }

  async function retry() {
    setRetrying(true);
    await load();
    setRetrying(false);
  }

  const loading = viewings === null;
  const failed = Boolean(error) && !all.length;
  const label = providerViewingFilterLabel(view);

  return (
    <div className="ws-page viewings-workspace">
      <WorkspaceHead
        icon="viewings"
        title="Viewings"
        summary={loading || failed ? null : all.length ? (
          <>
            {counts.action
              ? <span data-tone="warning">{counts.action} need{counts.action === 1 ? "s" : ""} you</span>
              : <strong>Nothing needs you</strong>}
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {totals.confirmed} confirmed
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {totals.completed} completed
          </>
        ) : "Requests to visit your listings arrive here."}
      />

      {loading || all.length ? (
        <SegmentedControl
          label="Viewing status"
          value={view}
          disabled={loading}
          options={PROVIDER_VIEWING_FILTERS.map((value) => ({ key: value, label: providerViewingFilterLabel(value), count: counts[value] }))}
          onChange={(value) => setParams({ show: value === "action" ? "" : value })}
        />
      ) : null}

      <section className="ws-panel" aria-label={`${label} viewings`} aria-busy={loading || undefined}>
        {all.length ? (
          <div className="ws-panel-head">
            <PanelSearch
              label="Search viewings"
              placeholder="Tenant, listing or place"
              value={query}
              onChange={(value) => setParams({ q: value })}
            />
            <p className="ws-range">
              <strong>{visible.length}</strong> {visible.length === 1 ? "viewing" : "viewings"}
            </p>
          </div>
        ) : null}

        {error && all.length ? (
          <div className="ws-inline-error" role="alert">
            <Icon name="warning" />
            <span>{error}</span>
            <button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? "Retrying…" : "Try again"}</button>
          </div>
        ) : null}

        {loading ? <ViewingAgendaSkeleton /> : null}

        {failed ? (
          <PanelState
            tone="error"
            icon="warning"
            title="Viewings didn’t load"
            body={error}
            action={<Button variant="secondary" size="sm" busy={retrying} busyLabel="Retrying…" onClick={() => void retry()}>Try again</Button>}
          />
        ) : null}

        {!loading && !failed && !all.length ? (
          <PanelState
            icon="viewings"
            title="No viewings yet"
            body="When someone asks to see one of your listings, the request appears here for you to offer times."
            action={<Link href="/properties" className="btn btn-quiet btn-sm">Review your Properties</Link>}
          />
        ) : null}

        {all.length && !visible.length ? (
          <PanelState
            icon={query ? "explore" : "check"}
            title={query ? `Nothing matches “${query.trim()}”` : viewingEmptyTitle(view === "all" ? "upcoming" : view)}
            body={query ? "Try another tenant, listing or place." : viewingEmptyBody(view === "all" ? "upcoming" : view)}
            action={query ? (
              <Button variant="quiet" size="sm" onClick={() => setParams({ q: "" })}>Clear search</Button>
            ) : view === "action" && counts.upcoming ? (
              <Button variant="quiet" size="sm" onClick={() => setParams({ show: "upcoming" })}>See upcoming visits</Button>
            ) : undefined}
          />
        ) : null}

        {visible.length ? (
          <div className="ws-panel-body viewings-agenda" key={`${view}-${query.trim() ? "q" : ""}`} onKeyDown={moveViewingFocus}>
            {days.map((day) => (
              <section
                key={day.key}
                className="ws-group viewings-day"
                {...(day.title ? { "aria-labelledby": `viewings-${day.key}` } : { "aria-label": "All viewings" })}
              >
                {day.title ? (
                  <h2 className="ws-group-heading viewings-day-heading" id={`viewings-${day.key}`}>
                    {day.title}<span>{day.rows.length}</span>
                  </h2>
                ) : null}
                <ul className="viewings-list">
                  {day.rows.map((viewing, index) => (
                    <ProviderViewingCard
                      key={viewing.id}
                      viewing={viewing}
                      order={index}
                      returned={returnedTo === viewing.id}
                      onOpen={remember}
                      onPeek={(item) => setOpenId(item.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </section>

      <ViewingModal viewing={opened} onClose={() => setOpenId("")} onChanged={load} />
    </div>
  );
}

const HOST_RETURN_KEY = "viewings.return";
const HOST_RETURN_WINDOW_MS = 30 * 60 * 1000;
type HostReturnPoint = { id: string; y: number; at: number };

type AgendaDay = { key: string; title: string; rows: Viewing[] };

/** When a viewing sits on the agenda: its agreed time, else the first time offered. */
function agendaMoment(viewing: Viewing): string | null {
  if (viewing.confirmed_starts_at) return viewing.confirmed_starts_at;
  if (viewing.status === "offered") return viewing.slots.find((slot) => !slot.is_past)?.starts_at ?? null;
  // A finished request that never got a time is dated by when it was asked,
  // so it sits with the past rather than among the ones waiting for a time.
  if (providerViewingView(viewing) === "history") return viewing.created_at;
  return null;
}

/**
 * The cards carry their own dates, so the headings only say what the dates
 * cannot: which ones are still waiting for a time and which are scheduled.
 * History is grouped by month, most recent first.
 *
 * "All" is one set of cards with no headings, as asked: the ones waiting for a
 * time first, then the soonest ahead, then the past with the most recent first.
 */
function agendaOf(rows: Viewing[], history: boolean, flat: boolean): AgendaDay[] {
  if (history) {
    const months = new Map<string, AgendaDay>();
    for (const viewing of rows) {
      const date = new Date(agendaMoment(viewing)!);
      const key = `m-${date.getFullYear()}-${date.getMonth()}`;
      if (!months.has(key)) months.set(key, { key, title: date.toLocaleDateString("en-GH", { month: "long", year: "numeric" }), rows: [] });
      months.get(key)!.rows.push(viewing);
    }
    return [...months.values()];
  }
  const today = startOfDay(new Date()).getTime();
  const byTime = (a: Viewing, b: Viewing) => new Date(agendaMoment(a)!).getTime() - new Date(agendaMoment(b)!).getTime();
  const waiting = rows.filter((viewing) => !agendaMoment(viewing));
  const dated = rows.filter((viewing) => agendaMoment(viewing));
  const ahead = dated.filter((viewing) => startOfDay(new Date(agendaMoment(viewing)!)).getTime() >= today).sort(byTime);
  const earlier = dated.filter((viewing) => startOfDay(new Date(agendaMoment(viewing)!)).getTime() < today).sort(byTime);
  if (flat) return [{ key: "all", title: "", rows: [...waiting, ...ahead, ...earlier.reverse()] }];
  const groups = [
    { key: "waiting", title: "Waiting for a time", rows: waiting },
    { key: "ahead", title: "Scheduled", rows: [...earlier, ...ahead] },
  ];
  return groups.filter((group) => group.rows.length);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function ViewingAgendaSkeleton() {
  return (
    <div className="ws-panel-body viewings-agenda" aria-busy="true" aria-label="Loading viewings">
      <div className="ws-group">
        <span className="ws-skeleton-block is-thin viewings-skeleton-heading" />
        <ul className="viewings-list">
          {Array.from({ length: 6 }).map((_, index) => (
            <li key={index} className="viewing-item" style={{ "--viewing-order": index } as React.CSSProperties}>
              <div className="viewing-row is-skeleton">
                <span className="viewing-row-date">
                  <span className="ws-skeleton-block viewings-skeleton-day" />
                  <span className="ws-skeleton-lines" style={{ flex: 1 }}>
                    <span className="ws-skeleton-block is-thin" style={{ width: "60%" }} />
                    <span className="ws-skeleton-block is-thin" style={{ width: "40%" }} />
                  </span>
                </span>
                <span className="ws-skeleton-lines">
                  <span className="ws-skeleton-block" style={{ width: "58%" }} />
                  <span className="ws-skeleton-block is-thin" style={{ width: "74%" }} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * A viewing as a compact card with the date as its face: a large day number,
 * the weekday and month beside it, then the time, the person and the Unit. One
 * quiet line says where it stands, because in "All" that is the difference
 * between a request that needs an answer and a visit that is simply booked.
 */
function ProviderViewingCard({
  viewing,
  order,
  returned,
  onOpen,
  onPeek,
}: {
  viewing: Viewing;
  order: number;
  returned: boolean;
  onOpen: (viewing: Viewing) => void;
  onPeek: (viewing: Viewing) => void;
}) {
  const summary = providerViewingSummary(viewing);
  const at = agendaMoment(viewing);
  const date = at ? new Date(at) : null;
  const offered = viewing.status === "offered" && !viewing.confirmed_starts_at;
  const now = startOfDay(new Date()).getTime();
  const day = date ? startOfDay(date).getTime() : null;
  const when = day === null ? "none" : day === now ? "today" : day < now ? "past" : "ahead";
  const unit = unitName(viewing);
  const time = date ? date.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <li
      className={`viewing-item${returned ? " is-returned" : ""}`}
      style={{ "--viewing-order": Math.min(order, 12) } as React.CSSProperties}
    >
      <Link
        href={`/record/viewing?viewingId=${viewing.id}` as never}
        className="viewing-row"
        data-viewing-id={viewing.id}
        data-when={when}
        data-tone={summary.tone}
        onClick={(event) => {
          // A new tab or window goes to the record's own page, as a link should.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
            onOpen(viewing);
            return;
          }
          event.preventDefault();
          onPeek(viewing);
        }}
        aria-haspopup="dialog"
        aria-label={`Open viewing for ${viewing.tenant_name}, ${unit}. ${providerViewingMoment(viewing)}. ${summary.label}.`}
      >
        <span className="viewing-row-date" aria-hidden="true">
          {date ? (
            <>
              <strong className="viewing-row-day">{date.toLocaleDateString("en-GH", { day: "numeric" })}</strong>
              <span className="viewing-row-daytext">
                <span>{when === "today" ? "Today" : date.toLocaleDateString("en-GH", { weekday: "long" })}</span>
                <small>{date.toLocaleDateString("en-GH", { month: "long" })}</small>
              </span>
            </>
          ) : (
            <>
              <strong className="viewing-row-day is-open">—</strong>
              <span className="viewing-row-daytext">
                <span>No time yet</span>
                <small>Offer a few times</small>
              </span>
            </>
          )}
        </span>

        {time ? (
          <span className="viewing-row-time">
            <Icon name="clock" />
            {time}{offered ? <em>offered</em> : null}
          </span>
        ) : null}

        <span className="viewing-row-person">
          <strong>{viewing.tenant_name}</strong>
          <span>{unit}</span>
        </span>

        <span className="viewing-row-foot">
          <span className={`viewing-row-state is-${summary.tone}`}><i aria-hidden="true" />{summary.label}</span>
          <span className="viewing-row-arrow" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16" focusable="false">
              <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Arrow keys move between cards the way the eye does. */
const moveViewingFocus = gridKeyNavigation("a.viewing-row");

/** The Unit as a manager names it: "Flat 2A · Adenta Court", else the listing. */
function unitName(viewing: Viewing) {
  if (viewing.unit_label && viewing.property_title) return `${viewing.unit_label} · ${viewing.property_title}`;
  return viewing.unit_label || viewing.property_title || viewing.listing_headline;
}

