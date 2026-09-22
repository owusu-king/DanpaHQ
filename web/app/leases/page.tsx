"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgreementDetailModal } from "@/components/tenant/AgreementRecord";
import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { Icon } from "@/components/portal/icons";
import {
  agreedTerms,
  agreementFilters,
  homeOf,
  matchesAgreementFilter,
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
import { getLeaseLedger, listMyLeases, type RentCharge } from "@/lib/tenant";
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
 * The index is deliberately recognition-only: home, Unit, standing, one useful
 * date and the way into the record. Money, parties, conditions and acceptance
 * evidence belong to the reading surface, where the tenant can understand the
 * complete agreement before acting. Modified clicks retain the durable route.
 */
function TenantLeases() {
  const [leases, setLeases] = useState<Lease[] | null>(null);
  const [error, setError] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedLeaseId, setSelectedLeaseId] = useState<string | null>(null);
  const [selectedCharges, setSelectedCharges] = useState<RentCharge[]>([]);
  const filterRoot = useRef<HTMLDivElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);

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

  // Preserve old pane-era deep links by resolving them to the durable record.
  useEffect(() => {
    if (window.location.hash.startsWith("#agreement-")) {
      router.replace(`/leases/${window.location.hash.slice("#agreement-".length)}` as never);
      return;
    }
    const requested = search.get("open");
    if (requested) router.replace(`/leases/${requested}` as never);
  }, [router, search]);

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
    setFilterOpen(false);
    filterButton.current?.focus();
  }, [setParams]);

  const rows = useMemo<TenantAgreementRow[]>(
    () => (leases ?? []).map((lease) => ({ lease, state: standing(lease) })),
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

  const current = visible.filter((row) => row.state.stage !== "past");
  const history = visible.filter((row) => row.state.stage === "past");
  const showSearch = (leases?.length ?? 0) > 5 || Boolean(query);
  const showFilter = new Set(rows.map((row) => row.state.stage)).size > 1 || filter !== "all";
  const selectedLabel = agreementFilters.find((option) => option.id === filter)?.label ?? "Agreements";
  const unfilteredView = filter === "all" && !query.trim();
  const initialCurrentLimit = Math.min(current.length, history.length ? 4 : 5);
  const initialHistoryLimit = Math.min(history.length, Math.max(0, 5 - initialCurrentLimit));
  const selectedLease = leases?.find((lease) => lease.id === selectedLeaseId) ?? null;

  const openAgreement = useCallback((lease: Lease) => {
    setSelectedLeaseId(lease.id);
    setSelectedCharges([]);
    if (lease.status === "active") {
      void getLeaseLedger(lease.id)
        .then((ledger) => setSelectedCharges(ledger.charges))
        .catch(() => setSelectedCharges([]));
    }
  }, []);

  return (
    <div className="agreements tenant-agreements">
      <PageHeader
        title="Agreements"
        description={leases === null || error ? undefined : agreementSummary(counts, rows.length)}
      />

      {leases === null ? (
        <AgreementLoading />
      ) : error ? (
        <div className="agreements-error">
          <Notice tone="error" title={error} body="Check your connection and try again." />
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      ) : leases.length === 0 ? (
        <div className="agreements-empty">
          <Empty
            title="No agreement yet"
            body="When a landlord sends you an agreement, it will wait here for your review."
            action={<Link href="/rentals" className="type-body-strong">Explore rentals &rarr;</Link>}
          />
        </div>
      ) : (
        <>
          {showSearch || showFilter ? (
            <div className="agreements-tools">
              {showSearch ? (
                <label className="agreements-search">
                  <span className="sr-only">Search your agreements</span>
                  <Icon name="explore" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setParams({ q: event.target.value })}
                    placeholder="Search Property, Unit or landlord"
                  />
                </label>
              ) : <span />}

              {showFilter ? (
                <div className="agreements-filter" ref={filterRoot}>
                  <button
                    ref={filterButton}
                    type="button"
                    className={`agreement-filter-trigger${filter !== "all" ? " is-active" : ""}`}
                    aria-expanded={filterOpen}
                    aria-haspopup="menu"
                    aria-controls="agreement-filter-menu"
                    onClick={() => setFilterOpen((open) => !open)}
                  >
                    <Icon name="filters" />
                    <span>{filter === "all" ? "All agreements" : selectedLabel}</span>
                    <Icon name="chevron-down" />
                  </button>

                  {filterOpen ? (
                    <div id="agreement-filter-menu" className="agreement-filter-panel" role="menu" aria-label="Agreement view">
                      <AgreementFilterOption id="all" current={filter} count={counts.all} onSelect={chooseFilter} />
                      <div className="agreement-filter-group" role="group" aria-label="Current agreements">
                        <span className="agreement-filter-group-label">Current</span>
                        {(["action", "active"] as const).map((id) => (
                          <AgreementFilterOption key={id} id={id} current={filter} count={counts[id]} onSelect={chooseFilter} />
                        ))}
                      </div>
                      <div className="agreement-filter-group" role="group" aria-label="Agreement history">
                        <span className="agreement-filter-group-label">History</span>
                        <AgreementFilterOption id="past" current={filter} count={counts.past} onSelect={chooseFilter} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {visible.length ? (
            <div className="agreements-results">
              {unfilteredView ? (
                <>
                  {current.length ? <AgreementGroup title="Current" rows={current} initialLimit={initialCurrentLimit} onOpen={openAgreement} /> : null}
                  {history.length ? <AgreementGroup title="History" rows={history} initialLimit={initialHistoryLimit} historical onOpen={openAgreement} /> : null}
                </>
              ) : (
                <AgreementGroup
                  key={`${filter}:${query}`}
                  title={query ? "Matches" : selectedLabel}
                  rows={visible}
                  initialLimit={5}
                  historical={visible.every((row) => row.state.stage === "past")}
                  onOpen={openAgreement}
                />
              )}
            </div>
          ) : query ? (
            <Empty title="No matching agreements" body="Try another Property, Unit or landlord." />
          ) : (
            <AgreementFilterEmpty filter={filter} />
          )}

          {selectedLease ? (
            <AgreementDetailModal
              key={selectedLease.id}
              lease={selectedLease}
              charges={selectedCharges}
              onChanged={load}
              onClose={() => setSelectedLeaseId(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

type TenantAgreementRow = {
  lease: Lease;
  state: ReturnType<typeof standing>;
};

function agreementSummary(counts: Record<AgreementFilter, number>, total: number): string {
  if (counts.action === 1) return `One agreement is ready for review · ${total} record${total === 1 ? "" : "s"}`;
  if (counts.action > 1) return `${counts.action} agreements need your review · ${total} records`;
  if (counts.active > 0) return `${counts.active} current · ${total} agreement${total === 1 ? "" : "s"}`;
  return `${total} agreement record${total === 1 ? "" : "s"}`;
}

function AgreementLoading() {
  return (
    <div className="agreements-loading" role="status" aria-label="Loading agreements">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="agreement-loading-row" key={index} aria-hidden="true">
          <span className="skeleton agreement-loading-mark" />
          <span className="agreement-loading-copy"><i className="skeleton" /><i className="skeleton" /></span>
          <span className="skeleton agreement-loading-status" />
        </div>
      ))}
    </div>
  );
}

function AgreementFilterOption({
  id,
  current,
  count,
  onSelect,
}: {
  id: AgreementFilter;
  current: AgreementFilter;
  count: number;
  onSelect: (filter: AgreementFilter) => void;
}) {
  const label = agreementFilters.find((option) => option.id === id)?.label ?? id;
  const active = current === id;
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`agreement-filter-option${active ? " is-selected" : ""}`}
      onClick={() => onSelect(id)}
    >
      <span>{label}</span>
      <small>{count}</small>
      <span className="agreement-filter-mark" aria-hidden="true">{active ? <Icon name="check" /> : null}</span>
    </button>
  );
}

function AgreementGroup({
  title,
  rows,
  initialLimit,
  historical = false,
  onOpen,
}: {
  title: string;
  rows: TenantAgreementRow[];
  initialLimit: number;
  historical?: boolean;
  onOpen: (lease: Lease) => void;
}) {
  const pageSize = 5;
  const [limit, setLimit] = useState(initialLimit);
  const shown = rows.slice(0, limit);
  const remaining = rows.length - shown.length;

  return (
    <section className={`agreement-group${historical ? " is-history" : ""}`}>
      <header className="agreement-group-head">
        <h2>{title}</h2>
        <span aria-label={`${rows.length} ${rows.length === 1 ? "agreement" : "agreements"}`}>{rows.length}</span>
      </header>
      <ul className="agreements-list">
        {shown.map((row) => <AgreementRow key={row.lease.id} {...row} onOpen={onOpen} />)}
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

function AgreementFilterEmpty({ filter }: { filter: AgreementFilter }) {
  const copy: Record<AgreementFilter, { title: string; body: string }> = {
    all: { title: "No agreements here", body: "Your agreements will appear here." },
    action: { title: "Nothing needs you", body: "You have reviewed every agreement sent to you." },
    active: { title: "No current agreements", body: "Accepted agreements will stay easy to find here." },
    past: { title: "No agreement history", body: "Ended or declined agreements will remain available here." },
  };
  return (
    <div className="agreement-filter-empty" role="status">
      <strong>{copy[filter].title}</strong>
      <span>{copy[filter].body}</span>
    </div>
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

function AgreementRow({ lease, state, onOpen }: TenantAgreementRow & { onOpen: (lease: Lease) => void }) {
  const terms = agreedTerms(lease);
  const unit = [terms.unitLabel, terms.bedLabel].filter(Boolean).join(" · ");
  const date = agreementDate(lease, state);

  return (
    <li>
      <Link
        href={`/leases/${lease.id}` as never}
        className={`agreement-row is-${state.stage}`}
        aria-label={`Open the agreement for ${homeOf(terms)}. ${state.line}.`}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onOpen(lease);
        }}
      >
        <span className="agreement-row-mark" aria-hidden="true"><Icon name="leases" /></span>

        <span className="agreement-row-identity">
          <strong>{terms.propertyTitle}</strong>
          {unit ? <span className="agreement-row-unit">{unit}</span> : null}
          {lease.locality_name ? <span className="agreement-row-place">{lease.locality_name}</span> : null}
        </span>

        <span className={`agreement-row-standing is-${state.stage}`}>
          <i aria-hidden="true" />
          <strong>{state.line}</strong>
        </span>

        <span className="agreement-row-date">
          <small>{date.label}</small>
          <time dateTime={date.value}>{onDate(date.value)}</time>
        </span>

        <span className="agreement-row-action">
          <span>{state.decisionOpen ? "Review" : "View"}</span>
          <Icon name="chevron-down" />
        </span>
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
