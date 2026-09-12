"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import {
  agreedTerms,
  agreementFilters,
  homeOf,
  matchesAgreementFilter,
  months,
  standing,
  type AgreementFilter,
} from "@/lib/agreementMeaning";
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
import { useSession } from "@/lib/session";
import { listMyLeases } from "@/lib/tenant";
import { onDate } from "@/lib/time";

/**
 * Agreements on the places I manage.
 *
 * A lease is drafted from an accepted application, because that is where the
 * terms were actually negotiated — the advance in particular is usually the
 * number the applicant offered, not the one the listing asked for. Retyping it
 * is how the two drift apart.
 */
/**
 * Leases, from whichever side this account is on.
 *
 * A provider grants them; a tenant holds one. The tenant reading is the rent
 * ledger — what is owed, what is paid, and when — because that is what someone
 * opens their agreement to find out.
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
 * The agreements this person holds.
 *
 * Six questions, and the collection view answers five of them per row: which
 * home, who it is with, how much, for what period, and what — if anything —
 * needs deciding. The sixth, *what am I agreeing to*, is a document, and a
 * document belongs on its own page.
 *
 * That split is the point of this rewrite. The old page put "Accept agreement"
 * and "Decline" **above** the money, the dates, the conditions and the
 * statutory advance notice, and then asked the tenant to tick "I have read the
 * advance-rent notice below". The most consequential action in the product was
 * offered before the reading. The decision now lives at the end of the review,
 * after the terms.
 *
 * The row offers nothing at all: it *is* the way in, and the chevron says so.
 * It used to carry a span painted as a 44px button reading "Open agreement",
 * which looked like a separate control, did exactly what the row does, and
 * repeated the standing line directly above it.
 */
