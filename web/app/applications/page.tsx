"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  applicationBucket,
  applicationFilters,
  matchesApplicationFilter,
  placeOf,
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
import { timeAgo } from "@/lib/time";

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

  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filter: ApplicationFilter =
    applicationFilters.map((option) => option.id).find((id) => id === search.get("show")) ?? "all";
  const query = search.get("q") ?? "";

  const load = useCallback(async () => {
    try {
      // Acceptance is not the end of the story, and the story lives in the
      // lease. Read-only join: what the tenant may already see at /leases.
      const [nextApplications, nextLeases] = await Promise.all([
        listMyApplications(),
        listMyLeases().catch(() => [] as Lease[]),
      ]);
      setApplications(nextApplications);
      setLeases(nextLeases);
      setError("");
    } catch (cause) {
      setApplications([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your applications.");
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

  const rows = useMemo(
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

  // Only what the server recorded. An application the tenant withdrew was not
  // turned down by anybody, so the three do not sum to the total.
  const totals = useMemo(() => ({
    total: rows.length,
    approved: rows.filter((row) => row.application.status === "accepted").length,
    declined: rows.filter((row) => row.application.status === "rejected").length,
  }), [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return rows
      .filter((row) => matchesApplicationFilter(row.bucket, filter))
      .filter((row) => !needle || `${row.application.listing_headline} ${placeOf(row.application)}`.toLocaleLowerCase("en-GH").includes(needle));
  }, [filter, query, rows]);

  return (
    <div className="applications">
      <PageHeader
        title="Applications"
        description="Follow every rental journey from application to agreement."
      />
      {error ? <Notice tone="error" title={error} /> : null}

      {applications === null ? (
        <LoadingRows rows={3} />
      ) : applications.length === 0 ? (
        <Empty
          title="No applications yet"
          body="Applying puts you in front of the landlord with your checks already attached."
          action={<Link href="/rentals" className="type-body-strong">Explore rentals →</Link>}
        />
      ) : (
        <>
          <dl className="applications-overview">
            <ApplicationCount label="Applications sent" value={totals.total} />
            <ApplicationCount label="Approved" value={totals.approved} tone="approved" />
            <ApplicationCount label="Turned down" value={totals.declined} tone="declined" />
          </dl>

          <label className="applications-search">
            <span className="sr-only">Search your applications</span>
            <input type="search" value={query} onChange={(event) => setParams({ q: event.target.value })} placeholder="Search a place or a neighbourhood" />
          </label>

          <div className="applications-filters" aria-label="Application stage">
            {applicationFilters.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setParams({ show: option.id === "all" ? "" : option.id })}
              >
                {option.label}{" "}
                <span aria-label={`${counts[option.id]} ${counts[option.id] === 1 ? "application" : "applications"}`}>
                  {counts[option.id]}
                </span>
              </button>
            ))}
          </div>

          {visible.length ? (
            <ul className="applications-list">
              {visible.map((row) => <ApplicationRow key={row.application.id} {...row} />)}
            </ul>
          ) : query ? (
            <Empty title="No matching applications" body="Try another place or neighbourhood." />
          ) : (
            <ApplicationFilterEmpty filter={filter} />
          )}
        </>
      )}
    </div>
  );
}

function ApplicationCount({ label, value, tone }: { label: string; value: number; tone?: "approved" | "declined" }) {
  return (
    <div>
      <dt className="type-caption">{label}</dt>
      <dd data-tone={value > 0 ? tone : undefined}>{value}</dd>
    </div>
  );
}

function ApplicationFilterEmpty({ filter }: { filter: ApplicationFilter }) {
  const copy: Record<ApplicationFilter, { title: string; body: string }> = {
    all: { title: "No applications here", body: "Your applications will appear here." },
    action: { title: "Nothing needs you", body: "You are up to date on every application." },
    open: { title: "Nothing in progress", body: "No application is waiting for a decision." },
    approved: { title: "No approvals yet", body: "Approved applications will stay easy to find here." },
    past: { title: "No past applications", body: "Rejected and withdrawn applications will appear here." },
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
}: {
  application: MyApplication;
  standing: ReturnType<typeof standing>;
}) {
  const short = shortfallNote(application);
  return (
    <li>
      <Link
        href={`/applications/${application.id}` as never}
        className="application-row"
        aria-label={`Open the application for ${application.listing_headline}. ${state.line}.`}
      >
        <span className="application-photo">
          {application.photo_url ? (
            /* Short-lived signed URLs from the files service. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={application.photo_url} alt="" />
          ) : null}
        </span>
        <span className="application-identity">
          <strong>{application.listing_headline}</strong>
          <span className="application-place">{placeOf(application)}</span>
          <span className="application-rent">
            {application.rent_formatted ?? ""}<i> / month</i>
          </span>
          {short ? <span className="application-short">{short}</span> : null}
        </span>
        <span className={`application-standing is-${state.stage}`}>
          <i aria-hidden="true" />
          {state.line}
          <em>{timeAgo(application.created_at)}</em>
        </span>
        <span className="application-row-arrow" aria-hidden="true">›</span>
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
