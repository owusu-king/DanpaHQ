"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
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

  // A reminder can point straight at one appointment. It named a row in a pane
  // before; it names a page now.
  useEffect(() => {
    if (!window.location.hash.startsWith("#viewing-")) return;
    router.replace(`/viewings/${window.location.hash.slice("#viewing-".length)}` as never);
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

  const rows = useMemo(
    () => (viewings ?? []).map((viewing) => ({ viewing, state: standing(viewing) })),
    [viewings],
  );

  const counts: Record<ViewingFilter, number> = useMemo(() => ({
    all: rows.length,
    upcoming: rows.filter((row) => row.state.group === "upcoming").length,
    action: rows.filter((row) => row.state.group === "action").length,
    past: rows.filter((row) => row.state.group === "past").length,
  }), [rows]);

  // Narrower than the pills beside them, on purpose. "Upcoming" as a group also
  // holds a request nobody has answered yet; "Past" holds a visit that was
  // cancelled and one nobody attended. These two count what actually happened.
  const totals = useMemo(() => ({
    total: rows.length,
    confirmed: rows.filter((row) => row.viewing.status === "confirmed").length,
    completed: rows.filter((row) => row.viewing.status === "completed").length,
  }), [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return rows
      .filter((row) => matchesViewingFilter(row.state.group, filter))
      .filter((row) => !needle || `${row.viewing.listing_headline} ${placeOf(row.viewing)}`.toLocaleLowerCase("en-GH").includes(needle))
      // Soonest first. A schedule ordered by when the request was made is not a
      // schedule.
      .sort((a, b) => bySoonest(a.viewing, b.viewing));
  }, [filter, query, rows]);

  return (
    <div className="viewings">
      <PageHeader
        title="Viewings"
        description="Plan each visit, find the place, and decide what happens next."
      />
      {error ? <Notice tone="error" title={error} /> : null}

      {viewings === null ? (
        <LoadingRows rows={2} />
      ) : viewings.length === 0 ? (
        <Empty
          title="No viewings yet"
          body="Ask to see a place and the landlord offers you times."
          action={<Link href="/rentals" className="type-body-strong">Explore rentals →</Link>}
        />
      ) : (
        <>
          <dl className="tenant-viewings-overview">
            <ViewingCount label="Viewings" value={totals.total} />
            <ViewingCount label="Confirmed" value={totals.confirmed} tone="confirmed" />
            <ViewingCount label="Completed" value={totals.completed} />
          </dl>

          <label className="tenant-viewings-search">
            <span className="sr-only">Search your viewings</span>
            <input type="search" value={query} onChange={(event) => setParams({ q: event.target.value })} placeholder="Search a place or a neighbourhood" />
          </label>

          <div className="tenant-viewings-filters" aria-label="Viewing stage">
            {viewingFilters.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setParams({ show: option.id === "all" ? "" : option.id })}
              >
                {option.label}{" "}
                <span aria-label={`${counts[option.id]} ${counts[option.id] === 1 ? "viewing" : "viewings"}`}>
                  {counts[option.id]}
                </span>
              </button>
            ))}
          </div>

          {visible.length ? (
            <ul className="tenant-viewings-list">
              {visible.map((row) => <ViewingRow key={row.viewing.id} {...row} />)}
            </ul>
          ) : query ? (
            <Empty title="No matching viewings" body="Try another place or neighbourhood." />
          ) : (
            <TenantViewingFilterEmpty filter={filter} />
          )}
        </>
      )}
    </div>
  );
}

function TenantViewingFilterEmpty({ filter }: { filter: ViewingFilter }) {
  const copy: Record<ViewingFilter, { title: string; body: string }> = {
    all: { title: "No viewings here", body: "Your viewing requests will appear here." },
    upcoming: { title: "No upcoming visits", body: "Confirmed visits and requests waiting for a time will appear here." },
    action: { title: "Nothing needs you", body: "You are up to date on every viewing." },
    past: { title: "No past viewings", body: "Completed and cancelled visits will remain available here." },
  };
  return (
    <div className="tenant-viewing-filter-empty" role="status">
      <strong>{copy[filter].title}</strong>
      <span>{copy[filter].body}</span>
    </div>
  );
}

/** Where, when, and one way in. Nothing else. */
function ViewingRow({
  viewing,
  state,
}: {
  viewing: MyViewing;
  state: ReturnType<typeof standing>;
}) {
  const when = whenLabel(viewing.confirmed_starts_at);
  return (
    <li>
      <Link
        href={`/viewings/${viewing.id}` as never}
        className={`tenant-viewing-row${state.group === "action" ? " is-action" : ""}`}
        // `callToAction` is the mirrored module's, and the phone already reads it
        // this way. It was drawn here as a button inside the row's own link,
        // which looked like a separate control and did what the row does.
        aria-label={`${viewing.listing_headline}. ${placeOf(viewing)}. ${when ?? state.line}. ${state.callToAction ?? "View details"}.`}
      >
        <span className="viewing-photo">
        {viewing.photo_url ? (
          /* Short-lived signed URLs from the files service. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={viewing.photo_url} alt="" />
        ) : null}
        </span>

        <span className="viewing-identity">
        <strong>{viewing.listing_headline}</strong>
        <span className="viewing-place">{placeOf(viewing) || "Ghana"}</span>
        {when ? <span className="viewing-when">{when}</span> : null}
        <span className={`viewing-standing is-${state.group}`}>
          <i aria-hidden="true" />{state.line}
        </span>
        </span>

        <span className="tenant-viewing-row-arrow" aria-hidden="true">›</span>
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