function TenantLeases() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [error, setError] = useState("");

  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filter: AgreementFilter =
    agreementFilters.map((option) => option.id).find((id) => id === search.get("show")) ?? "all";
  const query = search.get("q") ?? "";

  const load = useCallback(async () => {
    try {
      setLeases(await listMyLeases());
      setError("");
    } catch (cause) {
      setLeases([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your agreements.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Older links carry an agreement hash. They name a page now, so send them
  // there rather than leaving somebody on a list that ignored what they tapped.
  useEffect(() => {
    if (window.location.hash.startsWith("#agreement-")) {
      router.replace(`/leases/${window.location.hash.slice("#agreement-".length)}` as never);
      return;
    }
    // `?open=<id>` was how the application record deep-linked into the pane.
    // The agreement is a page now, so the link resolves to it rather than
    // landing on a list with nothing open.
    const requested = search.get("open");
    if (requested) router.replace(`/leases/${requested}` as never);
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

  const rows = useMemo(
    () => (leases ?? []).map((lease) => ({ lease, state: standing(lease) })),
    [leases],
  );

  const counts: Record<AgreementFilter, number> = useMemo(() => ({
    all: rows.length,
    action: rows.filter((row) => row.state.stage === "action").length,
    active: rows.filter((row) => row.state.stage === "active").length,
    past: rows.filter((row) => row.state.stage === "past").length,
  }), [rows]);

  // Narrower than the pills beside them, on purpose. "Active" as a stage also
  // holds an agreement that is accepted but has not started; "Past" holds one
  // the tenant declined and one the landlord withdrew. These two count only
  // what actually happened.
  const totals = useMemo(() => ({
    total: rows.length,
    inPlace: rows.filter((row) => row.lease.status === "active").length,
    ended: rows.filter((row) => row.lease.status === "ended").length,
  }), [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return rows
      .filter((row) => matchesAgreementFilter(row.state.stage, filter))
      .filter((row) => {
        if (!needle) return true;
        const terms = agreedTerms(row.lease);
        return `${homeOf(terms)} ${terms.landlordName} ${row.lease.locality_name ?? ""}`
          .toLocaleLowerCase("en-GH")
          .includes(needle);
      });
  }, [filter, query, rows]);

  return (
    <div className="agreements">
      <PageHeader
        title="Agreements"
        description="Read, decide, and keep the terms behind each rental journey."
      />
      {error ? <Notice tone="error" title={error} /> : null}

      {leases === null ? (
        <LoadingRows rows={2} />
      ) : leases.length === 0 ? (
        <Empty
          title="No agreement yet"
          body="When a landlord sends you one, it waits here for your decision. Nothing binds you until you accept it."
          action={<Link href="/rentals" className="type-body-strong">Explore rentals →</Link>}
        />
      ) : (
        <>
          <dl className="agreements-overview">
            <AgreementCount label="Agreements" value={totals.total} />
            <AgreementCount label="In place" value={totals.inPlace} tone="in-place" />
            <AgreementCount label="Ended" value={totals.ended} />
          </dl>

          <label className="agreements-search">
            <span className="sr-only">Search your agreements</span>
            <input type="search" value={query} onChange={(event) => setParams({ q: event.target.value })} placeholder="Search a home or a landlord" />
          </label>

          <div className="agreements-filters" aria-label="Agreement stage">
            {agreementFilters.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setParams({ show: option.id === "all" ? "" : option.id })}
              >
                {option.label}{" "}
                <span aria-label={`${counts[option.id]} ${counts[option.id] === 1 ? "agreement" : "agreements"}`}>
                  {counts[option.id]}
                </span>
              </button>
            ))}
          </div>

          {visible.length ? (
            <ul className="agreements-list">
              {visible.map((row) => <AgreementRow key={row.lease.id} {...row} />)}
            </ul>
          ) : query ? (
            <Empty title="No matching agreements" body="Try another home or landlord." />
          ) : (
            <AgreementFilterEmpty filter={filter} />
          )}
        </>
      )}
    </div>
  );
}

function AgreementCount({ label, value, tone }: { label: string; value: number; tone?: "in-place" }) {
  return (
    <div>
      <dt className="type-caption">{label}</dt>
      <dd data-tone={value > 0 ? tone : undefined}>{value}</dd>
    </div>
  );
}

function AgreementFilterEmpty({ filter }: { filter: AgreementFilter }) {
  const copy: Record<AgreementFilter, { title: string; body: string }> = {
    all: { title: "No agreements here", body: "Your agreements will appear here." },
    action: { title: "Nothing needs your decision", body: "You have reviewed every agreement sent to you." },
    active: { title: "No active agreements", body: "Accepted agreements will remain easy to find here." },
    past: { title: "No past agreements", body: "Declined, withdrawn, and ended agreements will appear here." },
  };
  return (
    <div className="agreement-filter-empty" role="status">
      <strong>{copy[filter].title}</strong>
      <span>{copy[filter].body}</span>
    </div>
  );
}

function AgreementRow({
  lease,
  state,
}: {
  lease: Lease;
  state: ReturnType<typeof standing>;
}) {
  const terms = agreedTerms(lease);
  return (
    <li>
      <Link
        href={`/leases/${lease.id}` as never}
        className={`agreement-row${state.stage === "action" ? " is-action" : ""}`}
        aria-label={`Open the agreement for ${homeOf(terms)}. ${state.line}.`}
      >
      <div className="agreement-row-main">
        <p className="agreement-home">{homeOf(terms)}</p>
        <p className="agreement-with">
          With {terms.landlordName}
          {lease.locality_name ? ` · ${lease.locality_name}` : ""}
        </p>
        {/* I intentionally removed this, to keep the row clean */}
        {/* <p className="agreement-money">
          {money(terms.rentMinor, terms.rentCurrency)}<span> / {per(terms.rentPeriod)}</span>
          <span> · {money(terms.moveInTotalMinor, terms.rentCurrency)} to move in</span>
        </p> */}
        <p className="agreement-dates">
          {terms.startsOn ? `${state.stage === "past" ? "Was to start" : "Starts"} ${onDate(terms.startsOn)}` : "Start date not set"}
          {` · ${months(terms.termMonths)}`}
          {terms.endsOn ? ` · until ${onDate(terms.endsOn)}` : ""}
        </p>
        {lease.decline_reason ? (
          <p className="agreement-reason">{lease.decline_reason}</p>
        ) : null}
      </div>

      <div className="agreement-row-side">
        <p className={`agreement-standing is-${state.stage}`}>
          <i aria-hidden="true" />{state.line}
        </p>
      </div>
      <span className="agreement-row-arrow" aria-hidden="true">›</span>
      </Link>
    </li>
  );
}

/** Provider-side date formatting. The tenant screens use `onDate`. */
/**
 * Agreements granted, for a landlord or agent.
 *
 * Laid out the way Payments and Tenancy requests are, because it is the same
 * job: a stack of records worked through in an order, each row opening one
 * where a decision gets made. A provider should learn that shape once.
 *
 * Three counts across the top, a search, the stages as filter pills, then the
 * list. It used to be a split view with the first row always opened into the
 * pane beside it — so arriving at Leases meant looking at somebody's agreement
 * chosen by sort order, whether or not you had asked for it.
 */
function ProviderLeases() {
  const router = useRouter();
  // An agreement belongs to the Portfolio whose Property granted it, so this
  // list is about the Portfolio being operated and no other.
  const { activeContext } = useSession();
  const preferred = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [error, setError] = useState("");

  const search = useSearchParams();
  const pathname = usePathname();
  const stage: LeaseFilter = LEASE_FILTERS.find((value) => value === search.get("show")) ?? "send";
  const query = search.get("q") ?? "";

  const load = useCallback(async () => {
    setLeases(null);
    try {
      setLeases(await listGrantedLeases(preferred ? { organization: preferred } : undefined));
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load agreements.");
      setLeases([]);
    }
  }, [preferred, router]);

  useEffect(() => { void load(); }, [load]);

  // Older links carry a lease hash. They used to open the pane; now they name a
  // page, so send them there rather than leaving somebody on a list that
  // silently ignored the thing they clicked.
  useEffect(() => {
    if (!window.location.hash.startsWith("#lease-")) return;
    router.replace(`/leases/${window.location.hash.slice("#lease-".length)}` as never);
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

  const counts = useMemo(() => {
    const rows = leases ?? [];
    return {
      all: rows.length,
      send: rows.filter((lease) => providerLeaseStage(lease) === "send").length,
      current: rows.filter((lease) => providerLeaseStage(lease) === "current").length,
      history: rows.filter((lease) => providerLeaseStage(lease) === "history").length,
    };
  }, [leases]);

  const totals = useMemo(() => leaseTotals(leases ?? []), [leases]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (leases ?? [])
      .filter((lease) => stage === "all" || providerLeaseStage(lease) === stage)
      .filter((lease) => !needle || leaseSearchText(lease).toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [leases, query, stage]);

  return (
    <div className="leases-workspace">
      <PageHeader title="Leases" description="Send prepared agreements, follow acceptance and keep the final record." />
      {error ? <Notice tone="error" title={error} /> : null}

      <dl className="leases-overview">
        <LeaseCount label="Total agreements" value={totals.total} />
        <LeaseCount label="Active" value={totals.active} tone="active" />
        <LeaseCount label="Awaiting tenant" value={totals.awaiting} tone="awaiting" />
      </dl>

      <label className="leases-search">
        <span className="sr-only">Search leases</span>
        <input type="search" value={query} onChange={(event) => setParams({ q: event.target.value })} placeholder="Search tenant, Property or Unit" />
      </label>

      <div className="leases-filters" aria-label="Agreement stage">
        {LEASE_FILTERS.map((value) => (
          <button key={value} type="button" aria-pressed={stage === value} onClick={() => setParams({ show: value === "send" ? "" : value })}>
            {leaseFilterLabel(value)} <span>{counts[value]}</span>
          </button>
        ))}
      </div>

      {leases === null ? <LoadingRows rows={4} /> : visible.length ? (
        <ul className="leases-list">
          {visible.map((lease) => <ProviderLeaseRow key={lease.id} lease={lease} />)}
        </ul>
      ) : <Empty
        title={query ? "No matching agreements" : stage === "send" ? "Nothing to send" : stage === "current" ? "No current agreements" : stage === "history" ? "No agreement history yet" : "No agreements yet"}
        body={query ? "Try a different tenant, Property or Unit." : stage === "send" ? "Prepare agreements from accepted tenancy requests. Saved drafts appear here before they are sent." : stage === "current" ? "Sent, accepted and active agreements appear here." : stage === "history" ? "Declined, withdrawn and ended agreements remain available as records." : "Agreements you prepare from accepted tenancy requests appear here."}
        action={(stage === "send" || stage === "all") && !query ? <Link href="/applications" className="type-body-strong">Open tenancy requests →</Link> : undefined}
      />}
    </div>
  );
}

function LeaseCount({ label, value, tone }: { label: string; value: number; tone?: "active" | "awaiting" }) {
  return (
    <div>
      <dt className="type-caption">{label}</dt>
      <dd data-tone={value > 0 ? tone : undefined}>{value}</dd>
    </div>
  );
}

function ProviderLeaseRow({ lease }: { lease: Lease }) {
  return (
    <li>
      <Link href={`/leases/${lease.id}` as never} className="lease-row">
        <span className="lease-row-person"><strong>{leaseTenant(lease)}</strong><span>{leasePlace(lease)}</span></span>
        <span className="lease-row-terms">{providerLeaseRent(lease)}<small>{providerLeaseMoveIn(lease)} to move in</small></span>
        <span className={`lease-row-state is-${providerLeaseTone(lease)}`}><i />{providerLeaseStatus(lease)}</span>
        <span className="lease-row-date">{providerLeaseDate(lease)}</span>
        <span className="lease-row-arrow" aria-hidden="true">›</span>
      </Link>
    </li>
  );
}
