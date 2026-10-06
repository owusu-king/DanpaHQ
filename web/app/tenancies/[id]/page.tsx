"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon, type IconName } from "@/components/portal/icons";
import { EntityPath } from "@/components/property/WorkspacePatterns";
import { PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import {
  findTenancy,
  listMyTenancies,
  tenancyLabel,
  type Tenancy,
} from "@/lib/tenancy";
import { leaseProgress, shortDate } from "@/lib/tenancyDisplay";

/**
 * One tenancy, and everything that belongs to it, from the tenant's side.
 *
 * The tenancy is identified by the route, which is the whole point: a tenant
 * may hold several, and picking one has to be something they did rather than
 * something a previous screen left behind. There is no "current tenancy" in
 * state anywhere for this page to inherit.
 *
 * Laid out as the provider's tenancy record is (owner, 2026-10-05: "match our
 * cleanly organized ui/ux"): the home and its standing in the head, the rent
 * and how far through the lease beside each other, then the facts and the
 * places to go. Per-tenancy things — rent, the agreement, repairs — start
 * here; Explore, saved places and applications stay outside every tenancy,
 * because they belong to the person.
 */
export default function TenancyPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [tenancies, setTenancies] = useState<Tenancy[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listMyTenancies()
      .then((rows) => { if (!cancelled) { setTenancies(rows); setError(""); } })
      .catch((cause) => {
        if (cancelled) return;
        setTenancies([]);
        setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this tenancy.");
      });
    return () => { cancelled = true; };
  }, [attempt]);

  const path = (label: string) => (
    <EntityPath items={[{ label: "Home", href: "/home", mobileLabel: "Back to Home" }, { label }]} />
  );

  if (tenancies === null) {
    return (
      <div className="ws-page tenancy-record">
        <WorkspaceHead icon="home" title="Your home" path={path("Your home")} />
        <section className="ws-panel" aria-busy="true" aria-label="Your home"><PanelSkeleton rows={4} round /></section>
      </div>
    );
  }

  const tenancy = findTenancy(tenancies, id);

  if (error || !tenancy) {
    return (
      <div className="ws-page tenancy-record">
        <WorkspaceHead icon="home" title="Your home" path={path("Your home")} />
        <section className="ws-panel" aria-label="Your home">
          {error ? (
            <PanelState
              tone="error"
              icon="warning"
              title="This home didn’t load"
              body={error}
              action={<button type="button" className="ws-action" onClick={() => setAttempt((value) => value + 1)}>Try again</button>}
            />
          ) : (
            <PanelState
              icon="home"
              title="This tenancy isn’t one of yours"
              body="It may have ended, or the link may be wrong."
              action={<Link href="/home" className="ws-action is-primary">Back to Home</Link>}
            />
          )}
        </section>
      </div>
    );
  }

  const lease = tenancy.lease;
  const rent = tenancy.rent;
  const due = rent?.next_due ?? null;
  const rentState = (rent?.overdue_count ?? 0) > 0 ? "overdue" : (rent?.outstanding_count ?? 0) > 0 ? "outstanding" : "current";
  const position = rentState === "current" ? "Paid up" : rentState === "overdue" ? "Overdue" : "Payment due";
  const home = tenancyLabel(tenancy);
  const place = [tenancy.property.locality, tenancy.property.district].filter(Boolean).join(", ");
  const progress = lease?.starts_on && lease.ends_on
    ? leaseProgress({ lease_starts_on: lease.starts_on, lease_ends_on: lease.ends_on } as never)
    : null;
  const per = lease?.rent_period === "yearly" ? "year" : "month";
  const active = tenancy.status === "active";

  return (
    <div className="ws-page tenancy-record tn-page">
      <WorkspaceHead
        icon="home"
        title={tenancy.property.title}
        path={path(tenancy.property.title)}
        mark={tenancy.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="tn-home-mark" src={tenancy.photo_url} alt="" aria-hidden="true" />
        ) : undefined}
        summary={(
          <>
            <span className="tenant-state" data-state={stateKey(tenancy)}>{tenancy.status_display}</span>
            <span className="ws-summary-sep" aria-hidden="true">·</span>
            {home}
            {place ? (
              <>
                <span className="ws-summary-sep" aria-hidden="true">·</span>
                {place}
              </>
            ) : null}
          </>
        )}
        actions={(
          <>
            {lease ? (
              <Link href={`/payments/${lease.id}?mode=tenant` as never} className="ws-action"><Icon name="payments" />Rent account</Link>
            ) : null}
            {/* Repairs are about *this* home, so reporting starts here already on it. */}
            {active ? (
              <Link href={`/maintenance?report=${tenancy.id}` as never} className="ws-action is-primary"><Icon name="wrench" />Report a problem</Link>
            ) : null}
          </>
        )}
      />

      {!lease ? (
        <Callout tone="warning" icon="leases" title="Waiting for your agreement">
          Your landlord sends a lease; accepting it activates this tenancy.
        </Callout>
      ) : null}
      {due?.is_overdue ? (
        <Callout tone="critical" icon="warning" title={`${due.kind_display} overdue`}>
          {`${due.amount_formatted ?? "An amount"} was due ${shortDate(due.due_on)}.`}
        </Callout>
      ) : null}

      {/* What you pay and where it stands, beside how far through the lease you are. */}
      <section className="tn-hero" data-tone={rentState} aria-label="Rent and lease">
        <div className="tn-rent">
          <small>Rent</small>
          <strong>
            {lease?.rent_formatted ?? "Not set"}
            {lease?.rent_formatted ? <span> / {per}</span> : null}
          </strong>
          <span className="tn-position"><i aria-hidden="true" />{position}</span>
          <dl className="tn-figures">
            <div data-tone={rentState === "current" ? undefined : rentState}>
              <dt>{rentState === "overdue" ? "Overdue" : "Owed"}</dt>
              <dd>{rentState === "current" ? "Nothing" : rent?.outstanding_formatted ?? "—"}</dd>
            </div>
            <div>
              <dt>Next due</dt>
              <dd>{due ? `${due.amount_formatted ?? due.kind_display} · ${shortDate(due.due_on)}` : "Not scheduled"}</dd>
            </div>
          </dl>
        </div>
        <div className="tn-lease">
          <header>
            <small>Lease</small>
            <strong>
              {progress
                ? progress.ended ? "Ended" : !progress.started ? "Not started" : `${progress.monthsLeft} month${progress.monthsLeft === 1 ? "" : "s"} left`
                : lease ? "Open-ended" : "No agreement yet"}
            </strong>
          </header>
          {progress && lease?.starts_on && lease.ends_on ? (
            <>
              <span className="tn-lease-bar" aria-hidden="true"><i style={{ width: `${Math.round(progress.share * 100)}%` }} /></span>
              <span className="tn-lease-ends">
                <span>{shortDate(lease.starts_on)}</span>
                <span>{shortDate(lease.ends_on)}</span>
              </span>
            </>
          ) : (
            <p>{lease ? "No end date on the agreement." : "It starts once you accept the agreement."}</p>
          )}
        </div>
      </section>

      <div className="tn-grid">
        <section className="tn-panel" aria-labelledby="tenancy-facts">
          <h2 className="tn-panel-title" id="tenancy-facts">Your tenancy</h2>
          <dl className="tn-facts">
            <Fact icon="home" label="Status" value={tenancy.status_display} />
            <Fact icon="leases" label="Agreement" value={lease?.status_display ?? "Not sent yet"} />
            <Fact icon="clock" label="Starts" value={tenancy.starts_on ? shortDate(tenancy.starts_on) : lease?.starts_on ? shortDate(lease.starts_on) : "Not set"} />
            <Fact icon="clock" label="Ends" value={lease?.ends_on ? shortDate(lease.ends_on) : "Open-ended"} />
            <Fact icon="payments" label="Rent" value={lease?.rent_formatted ? `${lease.rent_formatted} per ${per}` : "Not set"} />
            <Fact icon="units" label="Home" value={`${home} · ${tenancy.space.space_type_label}`} />
          </dl>
        </section>

        <aside className="tn-panel" aria-labelledby="tenancy-related">
          <h2 className="tn-panel-title" id="tenancy-related">For this home</h2>
          <ul className="tn-links">
            {lease ? <RelatedLink href={`/leases/${lease.id}`} icon="leases" label="Agreement" detail={lease.status_display} /> : null}
            <RelatedLink href="/maintenance" icon="wrench" label="Repairs" detail="Your maintenance requests" />
            {tenancies.length > 1 ? <RelatedLink href="/home" icon="home" label="All your homes" detail={`${tenancies.length} homes`} /> : null}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function stateKey(tenancy: Tenancy) {
  if (tenancy.status === "ended") return "inactive";
  if (tenancy.status === "pending_lease") return "pending";
  return tenancy.status;
}

function Callout({ tone, icon, title, children }: { tone: "warning" | "critical"; icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <div className="tn-callout" data-tone={tone} role={tone === "critical" ? "alert" : "status"}>
      <span className="tn-callout-mark" aria-hidden="true"><Icon name={icon} /></span>
      <div>
        <p className="tn-callout-title">{title}</p>
        <p className="tn-callout-body">{children}</p>
      </div>
    </div>
  );
}

function Fact({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="tn-fact">
      <dt><Icon name={icon} />{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RelatedLink({ href, icon, label, detail }: { href: string; icon: IconName; label: string; detail: string }) {
  return (
    <li>
      <Link href={href as never} className="tn-link">
        <span className="tn-link-mark" aria-hidden="true"><Icon name={icon} /></span>
        <span className="tn-link-text"><strong>{label}</strong><small>{detail}</small></span>
        <svg className="tn-link-go" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}
