"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Notice } from "@/components/Notice";
import { JoinHomeButton } from "@/components/tenant/JoinHome";
import { openEnquiries } from "@/components/enquiries/EnquiriesInbox";
import { ProviderFinanceChart } from "@/components/home/ProviderFinanceChart";
import { LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { Icon, type IconName } from "@/components/portal/icons";
import { isLive } from "@/lib/applicationMeaning";
import { ApiFailure } from "@/lib/api";
import {
  listOrganizations,
  listOrganizationProperties,
  listReceivedApplications,
  listGrantedLeases,
  listHostViewings,
  getOrganizationPortfolio,
  type Organization,
  type OrganizationPortfolio,
  type Property,
  type ProviderTenant,
  type RentalApplication,
  type Viewing,
} from "@/lib/console";
import { propertyNextStep } from "@/lib/providerSetup";
import { formatMoney } from "@/lib/money";
import { listEnquiries, type Enquiry } from "@/lib/sales";
import { useSession, type Me } from "@/lib/session";
import {
  listMyApplications,
  listMyLeases,
  listMyViewings,
  type MyApplication,
  listMyJoinRequests,
  type MyJoinRequest,
  type MyViewing,
} from "@/lib/tenant";
import { listMyTenancies, type Tenancy } from "@/lib/tenancy";
import type { Lease } from "@/lib/console";
import { standing as applicationStanding } from "@/lib/applicationMeaning";
import {
  attention,
  comingUp,
  greeting as greetPerson,
  homeSpace,
  homeWhere,
  rentLine,
  type AttentionItem,
  type UpcomingEntry,
} from "@/lib/homeMeaning";
import { standing as viewingStanding, whenLabel } from "@/lib/viewingMeaning";

/**
 * The portal's front door, for whichever role opened it.
 *
 * One route, because "home" is the same question for both — *what is going on,
 * and what should I do next* — and answering it from two separate pages would
 * mean two shells, two layouts and two sets of loading states for one idea.
 * What differs is entirely the data, which is fetched per role and enforced per
 * role by the backend.
 *
 * Provider Home is an operational dashboard; Tenant Home remains a lifecycle
 * control center. Metrics and visual summaries are earned only when they make
 * a real Portfolio relationship faster to understand, and no chart is drawn
 * from data the backend does not own.
 */
export default function HomePage() {
  const { state, activeContext } = useSession();

  if (state.status === "loading") {
    return (
      <>
        <PageHeader title="Home" />
        <LoadingRows rows={4} />
      </>
    );
  }
  if (state.status !== "signed_in") return null;

  const me = state.me;
  // Either door into the provider experience: this person's own declared
  // journey, or a Portfolio they were invited into. Reading `exists` alone gave
  // an invited member the tenant Home while they stood in the provider
  // workspace, which is most of what "the invitation went nowhere" looked like.
  const inProvider =
    me.capabilities.active_workspace === "provider"
    && (me.capabilities.provider.workspace_access || me.capabilities.provider.exists);

  return inProvider ? <ProviderHome me={me} activeContext={activeContext} /> : <TenantHome me={me} />;
}

/* --- tenant ------------------------------------------------------------- */

/**
 * The tenant's control center.
 *
 * Four questions, in this order: *does anything need me, what am I renting,
 * where does my rent and agreement stand, and what is coming next.* Everything
 * on the page answers one of them.
 *
 * The screen adapts to the lifecycle rather than showing everyone the same
 * dashboard. Somebody with no tenancy gets two ways forward and a summary of
 * what they have in flight — no Rent card, no Agreement card, no Home card,
 * because an empty module is not information. Somebody renting gets their homes
 * first, each with its own rent and its own agreement.
 *
 * Nothing is merged across homes. There is no total owed, no "current" tenancy
 * and no selector that hides one behind another — `lib/tenancy` is explicit
 * that ambient selection is how a tenant renting two places lost sight of one.
 * Each home is a card that stands on its own.
 *
 * Not here: listings. Explore is a tab away and this is not a discovery
 * surface. Not here either: maintenance, because Danpa HQ has no maintenance
 * domain yet and a card saying "No open issue" would be a promise.
 */
function TenantHome({ me }: { me: Me }) {
  const [tenancies, setTenancies] = useState<Tenancy[] | null>(null);
  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [viewings, setViewings] = useState<MyViewing[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [joinRequests, setJoinRequests] = useState<MyJoinRequest[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listMyTenancies(),
      listMyApplications().catch(() => [] as MyApplication[]),
      listMyViewings().catch(() => [] as MyViewing[]),
      listMyLeases().catch(() => [] as Lease[]),
      listMyJoinRequests().catch(() => [] as MyJoinRequest[]),
    ])
      .then(([rows, apps, views, agreements, requests]) => {
        if (cancelled) return;
        setTenancies(rows);
        setApplications(apps);
        setViewings(views);
        setLeases(agreements);
        setJoinRequests(requests);
        setError("");
      })
      .catch((cause) => {
        if (cancelled) return;
        setTenancies([]);
        setError(
          cause instanceof ApiFailure
            ? cause.error.message
            : "We could not load your home right now.",
        );
      });
    return () => { cancelled = true; };
  }, []);

  const homes = useMemo(() => tenancies ?? [], [tenancies]);

  // Whether a viewing or an application is waiting on this person is decided
  // by the same module their own screens use, so Home cannot disagree with
  // them about it.
  const needs = useMemo(() => {
    const viewingsWaiting = viewings
      .map((viewing) => ({ viewing, state: viewingStanding(viewing) }))
      .filter((row) => row.state.group === "action")
      .map((row) => ({
        id: row.viewing.id,
        headline: row.viewing.listing_headline,
        action: row.state.line,
      }));
    const applicationsWaiting = applications
      .map((application) => ({ application, state: applicationStanding(application, leases) }))
      .filter((row) => row.state.stage === "action")
      .map((row) => ({
        id: row.application.id,
        headline: row.application.listing_headline,
        action: row.state.line,
      }));
    return attention({
      tenancies: homes,
      offeredLeases: leases.filter((lease) => lease.status === "offered"),
      viewingsWaiting,
      applicationsWaiting,
      joinRequests,
    });
  }, [applications, homes, joinRequests, leases, viewings]);

  const upcoming: UpcomingEntry[] = useMemo(
    () => comingUp({ tenancies: homes, viewings }),
    [homes, viewings],
  );
  const openApplications = applications.filter((row) => isLive(row));
  const nextViewing = viewings
    .filter((row) => row.confirmed_starts_at && row.is_upcoming)
    .sort((a, b) => (a.confirmed_starts_at ?? "").localeCompare(b.confirmed_starts_at ?? ""))[0];
  const pendingJoin = joinRequests.filter((row) => row.status === "pending");
  const upcomingViewings = viewings.filter((row) => row.is_upcoming).length;
  const inFlight = openApplications.length + upcomingViewings + pendingJoin.length;

  // The home the page leads with: whichever one costs most to ignore. Overdue
  // first, then the soonest due date, then the first one they have.
  const leadHome = useMemo(() => rankHomes(homes)[0] ?? null, [homes]);
  const owed = useMemo(() => totalOwed(homes), [homes]);
  const acceptedApplications = applications.filter((row) => row.status === "accepted").length;
  const activeLeases = leases.filter((row) => row.status === "active").length;

  return (
    <div className="home-workspace tenant-home">
      <div className="home-greeting">
        <div className="home-greeting-copy">
          <p className="home-eyebrow">{leadHome ? leadHome.property.title : "Your rentals"}</p>
          <h1>{greetPerson(me.preferred_name || me.first_name || "")}</h1>
          <p>{tenantSummary(needs.length, homes.length, upcoming.length)}</p>
        </div>
        <div className="home-greeting-aside">
          <DraftedElevation />
          <p className="home-greeting-when">
            <strong>{todayLabel()}</strong>
            Accra, GMT
          </p>
        </div>
      </div>

      {error ? <Notice tone="error" title={error} /> : null}

      {tenancies === null ? (
        <TenantHomeSkeleton />
      ) : homes.length === 0 ? (
        <NoTenancy
          applications={openApplications.length}
          nextViewing={nextViewing ?? null}
          pendingJoin={pendingJoin}
        />
      ) : (
        <>
          <div className="home-overview-grid">
            {/* Everything this person rents, added up. It speaks for the
                whole account, so nothing on it names one home or one place —
                that is the list below's job, and a single locality on an
                aggregate would be quietly wrong the moment there are two. */}
            <section className="home-pulse" aria-labelledby="tenant-overview-title">
              <div className="home-pulse-copy">
                <h2 id="tenant-overview-title">Overview</h2>
                <span className="home-pulse-badge" data-tone={owed.overdue ? "attention" : "clear"}>
                  {owed.minor ? (owed.overdue ? "Rent overdue" : "Rent scheduled") : "Nothing due"}
                </span>
              </div>
              <div className="home-pulse-body">
                <ApplicationGauge total={applications.length} accepted={acceptedApplications} />
                <div className="home-pulse-metrics" data-columns={applications.length ? "two" : "three"}>
                  <TenantFact
                    label={plural(homes.length, "Tenancy", "Tenancies")}
                    value={String(homes.length)}
                    figure
                  />
                  {/* Marked as soon as anything is outstanding, not only
                      once it is late: what a tenant owes is the fact this card
                      exists to carry. Nothing owed is left unmarked, because a
                      red zero would be alarming about good news. */}
                  <TenantFact
                    label={owed.minor ? "Owed in total" : "Owed"}
                    value={owed.formatted}
                    figure
                    tone={owed.overdue ? "overdue" : owed.minor ? "owed" : undefined}
                  />
                  <TenantFact
                    label={owed.earliest ? (owed.overdue ? "Overdue since" : "Earliest due") : "Next due"}
                    value={owed.earliest ? shortDate(owed.earliest) : "Nothing scheduled"}
                    tone={owed.overdue ? "overdue" : undefined}
                  />
                  <TenantFact
                    label={plural(activeLeases, "Active agreement", "Active agreements")}
                    value={String(activeLeases)}
                    figure
                  />
                </div>
              </div>
              <div className="home-inventory-link">
                <span>
                  <strong>Have an access code?</strong>
                  <small>Your landlord can give you one for a place you already live in.</small>
                </span>
                {/* A small modal, not a page (owner, 2026-10-05). */}
                <JoinHomeButton className="home-primary-action is-compact">
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  Join a home
                </JoinHomeButton>
              </div>
            </section>

            <section className="home-attention-panel" data-clear={needs.length === 0} aria-labelledby="tenant-attention-title">
              <div className="home-widget-head">
                <h2 id="tenant-attention-title">Needs attention</h2>
                <span className="home-widget-count">
                  {needs.length ? `${needs.length} ${plural(needs.length, "item", "items")}` : "All clear"}
                </span>
              </div>
              {needs.length ? (
                <ul className="home-attention-list">
                  {needs.slice(0, 5).map((item) => (
                    <li key={item.id} data-tone={attentionTone(item)}>
                      <Link href={tenantDestination(item) as never}>
                        <span className="home-attention-icon" aria-hidden="true" />
                        <span className="home-attention-copy">
                          <strong>{item.title}</strong>
                          <small>{item.place}</small>
                        </span>
                        <span className="home-attention-value">
                          <small>{item.action}</small>
                        </span>
                        <span className="home-row-arrow" aria-hidden="true">›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="home-all-clear">
                  <span aria-hidden="true">✓</span>
                  <p>
                    <strong>Nothing is waiting on you.</strong>
                    <small>Rent, agreements and viewings are all up to date.</small>
                  </p>
                </div>
              )}
              {needs.length > 5 ? <p className="home-more">{needs.length - 5} more waiting</p> : null}
            </section>
          </div>

          <section className="home-finance-chart tenant-schedule" aria-labelledby="tenant-schedule-title">
            <div className="home-finance-head">
              <div>
                <p className="home-eyebrow">Coming up</p>
                <h2 id="tenant-schedule-title">What happens next</h2>
                <p>Rent dates and confirmed viewings, in the order they arrive.</p>
              </div>
              <Link href="/viewings" className="home-widget-link">
                All viewings
                <Chevron />
              </Link>
            </div>
            <div className="tenant-schedule-body">
            {upcoming.length ? (
              <ol className="tenant-timeline">
                {upcoming.map((entry) => (
                  <li key={entry.id}>
                    <span className="tenant-timeline-when">
                      <strong>{whenLabel(entry.when) ?? shortDate(entry.when)}</strong>
                      <small>{shortDate(entry.when)}</small>
                    </span>
                    <span className="tenant-timeline-mark" aria-hidden="true" />
                    <span className="tenant-timeline-what">
                      <strong>{entry.what}</strong>
                      <small>{entry.place}</small>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="home-chart-empty">
                <strong>Nothing scheduled.</strong>
                <small>Rent dates and confirmed viewings appear here as they are set.</small>
              </p>
            )}
            <StreetElevation />
            </div>
          </section>

          <div className="home-lower-grid" data-single={inFlight === 0}>
            <section className="home-panel">
              <div className="home-widget-head">
                <h2>{homes.length > 1 ? "Your homes" : "Your home"}</h2>
                <span className="home-widget-count">
                  {homes.length} {plural(homes.length, "home", "homes")}
                </span>
              </div>
              <ul className="home-rows tenant-homes">
                {rankHomes(homes).map((tenancy) => (
                  <li key={tenancy.id}>
                    <Link href={`/tenancies/${tenancy.id}` as never} className="home-row">
                      <span className="tenant-home-thumb" aria-hidden="true">
                        {tenancy.photo_url ? (
                          /* Short-lived signed URLs from the files service. */
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={tenancy.photo_url} alt="" />
                        ) : (
                          <i />
                        )}
                      </span>
                      {/* The Unit leads. A tenant lives in Flat 2A; East Legon
                          Heights is where Flat 2A is, and two tenancies in one
                          building are otherwise two identical-looking rows. */}
                      <span className="home-row-label">
                        <strong>{homeSpace(tenancy) || tenancy.property.title}</strong>
                        <span className="home-row-meta">
                          {[
                            homeSpace(tenancy) ? tenancy.property.title : null,
                            homeWhere(tenancy),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      {/* This home's own outstanding total, so the card's
                          combined figure can always be traced back to its
                          parts. */}
                      <span className="home-row-go" data-tone={homeTone(tenancy)}>
                        <strong>
                          {tenancy.rent?.outstanding_minor
                            ? tenancy.rent.outstanding_formatted
                            : "—"}
                        </strong>
                        <small>{homeRentNote(tenancy)}</small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            {/* Only when something really is in flight. A tenant who already
                has a home does not need "1 application active" competing with
                their rent, and a permanent row for Explore would be the generic
                dashboard grid this product does not have — the shell's
                navigation already carries it. */}
            {inFlight ? (
              <section className="home-panel tenant-progress">
                <div className="home-widget-head">
                  <h2>In progress</h2>
                  <span className="home-widget-count">
                    {inFlight} {plural(inFlight, "thing", "things")}
                  </span>
                </div>
                <ul className="home-rows">
                  {openApplications.length ? (
                    <li>
                      <Link href="/applications" className="home-row">
                        <span className="home-activity-icon"><Icon name="applications" /></span>
                        <span className="home-row-label">
                          <strong>Applications</strong>
                          <span className="home-row-meta">Places you have applied for</span>
                        </span>
                        <span className="home-row-go">
                          <strong>{openApplications.length}</strong>
                          <small>active</small>
                        </span>
                      </Link>
                    </li>
                  ) : null}
                  {upcomingViewings ? (
                    <li>
                      <Link href="/viewings" className="home-row">
                        <span className="home-activity-icon"><Icon name="viewings" /></span>
                        <span className="home-row-label">
                          <strong>Viewings</strong>
                          <span className="home-row-meta">
                            {nextViewing?.confirmed_starts_at
                              ? (whenLabel(nextViewing.confirmed_starts_at) ?? "Booked")
                              : "Booked"}
                          </span>
                        </span>
                        <span className="home-row-go">
                          <strong>{upcomingViewings}</strong>
                          <small>upcoming</small>
                        </span>
                      </Link>
                    </li>
                  ) : null}
                  {pendingJoin.length ? (
                    <li>
                      <span className="home-row">
                        <span className="home-activity-icon"><Icon name="properties" /></span>
                        <span className="home-row-label">
                          <strong>Access request</strong>
                          <span className="home-row-meta">Waiting on {pendingJoin[0]!.property_title}</span>
                        </span>
                        <span className="home-row-go"><small>Pending</small></span>
                      </span>
                    </li>
                  ) : null}
                </ul>
              </section>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function homeTone(tenancy: Tenancy): "overdue" | "due" | "clear" {
  const due = tenancy.rent?.next_due;
  if (!due) return "clear";
  return due.is_overdue ? "overdue" : "due";
}

function homeRentNote(tenancy: Tenancy): string {
  const due = tenancy.rent?.next_due;
  if (!due) return "nothing due";
  return due.is_overdue ? `overdue since ${shortDate(due.due_on)}` : `due ${shortDate(due.due_on)}`;
}

/** Overdue first, then soonest due, then whatever order they arrived in. */
function rankHomes(homes: Tenancy[]): Tenancy[] {
  return [...homes].sort((left, right) => {
    const a = rentLine(left);
    const b = rentLine(right);
    const weight = (line: ReturnType<typeof rentLine>) =>
      line?.tone === "overdue" ? 0 : line?.tone === "due" ? 1 : 2;
    if (weight(a) !== weight(b)) return weight(a) - weight(b);
    return (a?.when ?? "9999").localeCompare(b?.when ?? "9999");
  });
}

function tenantSummary(needs: number, homes: number, scheduled: number): string {
  if (needs) return `${needs} ${plural(needs, "thing needs", "things need")} you today.`;
  if (!homes) return "You are not renting anywhere yet.";
  if (scheduled) return `Nothing needs you. ${scheduled} ${plural(scheduled, "thing is", "things are")} coming up.`;
  return "Nothing needs you, and nothing is scheduled.";
}

/**
 * What this person owes across every home they rent.
 *
 * Summed in minor units, which is why the payload carries them: adding two
 * tenancies from `amount_formatted` would mean parsing "GH\u20b51,500.00" back
 * into a number, and money is added as integers or not at all.
 *
 * A total is a deliberate reversal of the old rule that nothing on this page
 * was ever merged across homes. It is on the card because a person with two
 * tenancies asked what they owe, not what each lease owes — and the list below
 * still gives every home its own line, so the parts are never lost.
 */
function totalOwed(homes: Tenancy[]): {
  minor: number;
  formatted: string;
  overdue: boolean;
  earliest: string | null;
} {
  let minor = 0;
  let overdueHomes = 0;
  let earliest: string | null = null;
  let currency = "GHS";

  for (const home of homes) {
    const rent = home.rent;
    if (!rent) continue;
    minor += rent.outstanding_minor ?? 0;
    if (rent.outstanding_currency) currency = rent.outstanding_currency;
    const due = rent.next_due;
    if (!due) continue;
    if (due.is_overdue) overdueHomes += 1;
    if (!earliest || due.due_on < earliest) earliest = due.due_on;
  }

  return { minor, formatted: formatMoney({ minor, currency }), overdue: overdueHomes > 0, earliest };
}

/**
 * A tenant's attention item carries no severity of its own, so it is read from
 * the kind: money and agreements cost the most to ignore.
 */
function attentionTone(item: AttentionItem): "danger" | "warning" {
  return item.kind === "rent_overdue" || item.kind === "agreement_offered" ? "danger" : "warning";
}

function tenantDestination(item: AttentionItem): string {
  const map: Record<AttentionItem["destination"], string> = {
    agreements: "/leases",
    viewings: "/viewings",
    applications: "/applications",
    tenancy: "/leases",
    rentals: "/rentals",
  };
  return map[item.destination];
}

function TenantFact({
  label,
  value,
  figure,
  tone,
}: {
  label: string;
  value: string;
  /** A number or an amount, set at display size. Words are set at reading size. */
  figure?: boolean;
  /** `owed` is money outstanding; `overdue` is money outstanding and late. Both
   *  read as the same colour — the distinction is kept in the name so the
   *  markup does not claim a balance is late when it is not. */
  tone?: "owed" | "overdue";
}) {
  return (
    <span className="home-pulse-metric" data-static="true" data-figure={figure} data-tone={tone}>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

/**
 * Applications, and how many were accepted.
 *
 * A half dial rather than a full ring, because the quantity has a floor and a
 * ceiling a person can see at once — none accepted on the left, all of them on
 * the right — and because a full circle reads as a proportion of a whole, which
 * an application count is not.
 *
 * The arc is drawn as a path rather than a dashed circle so the two ends are
 * genuinely flat, the register of ticks is the same drafting language as the
 * Portfolio gauge, and a caliper mark points at the reading on hover.
 */
function ApplicationGauge({ total, accepted }: { total: number; accepted: number }) {
  if (!total) return null;
  const share = Math.min(1, Math.max(0, accepted / total));
  // Left to right across the top: 180 degrees at nought, 360 at all of them.
  const angle = 180 + share * 180;
  const point = (radius: number) => [
    100 + radius * Math.cos((angle * Math.PI) / 180),
    100 + radius * Math.sin((angle * Math.PI) / 180),
  ];
  const [markInnerX, markInnerY] = point(70);
  const [markOuterX, markOuterY] = point(92);

  return (
    <div
      className="tenant-gauge"
      role="img"
      aria-label={`${accepted} of ${total} ${plural(total, "application", "applications")} accepted`}
    >
      <svg viewBox="0 0 200 116" aria-hidden="true">
        <path className="tenant-gauge-track" d="M 16 100 A 84 84 0 0 1 184 100" pathLength="1" />
        <path
          className="tenant-gauge-progress"
          d="M 16 100 A 84 84 0 0 1 184 100"
          pathLength="1"
          style={{ "--gauge-offset": 1 - share } as React.CSSProperties}
        />
        <path className="tenant-gauge-ticks" d="M 16 100 A 84 84 0 0 1 184 100" pathLength="1" />
        <line
          className="tenant-gauge-mark"
          x1={markInnerX}
          y1={markInnerY}
          x2={markOuterX}
          y2={markOuterY}
        />
      </svg>
      <span className="tenant-gauge-reading">
        <strong>{accepted}</strong>
        <small>of {total} accepted</small>
      </span>
      <span className="tenant-gauge-ends" aria-hidden="true">
        <i>0</i>
        <i>{total}</i>
      </span>
    </div>
  );
}

/**
 * A drafted street elevation, for the space the schedule's rows do not use.
 *
 * The alternative was a narrower card, and the schedule wants the full width
 * for its dates. So the empty half gets the one thing this product is actually
 * about, drawn the way the rest of the page is drawn: hairlines, a ground line,
 * a dimension with its ticks, and a single gold accent.
 *
 * It carries no information, which is why it is `aria-hidden` and why it
 * disappears the moment the column is narrow enough to need the room.
 */
function StreetElevation() {
  return (
    <svg className="tenant-elevation" viewBox="0 0 300 180" fill="none" aria-hidden="true">
      {/* ground */}
      <path d="M0 158h300" stroke="currentColor" strokeWidth="1" />
      {/* a flat-roofed block */}
      <path d="M14 158V96h52v62" stroke="currentColor" strokeWidth="0.9" />
      <path d="M14 96h52" stroke="currentColor" strokeWidth="0.9" />
      <path d="M26 112h12v12H26zM42 112h12v12H42zM26 132h12v14H26zM42 132h12v14H42z" stroke="currentColor" strokeWidth="0.6" />
      {/* the pitched one, tallest */}
      <path d="M76 158V74l30-22 30 22v84" stroke="currentColor" strokeWidth="0.9" />
      <path d="M76 74h60" stroke="currentColor" strokeWidth="0.9" />
      <path d="M92 92h12v14H92zM108 92h12v14h-12zM92 116h12v14H92zM108 116h12v14h-12z" stroke="currentColor" strokeWidth="0.6" />
      <path d="M98 158v-18h16v18" stroke="currentColor" strokeWidth="0.7" />
      {/* a low wing */}
      <path d="M146 158v-42h44v42" stroke="currentColor" strokeWidth="0.9" />
      <path d="M146 116h44" stroke="currentColor" strokeWidth="0.9" />
      <path d="M158 130h9v10h-9zM173 130h9v10h-9z" stroke="currentColor" strokeWidth="0.6" />
      {/* the gold one: the home in question */}
      <path d="M200 158V88l24-16 24 16v70" stroke="#9C7A38" strokeWidth="1" />
      <path d="M200 88h48" stroke="#9C7A38" strokeWidth="1" />
      <path d="M212 106h10v12h-10zM226 106h10v12h-10z" stroke="#9C7A38" strokeWidth="0.7" />
      <path d="M216 158v-16h16v16" stroke="#9C7A38" strokeWidth="0.8" />
      {/* a dimension, with its ticks */}
      <path d="M266 52v106" stroke="currentColor" strokeWidth="0.7" />
      <path d="M262 52h8M262 158h8" stroke="currentColor" strokeWidth="0.7" />
      <path d="M264 78h4M264 104h4M264 130h4" stroke="currentColor" strokeWidth="0.6" />
      {/* registration corner */}
      <path d="M284 44h8M292 44v8" stroke="currentColor" strokeWidth="0.7" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The shape of the page, before it arrives.
 *
 * It holds the space the two surfaces will take, so the wait reads as this
 * screen loading rather than as this screen being empty, and nothing jumps
 * when the data lands.
 */
function TenantHomeSkeleton() {
  return (
    <div className="home-dashboard-skeleton" aria-busy="true" aria-label="Loading your home">
      <div className="home-skeleton-grid">
        <div />
        <div />
      </div>
      <div className="home-skeleton-pulse" />
    </div>
  );
}

/**
 * Somebody who is not renting anything yet.
 *
 * Two ways forward and a summary of what is in flight. Nothing about rent,
 * agreements or homes, because they have none and empty cards say nothing.
 */
function NoTenancy({
  applications,
  nextViewing,
  pendingJoin,
}: {
  applications: number;
  nextViewing: MyViewing | null;
  pendingJoin: MyJoinRequest[];
}) {
  return (
    <>
      <div className="home-overview-grid tenant-start">
        <section className="home-pulse">
          <div className="home-pulse-copy">
            <h2>Find your next home</h2>
          </div>
          <div className="tenant-start-body">
            <p>Search verified rentals across Ghana, with the owner and the address checked before the listing goes up.</p>
            <Link href="/rentals" className="home-primary-action">Explore rentals</Link>
          </div>
        </section>

        <section className="home-attention-panel">
          <div className="home-widget-head">
            <h2>Have an access code?</h2>
          </div>
          <div className="tenant-start-body">
            <p>Your landlord can give you one for the place you already live in. It links this account to that home.</p>
            <JoinHomeButton className="home-widget-link">
              Join a home
              <Chevron />
            </JoinHomeButton>
          </div>
        </section>
      </div>

      {applications || nextViewing || pendingJoin.length ? (
        <section className="home-panel">
          <div className="home-widget-head">
            <h2>In progress</h2>
          </div>
          <ul className="home-rows">
            <li>
              <Link href="/applications" className="home-row">
                <span className="home-activity-icon"><Icon name="applications" /></span>
                <span className="home-row-label">
                  <strong>Applications</strong>
                  <span className="home-row-meta">Places you have applied for</span>
                </span>
                <span className="home-row-go">
                  <strong>{applications || "—"}</strong>
                  <small>{applications ? "active" : "none"}</small>
                </span>
              </Link>
            </li>
            <li>
              <Link href="/viewings" className="home-row">
                <span className="home-activity-icon"><Icon name="viewings" /></span>
                <span className="home-row-label">
                  <strong>Viewings</strong>
                  <span className="home-row-meta">
                    {nextViewing?.confirmed_starts_at
                      ? (whenLabel(nextViewing.confirmed_starts_at) ?? "Booked")
                      : "Nothing booked"}
                  </span>
                </span>
                <span className="home-row-go">
                  <small>{nextViewing ? "Confirmed" : "None"}</small>
                </span>
              </Link>
            </li>
            {pendingJoin.length ? (
              <li>
                <span className="home-row">
                  <span className="home-activity-icon"><Icon name="properties" /></span>
                  <span className="home-row-label">
                    <strong>Access request</strong>
                    <span className="home-row-meta">Waiting on {pendingJoin[0]!.property_title}</span>
                  </span>
                  <span className="home-row-go"><small>Pending</small></span>
                </span>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/* --- provider ------------------------------------------------------------ */

type ProviderAttention = {
  /** The thing that is wrong, as a noun. */
  label: string;
  /** Where and how much, in a sentence. */
  meta: string;
  /** The countable part, shown in its own right-hand column so the column
   *  scans as a column. A money amount where there is one, a count otherwise. */
  value: string;
  /** What pressing the row does, shown when the row is approached. */
  action: string;
  href: string;
  icon: IconName;
  tone: "warning" | "danger";
};

/** Something dated ahead: a confirmed viewing, a rent due date, a lease ending. */
type AgendaItem = {
  id: string;
  at: Date;
  kind: "viewing" | "rent" | "lease";
  title: string;
  where: string;
  detail: string;
  href: string;
};

/**
 * Provider Home: the Portfolio at a glance, and the way into everything in it.
 *
 * One composed workspace rather than a grid of equal cards. The hero *is* the
 * overview — the occupancy instrument, the four counts that describe the
 * Portfolio and what is still owed on it. Below it the page divides by kind of
 * attention: the wide column is for reading (how rent is being collected, what
 * is coming up, what just happened), the narrow column is for acting (what
 * needs a decision, the conversations waiting, the Properties themselves).
 *
 * Everything shown is something the backend owns and dated; nothing here is a
 * projection. Maintenance is absent because Danpa HQ has no maintenance domain
 * yet, and a panel reading "No open issue" would be a promise.
 */
function ProviderHome({ me, activeContext }: { me: Me; activeContext: string | null }) {
  const provider = me.capabilities.provider;
  // The Portfolio being operated and what this person's role reaches in it. A
  // member sees their assigned Properties, so "nothing here yet" means
  // something different to them than it does to the owner.
  const portfolioContext = me.contexts.find(
    (context) => context.type === "organization" && context.id === activeContext,
  ) ?? me.contexts.find((context) => context.type === "organization") ?? null;
  const access = portfolioContext?.access ?? null;
  const [properties, setProperties] = useState<Property[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [applications, setApplications] = useState<RentalApplication[]>([]);
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [grantedLeases, setGrantedLeases] = useState<Lease[]>([]);
  const [portfolio, setPortfolio] = useState<OrganizationPortfolio | null>(null);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Enquiries belong to whoever operates the Properties that are for sale.
  const readsEnquiries = access ? access.can.operate_properties : true;

  useEffect(() => {
    // Nothing operational exists before approval, and every one of these calls
    // would be refused. Asking anyway would fill the console with errors that
    // are not the person's problem.
    if (!provider.workspace_access) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    listOrganizations()
      .then(async (orgs) => {
        if (cancelled) return;
        const preferredId = activeContext?.startsWith("organization:")
          ? activeContext.slice("organization:".length)
          : "";
        const organization = orgs.find((row) => row.id === preferredId) ?? orgs[0];
        if (!organization) return { orgs, props: [], apps: [], views: [], leases: [], summary: null, talks: [] };
        // Each list is asked for this Portfolio, so nothing is sifted here.
        // Home used to fetch every Unit purely to filter three account-wide
        // lists by hand — and viewings by *Property title*, which two
        // Properties can share, so a viewing could be dropped, or kept against
        // the wrong building entirely.
        const scope = { organization: organization.id };
        const [props, apps, views, leases, summary, talks] = await Promise.all([
          listOrganizationProperties(organization.id).catch(() => [] as Property[]),
          listReceivedApplications(true, scope).catch(() => [] as RentalApplication[]),
          listHostViewings(true, scope).catch(() => [] as Viewing[]),
          listGrantedLeases(scope).catch(() => [] as Lease[]),
          getOrganizationPortfolio(organization.id).catch(() => null),
          readsEnquiries ? listEnquiries("seller").catch(() => [] as Enquiry[]) : Promise.resolve([] as Enquiry[]),
        ]);
        return { orgs, props, apps, views, leases, summary, talks };
      })
      .then((result) => {
        if (!result || cancelled) return;
        const { orgs, props, apps, views, leases, summary, talks } = result;
        if (cancelled) return;
        setProperties(props);
        setOrganizations(orgs);
        setApplications(apps);
        setViewings(views);
        setGrantedLeases(leases);
        setPortfolio(summary);
        setEnquiries(talks);
        setError("");
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof ApiFailure
              ? cause.error.message
              : "We could not load your Portfolio right now.",
          );
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeContext, provider.workspace_access, readsEnquiries]);

  if (!provider.workspace_access) {
    // A status this build does not recognise still gets a screen that says
    // something true, rather than an empty panel.
    const review = REVIEW_COPY[provider.verification_status ?? "not_started"]
      ?? REVIEW_COPY.not_started!;
    return (
      <>
        <PageHeader
          title={greeting(me)}
          description="Your provider review decides when property tools become available."
        />
        <div className="portal-panel">
          <p className="portal-row-title" style={{ fontSize: "1.0625rem" }}>{review.title}</p>
          <p className="portal-row-meta" style={{ marginTop: "var(--space-2)", maxWidth: "56ch" }}>
            {review.body}
          </p>
          <div style={{ marginTop: "var(--space-5)", display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
            <Link href="/provider" className="type-body-strong">
              {provider.onboarding_complete ? "See your verification →" : "Start verification →"}
            </Link>
            <Link href="/rentals" className="type-caption" style={{ alignSelf: "center" }}>
              Explore rentals meanwhile
            </Link>
          </div>
        </div>
      </>
    );
  }

  const canAddProperty = provider.can_create_property || Boolean(access?.can.create_properties);
  const next = propertyNextStep({
    canCreateProperty: canAddProperty,
    hasWorkspace: organizations.length > 0,
    organizationId: organizations[0]?.id ?? "",
  });

  const money = portfolio?.money;
  const counts = portfolio?.counts;
  const unitCount = counts?.units ?? 0;
  const occupied = counts?.occupied_units ?? 0;
  const available = counts?.vacant_units ?? 0;
  const occupancy = unitCount ? Math.round((occupied / unitCount) * 100) : 0;

  const propertiesNeedingAction = properties.filter((row) =>
    ["changes_required", "rejected", "suspended", "expired"].includes(row.verification.review_state),
  );
  const paymentsAwaitingYou = money?.payment_records_awaiting_you ?? 0;
  const tenancyRequestCount = applications.length + (counts?.pending_join_requests ?? 0);
  const drafts = grantedLeases.filter((lease) => lease.status === "draft");
  const unreadEnquiries = enquiries.filter((row) => row.unread).length;

  // Name the problem on the left, quantify it on the right. The count used to
  // be welded into the label ("3 tenancy requests"), which reads fine in a
  // sentence and badly in a list — the eye cannot run down a column of numbers
  // that each start at a different place.
  const attention = [
    money?.overdue_minor ? { label: "Rent overdue", meta: "Past its due date", value: formatMoney({ minor: money.overdue_minor, currency: "GHS" }), action: "Follow up", href: "/payments", icon: "payments", tone: "danger" } : null,
    money?.settlement_attention_minor ? { label: "Payout needs review", meta: "A settlement failed or reversed", value: formatMoney({ minor: money.settlement_attention_minor, currency: "GHS" }), action: "Review", href: "/payments", icon: "payments", tone: "danger" } : null,
    propertiesNeedingAction.length ? { label: "Property needs an update", meta: "Read the note, then resubmit", value: String(propertiesNeedingAction.length), action: "Resubmit", href: "/properties", icon: "verification", tone: "danger" } : null,
    paymentsAwaitingYou ? { label: "Payments to confirm", meta: "Confirm or dispute what was recorded", value: String(paymentsAwaitingYou), action: "Confirm", href: "/payments", icon: "payments", tone: "warning" } : null,
    tenancyRequestCount ? { label: "Tenancy requests", meta: "Decide who rents", value: String(tenancyRequestCount), action: "Decide", href: "/applications", icon: "applications", tone: "warning" } : null,
    viewings.length ? { label: "Viewing requests", meta: "Offer times or reply", value: String(viewings.length), action: "Reply", href: "/viewings", icon: "viewings", tone: "warning" } : null,
    drafts.length ? { label: "Agreements to send", meta: "Saved but not yet offered", value: String(drafts.length), action: "Send", href: "/documents?view=leases&show=send", icon: "leases", tone: "warning" } : null,
  ].filter((item): item is ProviderAttention => item !== null);

  const ranked = [...properties].sort((left, right) =>
    right.unit_count - left.unit_count
    || right.occupied_unit_count - left.occupied_unit_count
    || left.title.localeCompare(right.title),
  );
  const featuredProperty = ranked[0] ?? null;
  const agenda = agendaOf(viewings, portfolio?.tenants ?? []);

  if (loading) {
    return (
      <div className="home-workspace home-provider">
        <ProviderDashboardSkeleton name={greetPerson(me.preferred_name || me.first_name || "")} />
      </div>
    );
  }

  // A Portfolio with nothing in it gets a beginning, not a wall of zeroes.
  if (properties.length === 0) {
    return (
      <div className="home-workspace home-provider">
        <section className="home-hero is-empty">
          <div className="home-hero-head">
            <p className="home-eyebrow">{organizations[0]?.name ?? "Your Portfolio"}</p>
            <h1>{greetPerson(me.preferred_name || me.first_name || "")}</h1>
            <p className="home-hero-line">Add the first place you manage to begin.</p>
          </div>
        </section>
        {error ? <Notice tone="error" title={error} /> : null}
        <div className="home-start">
          <span className="home-start-mark" aria-hidden="true"><Icon name="properties" /></span>
          {access && access.scope !== "portfolio_wide" ? (
            // A member with nothing assigned is not an empty Portfolio, and
            // telling them to add their first Property would be advice they
            // cannot take: assignment is the owner's decision, not theirs.
            <>
              <h2>Nothing is assigned to you yet</h2>
              <p className="type-body">
                You are in {portfolioContext?.label ?? "this Portfolio"}. The Properties you may
                operate appear here as soon as an owner or administrator assigns them to you.
              </p>
            </>
          ) : (
            <>
              <h2>Your Portfolio starts here</h2>
              <p className="type-body">
                Add your first Property and Danpa HQ will help you organize its Units, tenants,
                agreements and rent.
              </p>
              {canAddProperty ? (
                <p><Link href={next.href as never} className="home-start-action">{next.label}<span aria-hidden="true">→</span></Link></p>
              ) : (
                <p className="type-caption">{next.reason}</p>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="home-workspace home-provider">
      {/* The hero is the overview: who, when, the state of things, and the
          Portfolio's own shape — occupancy and the counts that describe it. */}
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero-head">
          <p className="home-eyebrow">
            {portfolio?.organization.name ?? "Your Portfolio"}
            <span aria-hidden="true"> · </span>
            {todayLabel()}
          </p>
          <h1 id="home-hero-title">{greetPerson(me.preferred_name || me.first_name || "")}</h1>
          <p className="home-hero-line" data-tone={attention.length ? "attention" : "clear"}>
            <i aria-hidden="true" />
            {attention.length
              ? `${attention.length} ${plural(attention.length, "item needs", "items need")} your attention across ${properties.length} ${plural(properties.length, "Property", "Properties")}.`
              : `Your ${properties.length} ${plural(properties.length, "Property is", "Properties are")} operating normally.`}
          </p>
        </div>

        <div className="home-pulse" aria-label="Portfolio overview">
          <OccupancyRing value={occupancy} occupied={occupied} total={unitCount} />
          <div className="home-pulse-metrics">
            <PulseMetric label="Properties" value={properties.length} href="/properties" icon="properties" />
            <PulseMetric label="Rentable Units" value={unitCount} href="/units" icon="units" />
            <PulseMetric label="Active tenancies" value={counts?.active_tenants ?? 0} href="/tenants" icon="users" />
            <PulseMetric label="Vacant Units" value={available} href="/units" icon="units" tone={available ? "vacant" : undefined} />
          </div>
          {money ? (
            <Link href="/payments" className="home-owed" data-tone={money.overdue_minor ? "danger" : money.outstanding_minor ? "warning" : "clear"}>
              <span className="home-owed-label">Still owed on the Portfolio</span>
              <strong><CountUp value={money.outstanding_minor} format={(minor) => formatMoney({ minor, currency: "GHS" })} /></strong>
              <small>
                {money.overdue_minor
                  ? <>{formatMoney({ minor: money.overdue_minor, currency: "GHS" })} of it overdue</>
                  : money.outstanding_minor ? "None of it overdue" : "Every tenancy is paid up"}
              </small>
              <span className="home-owed-go" aria-hidden="true">Open Payments →</span>
            </Link>
          ) : null}
        </div>
      </section>

      {error ? <Notice tone="error" title={error} /> : null}

      <div className="home-stage">
        <div className="home-main">
          {portfolio?.rent_collection ? (
            <ProviderFinanceChart collection={portfolio.rent_collection} />
          ) : null}

          <section className="home-panel home-agenda" aria-labelledby="home-agenda-title">
            <div className="home-widget-head">
              <div>
                <h2 id="home-agenda-title">Coming up</h2>
                <p>Confirmed viewings, rent due and leases ending in the next 30 days.</p>
              </div>
              <Link href="/viewings" className="home-widget-link">
                Viewings
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
            <Agenda items={agenda} />
          </section>

          <section className="home-panel home-activity-panel" aria-labelledby="home-activity-title">
            <div className="home-widget-head">
              <h2 id="home-activity-title">Recent activity</h2>
              <Link href="/updates" className="home-widget-link">
                View all
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
            <RecentActivity portfolio={portfolio} leases={grantedLeases} />
          </section>
        </div>

        <aside className="home-side" aria-label="Needs you">
          <section className="home-attention-panel" data-clear={attention.length === 0} aria-labelledby="provider-attention-title">
            <div className="home-widget-head">
              <h2 id="provider-attention-title">Needs attention</h2>
              <span className="home-widget-count">
                {attention.length ? <CountUp value={attention.length} /> : "All clear"}
              </span>
            </div>
            {attention.length ? (
              <ul className="home-attention-list">
                {attention.slice(0, 6).map((item, index) => (
                  <li key={item.href + item.label} data-tone={item.tone} style={{ "--row": index } as React.CSSProperties}>
                    <Link href={item.href as never}>
                      <span className="home-attention-icon" aria-hidden="true"><Icon name={item.icon} /></span>
                      <span className="home-attention-copy"><strong>{item.label}</strong><small>{item.meta}</small></span>
                      <span className="home-attention-value">
                        <strong>{item.value}</strong>
                        <small className="home-attention-action">{item.action}<span aria-hidden="true"> →</span></small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="home-all-clear">
                <span aria-hidden="true"><Icon name="check" /></span>
                <p><strong>Nothing is waiting on you.</strong><small>Applications, rent, agreements and Property checks are up to date.</small></p>
              </div>
            )}
            {attention.length > 6 ? <p className="home-more">{attention.length - 6} more in their workspaces</p> : null}
          </section>

          {enquiries.length ? (
            <EnquiriesGlance enquiries={enquiries} unread={unreadEnquiries} />
          ) : null}

          {featuredProperty ? <PropertyHighlight property={featuredProperty} others={ranked.slice(1, 4)} /> : null}
        </aside>
      </div>
    </div>
  );
}

/** The next 30 days, from what the backend has dated. */
function agendaOf(viewings: Viewing[], tenants: ProviderTenant[]): AgendaItem[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const horizon = new Date(start.getTime() + 31 * 86_400_000);
  const day = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`);
  const inWindow = (at: Date) => at >= start && at < horizon;
  const items: AgendaItem[] = [];

  for (const viewing of viewings) {
    if (viewing.status !== "confirmed" || !viewing.confirmed_starts_at) continue;
    const at = new Date(viewing.confirmed_starts_at);
    if (at < now || !inWindow(at)) continue;
    items.push({
      id: `viewing-${viewing.id}`,
      at,
      kind: "viewing",
      title: `Viewing with ${viewing.tenant_name}`,
      where: [viewing.property_title, viewing.unit_label].filter(Boolean).join(" · ") || viewing.listing_headline,
      detail: at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" }),
      href: `/viewings/${viewing.id}`,
    });
  }
  for (const tenant of tenants) {
    const place = `${tenant.property_title} · ${tenant.unit_label}`;
    // The tenancy opens in its sheet on Tenants.
    const href = `/tenants?tenant=${tenant.tenancy_id ?? tenant.occupancy_id}`;
    if (tenant.rent.next_due_on) {
      const at = day(tenant.rent.next_due_on);
      if (inWindow(at)) {
        items.push({
          id: `rent-${tenant.occupancy_id}`,
          at,
          kind: "rent",
          title: `Rent due · ${tenant.name}`,
          where: place,
          detail: tenant.lease_rent_minor
            ? formatMoney({ minor: tenant.lease_rent_minor, currency: tenant.lease_rent_currency ?? "GHS" })
            : "Due",
          href,
        });
      }
    }
    if (tenant.lease_ends_on) {
      const at = day(tenant.lease_ends_on);
      if (inWindow(at)) {
        items.push({
          id: `lease-${tenant.occupancy_id}`,
          at,
          kind: "lease",
          title: `Lease ends · ${tenant.name}`,
          where: place,
          detail: "Plan a renewal",
          href,
        });
      }
    }
  }
  return items.sort((left, right) => left.at.getTime() - right.at.getTime()).slice(0, 7);
}

function Agenda({ items }: { items: AgendaItem[] }) {
  if (!items.length) {
    return (
      <div className="home-agenda-empty">
        <span aria-hidden="true"><Icon name="viewings" /></span>
        <p><strong>A clear month ahead.</strong><small>No confirmed viewings, rent dates or lease ends in the next 30 days.</small></p>
      </div>
    );
  }
  // Grouped by day, so a date is read once and the things on it beneath it.
  const groups: Array<{ key: string; at: Date; items: AgendaItem[] }> = [];
  for (const item of items) {
    const key = item.at.toDateString();
    const group = groups.find((row) => row.key === key);
    if (group) group.items.push(item);
    else groups.push({ key, at: item.at, items: [item] });
  }
  return (
    <ol className="home-agenda-days">
      {groups.map((group, groupIndex) => (
        <li key={group.key} className="home-agenda-day" style={{ "--row": groupIndex } as React.CSSProperties}>
          <span className="home-agenda-date" data-today={isToday(group.at) || undefined}>
            <strong>{group.at.getDate()}</strong>
            <small>{dayWord(group.at)}</small>
          </span>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                <Link href={item.href as never} className="home-agenda-item" data-kind={item.kind}>
                  <i aria-hidden="true" />
                  <span className="home-agenda-copy">
                    <strong>{item.title}</strong>
                    <small>{item.where}</small>
                  </span>
                  <span className="home-agenda-detail">{item.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function isToday(at: Date) {
  return at.toDateString() === new Date().toDateString();
}

function dayWord(at: Date) {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (isToday(at)) return "Today";
  if (at.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return at.toLocaleDateString("en-GH", { weekday: "short", month: "short" });
}

/** The conversations waiting in the inbox, opened over the page. */
function EnquiriesGlance({ enquiries, unread }: { enquiries: Enquiry[]; unread: number }) {
  const latest = [...enquiries]
    .sort((left, right) => (right.last_message_at ?? right.created_at).localeCompare(left.last_message_at ?? left.created_at))
    .slice(0, 3);
  return (
    <section className="home-panel home-enquiries" aria-labelledby="home-enquiries-title">
      <div className="home-widget-head">
        <h2 id="home-enquiries-title">Enquiries</h2>
        <button type="button" className="home-widget-link" aria-haspopup="dialog" onClick={() => openEnquiries({ side: "seller" })}>
          {unread ? `${unread} unread` : "Open inbox"}
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <ul className="home-enquiry-list">
        {latest.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="home-enquiry"
              data-unread={row.unread || undefined}
              aria-haspopup="dialog"
              onClick={() => openEnquiries({ id: row.id, side: "seller" })}
            >
              <span className="home-enquiry-avatar" aria-hidden="true">{initialsOf(row.buyer_name)}</span>
              <span className="home-enquiry-copy">
                <strong>{row.buyer_name}</strong>
                <small>{row.last_message || row.sale.headline}</small>
              </span>
              <span className="home-enquiry-when">{row.last_message_at ? shortDate(row.last_message_at) : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PropertyHighlight({ property, others }: { property: Property; others: Property[] }) {
  const occupied = property.occupied_unit_count;
  const total = property.unit_count;
  const occupancy = total ? Math.round((occupied / total) * 100) : 0;
  const location = [property.address?.locality_name, property.address?.region_name]
    .filter(Boolean)
    .join(", ");

  return (
    <section className="home-property-card" aria-labelledby="home-property-title">
      <Link href={`/properties/${property.id}` as never} className="home-property-media" aria-label={`Open ${property.title}`}>
        {property.cover_url ? (
          // The Property serializer returns a ready-to-display signed photo URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={property.cover_url} alt="" />
        ) : (
          <span className="home-property-drawing" aria-hidden="true"><i /><i /><i /></span>
        )}
        <span className="home-property-tag">Largest Property</span>
        <span className="home-property-over">
          <strong id="home-property-title">{property.title}</strong>
          <small>{location || "Location not added"} · {total} {plural(total, "Unit", "Units")}</small>
        </span>
      </Link>
      <div className="home-property-body">
        <div className="home-property-occupancy">
          <span><i style={{ "--fill": `${occupancy}%` } as React.CSSProperties} /></span>
          <strong>{occupancy}%</strong>
        </div>
        <p>{occupied} occupied · {property.vacant_unit_count} vacant</p>
      </div>
      {others.length ? (
        <ul className="home-property-others">
          {others.map((row) => {
            const share = row.unit_count ? Math.round((row.occupied_unit_count / row.unit_count) * 100) : 0;
            return (
              <li key={row.id}>
                <Link href={`/properties/${row.id}` as never}>
                  <span className="home-property-mini" aria-hidden="true">{initialsOf(row.title)}</span>
                  <span className="home-property-mini-copy">
                    <strong>{row.title}</strong>
                    <small>{row.unit_count} {plural(row.unit_count, "Unit", "Units")}</small>
                  </span>
                  <span className="home-property-mini-meter" aria-label={`${share}% occupied`}>
                    <i style={{ "--fill": `${share}%` } as React.CSSProperties} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Link href="/properties" className="home-property-foot">
        <span>All Properties</span>
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

function OccupancyRing({ value, occupied, total }: { value: number; occupied: number; total: number }) {
  const clamped = Math.max(0, Math.min(value, 100));
  const circumference = 2 * Math.PI * 72;
  const offset = circumference * (1 - clamped / 100);
  return (
    <div className="home-ring" role="img" aria-label={`${clamped}% occupancy, ${occupied} of ${total} Units occupied`}>
      <svg viewBox="0 0 172 172" aria-hidden="true">
        <defs>
          <linearGradient id="home-ring-stroke" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-kola-600)" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--color-kola-600) 55%, var(--color-gold-500))" />
          </linearGradient>
        </defs>
        <circle className="home-ring-track" cx="86" cy="86" r="72" />
        <circle
          className="home-ring-progress"
          cx="86"
          cy="86"
          r="72"
          pathLength="1"
          transform="rotate(-90 86 86)"
          style={{ "--ring-offset": offset / circumference } as React.CSSProperties}
        />
        {/* The outer register. It reads as an instrument rather than a
            progress bar, which is the difference between measuring a portfolio
            and filling a bar. */}
        <circle className="home-ring-ticks" cx="86" cy="86" r="72" pathLength="1" />
        {/* A caliper mark at exactly the value, drawn on hover. It is the one
            thing a dial does that a bar cannot: point at a reading. */}
        <line
          className="home-ring-mark"
          x1="86"
          y1="-3"
          x2="86"
          y2="7"
          transform={`rotate(${clamped * 3.6} 86 86)`}
        />
      </svg>
      <span className="home-ring-figure">
        <strong><CountUp value={clamped} />%</strong>
        <small>occupied</small>
      </span>
      {/* The count the percentage stands in for, added beneath rather than
          swapped in. Absolutely placed, so the reading above it does not move
          and nothing on the card reflows under the cursor. */}
      <span className="home-ring-note" aria-hidden="true">
        {occupied} of {total} {plural(total, "Unit", "Units")}
      </span>
    </div>
  );
}

function ProviderDashboardSkeleton({ name }: { name: string }) {
  return (
    <div className="home-dashboard-skeleton" aria-busy="true" aria-label="Loading your Portfolio">
      <div className="home-hero is-loading">
        <div className="home-hero-head">
          <p className="home-eyebrow">Portfolio</p>
          <h1>{name}</h1>
          <span className="home-skeleton-line" />
        </div>
        <div className="home-pulse">
          <span className="home-skeleton-ring" />
          <div className="home-skeleton-metrics">{[0, 1, 2, 3].map((index) => <span key={index} />)}</div>
        </div>
      </div>
      <div className="home-stage">
        <div className="home-main"><div className="home-skeleton-block is-tall" /><div className="home-skeleton-block" /></div>
        <div className="home-side"><div className="home-skeleton-block" /><div className="home-skeleton-block" /></div>
      </div>
    </div>
  );
}

function PulseMetric({ label, value, href, icon, tone }: { label: string; value: number; href: string; icon: IconName; tone?: "vacant" }) {
  return (
    <Link href={href as never} className="home-pulse-metric" data-tone={tone}>
      <span className="home-pulse-icon" aria-hidden="true"><Icon name={icon} /></span>
      <strong><CountUp value={value} /></strong>
      <small>{label}</small>
      <span className="home-pulse-go" aria-hidden="true">→</span>
    </Link>
  );
}

/**
 * A number that arrives rather than appears: counted up once, quickly, from
 * zero to the server's value, and eased to any later value. The final value
 * is what assistive technology reads, and reduced motion shows it at once.
 */
function CountUp({ value, format = (count: number) => count.toLocaleString("en-GH") }: { value: number; format?: (count: number) => string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    let frame = 0;
    const from = 0;
    const started = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setShown(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <>
      <span aria-hidden="true">{format(Math.round(shown))}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

/**
 * A drafted elevation: the one ornamental mark on the tenant's greeting,
 * saying "buildings" without a stock photograph.
 */
function DraftedElevation() {
  return (
    <svg className="home-greeting-mark" viewBox="0 0 150 60" fill="none" aria-hidden="true">
      <path d="M0 58h150M20 58V22l30-16 30 16v36M35 58V32h30v26" stroke="currentColor" strokeWidth="0.8" opacity="0.7" />
      <path d="M92 58V38l28-14 28 14v20" stroke="#9C7A38" strokeWidth="0.8" />
    </svg>
  );
}

/** The reader's own date rather than the server's. */
function todayLabel(): string {
  return new Date().toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "long" });
}

function RecentActivity({
  portfolio,
  leases,
}: {
  portfolio: OrganizationPortfolio | null;
  leases: Lease[];
}) {
  // What happened, where it happened, and what it was worth. Split into three
  // fields rather than one sentence so the amounts form a column the eye can
  // run down — the same reason a ledger is a table and not prose.
  const events: Array<{
    id: string;
    at: string;
    title: string;
    where: string;
    amount: string | null;
    icon: IconName;
    kind: "payment" | "other";
    href: string;
  }> = [
    ...(portfolio?.recent_payments ?? []).map((row) => ({
      id: `payment-${row.id}`,
      at: row.paid_on,
      title: row.status === "confirmed" ? "Payment confirmed" : "Payment recorded",
      where: `${row.property_title} · ${row.unit_label}`,
      amount: formatMoney({ minor: row.amount_minor, currency: row.currency }),
      icon: "payments" as const,
      kind: "payment" as const,
      // The record opens in its sheet on Payments.
      href: `/payments?view=records&record=${row.id}`,
    })),
    ...leases
      .filter((lease) => lease.tenant_accepted_at)
      .map((lease) => ({
        id: `lease-${lease.id}`,
        at: lease.tenant_accepted_at as string,
        title: "Agreement accepted",
        where: `${lease.tenant_name} · ${lease.unit_label}`,
        amount: null,
        icon: "leases" as const,
        kind: "other" as const,
        href: `/leases/${lease.id}`,
      })),
    ...(portfolio?.recent_activity ?? []).map((row) => ({
      id: `activity-${row.id}`,
      at: row.at,
      title: row.title,
      where: row.kind === "property_added" ? "Portfolio" : "Tenancies",
      amount: null,
      icon: (row.kind === "property_added" ? "properties" : "users") as IconName,
      kind: "other" as const,
      href: row.kind === "property_added" ? "/properties" : "/tenants",
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);

  if (events.length === 0) {
    return <p className="home-quiet">Nothing has happened in this Portfolio yet.</p>;
  }

  return (
    <ol className="home-rows home-timeline">
      {events.map((event, index) => (
        <li key={event.id} style={{ "--row": index } as React.CSSProperties}>
          <Link href={event.href as never} className="home-row">
            <span className="home-activity-icon" data-kind={event.kind}><Icon name={event.icon} /></span>
            <span className="home-row-label">
              <strong>{event.title}</strong>
              <span className="home-row-meta">{event.where}</span>
            </span>
            <span className="home-row-go">
              {event.amount ? <strong>{event.amount}</strong> : null}
              <small>{shortDate(event.at)}</small>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function shortDate(value: string) {
  const at = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(at.getTime())
    ? value
    : at.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

const REVIEW_COPY: Record<string, { title: string; body: string }> = {
  not_started: {
    title: "Send one identity document to begin",
    body: "The same review confirms who you are and whether you may operate here, so one document is all we need to start.",
  },
  pending: {
    title: "Your documents are with our review team",
    body: "There is nothing further to send. We will let you know the outcome, and you can check back here any time.",
  },
  needs_more_info: {
    title: "We need something else",
    body: "Open your verification to read what is missing and send it. The review continues as soon as it arrives.",
  },
  rejected: {
    title: "Not approved",
    body: "Read the note on your verification, put it right, and send it again.",
  },
  revoked: {
    title: "Approval withdrawn",
    body: "Read the note on your verification for what happened and what to do next.",
  },
  expired: {
    title: "Your approval has expired",
    body: "Send a current document to renew it.",
  },
};

/* --- shared -------------------------------------------------------------- */

function greeting(me: Me): string {
  const name = me.preferred_name?.trim() || me.first_name?.trim();
  return name ? `Good day, ${name}` : "Good day";
}
