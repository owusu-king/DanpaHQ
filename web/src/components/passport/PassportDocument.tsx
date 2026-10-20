"use client";

import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/portal/icons";
import {
  dayMonthYear,
  duration,
  monthYear,
  NOT_RECORDED_LABEL,
  period,
  placeLine,
  STATUS_LABEL,
  STATUS_MEANING,
  tenancyPeriod,
  tenancyStanding,
  type IdentityCredential,
  type PassportPayments,
  type PassportReview,
  type PassportStatus,
  type PassportTenancy,
  type PassportView,
  type TimelineEvent,
} from "@/lib/passport";

/**
 * The Housing Passport as a document, drawn the same way for its owner, in the
 * share preview and for the recipient — so the preview is not a likeness of
 * what they will see, it is the same thing. Styles in `passport.css`.
 *
 * Two rules hold everywhere below. Every status says how it is known (the
 * `basis` line, written by the backend), never just a word; and nothing the
 * record does not contain is drawn as a gap or a zero against anyone.
 */

type Audience = "owner" | "recipient";

// --- the cover ---------------------------------------------------------------------

export function PassportCover({
  view,
  audience,
  footer,
}: {
  view: PassportView;
  audience: Audience;
  /** The recipient's line: who it was prepared for and until when. */
  footer?: ReactNode;
}) {
  const { holder, summary, sections } = view;
  const span = period(summary.period.from, summary.period.to, summary.period.ongoing);
  const identity = view.identity?.credentials.find((row) => row.key === "identity") ?? null;

  return (
    <section className="passport-cover" aria-label={`Housing Passport of ${holder.name}`}>
      <span className="passport-cover-guilloche" aria-hidden="true">
        <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" focusable="false">
          {Array.from({ length: 9 }).map((_, index) => (
            <ellipse key={index} cx="330" cy="40" rx={60 + index * 26} ry={34 + index * 15} />
          ))}
        </svg>
      </span>

      <div className="passport-cover-top">
        <span className="passport-wordmark">
          <Icon name="passport" />
          <span>Danpa HQ <em>Housing Passport</em></span>
        </span>
        <span className="passport-cover-mode">
          <Icon name={audience === "owner" ? "lock" : "eye"} />
          {audience === "owner" ? "Private to you" : "Read-only"}
        </span>
      </div>

      <div className="passport-holder">
        <span className="passport-monogram" aria-hidden="true">{holder.initials}</span>
        <div className="passport-holder-text">
          <h2>{holder.name}</h2>
          <p>
            {identity ? (
              <span className={`passport-holder-id is-${identity.status}`}>
                <Icon name={identity.status === "verified" ? "verification" : identity.status === "pending" ? "clock" : "info"} />
                {identity.status === "verified" ? "Identity verified" : identity.status === "pending" ? "Identity check pending" : identity.status === "expired" ? "Identity check expired" : "Identity not verified"}
              </span>
            ) : null}
            <span>On Danpa HQ since {monthYear(holder.member_since)}</span>
          </p>
        </div>
      </div>

      <dl className="passport-figures">
        <div>
          <dt>Tenancies</dt>
          <dd>{summary.tenancies}{summary.current ? <small>{summary.current} current</small> : null}</dd>
        </div>
        <div>
          <dt>On record</dt>
          <dd>{summary.tenancies ? duration(summary.months) : "—"}{span ? <small>{span}</small> : null}</dd>
        </div>
        {sections.payments ? (
          <div>
            <dt>Rent confirmed</dt>
            <dd>
              {summary.payments_confirmed ?? 0}
              <small>{summary.payments_confirmed ? `${summary.payments_on_time ?? 0} on time` : "payments"}</small>
            </dd>
          </div>
        ) : null}
      </dl>

      {footer ? <div className="passport-cover-foot">{footer}</div> : null}
    </section>
  );
}

// --- status ----------------------------------------------------------------------------

const STATUS_GLYPH: Record<PassportStatus, IconName> = {
  verified: "verification",
  confirmed: "check",
  pending: "clock",
  disputed: "warning",
  unverified: "info",
  expired: "warning",
  none: "info",
};

export function StatusMark({ status, compact = false }: { status: PassportStatus; compact?: boolean }) {
  return (
    <span className={`passport-status is-${status}${compact ? " is-compact" : ""}`}>
      <Icon name={STATUS_GLYPH[status]} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function ReviewNote({ review }: { review: PassportReview }) {
  if (!review) return null;
  return (
    <p className="passport-review" role="note">
      <Icon name="warning" />
      <span>{review.note} <em>Under review since {dayMonthYear(review.since)}.</em></span>
    </p>
  );
}

// --- identity -------------------------------------------------------------------------------

const IDENTITY_GLYPH: Record<IdentityCredential["key"], IconName> = {
  identity: "verification",
  selfie_match: "account",
  phone: "handset",
  email: "chat",
};

export function IdentitySection({
  identity,
  action,
}: {
  identity: NonNullable<PassportView["identity"]>;
  action?: ReactNode;
}) {
  return (
    <section className="passport-section" aria-labelledby="passport-identity">
      <header className="passport-section-head">
        <h3 id="passport-identity">Identity checks</h3>
        {action}
      </header>
      <ReviewNote review={identity.review} />
      <ul className="passport-identity">
        {identity.credentials.map((row) => (
          <li key={row.key}>
            <span className={`passport-glyph is-${row.status}`} aria-hidden="true"><Icon name={IDENTITY_GLYPH[row.key]} /></span>
            <span className="passport-identity-text">
              <strong>{row.title}</strong>
              <span>{row.basis}{row.as_of ? ` · ${dayMonthYear(row.as_of)}` : ""}</span>
              {row.valid_until ? <small>Valid until {dayMonthYear(row.valid_until)}</small> : null}
            </span>
            <StatusMark status={row.status} compact />
          </li>
        ))}
      </ul>
      <p className="passport-fineprint">Document numbers, phone numbers and email addresses are never shown.</p>
    </section>
  );
}

// --- tenancies ---------------------------------------------------------------------------------

export function TenancyRecord({
  tenancy,
  order = 0,
  action,
}: {
  tenancy: PassportTenancy;
  order?: number;
  action?: ReactNode;
}) {
  const where = placeLine(tenancy);
  return (
    <article
      className={`passport-tenancy is-${tenancy.status}`}
      style={{ "--passport-order": order } as React.CSSProperties}
      aria-labelledby={`tenancy-${tenancy.id}`}
    >
      <header className="passport-tenancy-head">
        <span className="passport-place-mark" aria-hidden="true"><Icon name="home" /></span>
        <div className="passport-tenancy-title">
          <h4 id={`tenancy-${tenancy.id}`}>
            {tenancy.place.title}
            {tenancy.place.space ? <span> · {tenancy.place.space}</span> : null}
          </h4>
          <p>{[tenancy.place.space_type, where].filter(Boolean).join(" · ")}</p>
        </div>
        <span className={`passport-standing is-${tenancy.status}`}>{tenancyStanding(tenancy)}</span>
      </header>

      <ReviewNote review={tenancy.review} />

      <dl className="passport-facts">
        <div>
          <dt>Period</dt>
          <dd>
            {tenancyPeriod(tenancy)}
            {tenancy.months ? <small>{duration(tenancy.months)}{tenancy.agreed_until ? ` · agreed to ${monthYear(tenancy.agreed_until)}` : ""}</small> : null}
          </dd>
        </div>
        <div>
          <dt>Agreement</dt>
          <dd>
            <StatusMark status={tenancy.credential.status} compact />
            <small>
              {tenancy.credential.basis}
              {tenancy.credential.as_of ? ` · ${dayMonthYear(tenancy.credential.as_of)}` : ""}
              {tenancy.agreements > 1 ? ` · ${tenancy.agreements - 1} renewal${tenancy.agreements > 2 ? "s" : ""}` : ""}
            </small>
          </dd>
        </div>
        <div>
          <dt>Property</dt>
          <dd>
            {tenancy.property.verified ? (
              <span className="passport-inline-mark is-verified"><Icon name="verification" />Verified by Danpa HQ</span>
            ) : (
              <span className="passport-inline-mark">Not verified by Danpa HQ</span>
            )}
            {tenancy.property.as_of ? <small>Checked {dayMonthYear(tenancy.property.as_of)}</small> : null}
          </dd>
        </div>
        {tenancy.rent ? (
          <div>
            <dt>Rent</dt>
            <dd className="passport-amount">{tenancy.rent.formatted}<small>per {tenancy.rent.period === "monthly" ? "month" : tenancy.rent.period.replace(/ly$/, "")}</small></dd>
          </div>
        ) : null}
      </dl>

      {tenancy.payments ? <PaymentRecord payments={tenancy.payments} /> : null}
      {action ? <footer className="passport-tenancy-foot">{action}</footer> : null}
    </article>
  );
}

function PaymentRecord({ payments }: { payments: PassportPayments }) {
  if (payments.status === "none" && !payments.review) {
    return (
      <div className="passport-payments is-empty">
        <Icon name="payments" />
        <span>{payments.basis}</span>
      </div>
    );
  }
  const settled = payments.on_time + payments.late + payments.overdue;
  const bar = settled
    ? [
        { key: "on-time", value: payments.on_time, label: "on time" },
        { key: "late", value: payments.late, label: "late" },
        { key: "overdue", value: payments.overdue, label: "overdue now" },
      ].filter((part) => part.value > 0)
    : [];

  return (
    <div className="passport-payments">
      <div className="passport-payments-head">
        <span className="passport-payments-title"><Icon name="payments" />Rent payments</span>
        <StatusMark status={payments.status} compact />
      </div>
      <ReviewNote review={payments.review} />
      <p className="passport-payments-basis">{payments.basis}</p>

      {bar.length ? (
        <div
          className="passport-bar"
          role="img"
          aria-label={bar.map((part) => `${part.value} ${part.label}`).join(", ")}
        >
          {bar.map((part) => (
            <span key={part.key} className={`is-${part.key}`} style={{ flexGrow: part.value }} />
          ))}
        </div>
      ) : null}

      <ul className="passport-counts">
        <li><strong>{payments.confirmed}</strong> confirmed</li>
        {settled ? <li className="is-on-time"><strong>{payments.on_time}</strong> on time</li> : null}
        {payments.late ? <li className="is-late"><strong>{payments.late}</strong> late</li> : null}
        {payments.overdue ? <li className="is-overdue"><strong>{payments.overdue}</strong> overdue now</li> : null}
        {payments.awaiting ? <li className="is-pending"><strong>{payments.awaiting}</strong> awaiting confirmation</li> : null}
        {payments.disputed ? <li className="is-disputed"><strong>{payments.disputed}</strong> disputed</li> : null}
      </ul>
      {payments.total_formatted || payments.last_paid_on ? (
        <p className="passport-payments-foot">
          {payments.total_formatted ? <span className="passport-amount">{payments.total_formatted} confirmed</span> : null}
          {payments.last_paid_on ? <span>Last confirmed payment {dayMonthYear(payments.last_paid_on)}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

// --- timeline ---------------------------------------------------------------------------------------

const TIMELINE_GLYPH: Record<TimelineEvent["kind"], IconName> = {
  joined: "account",
  identity: "verification",
  agreement: "leases",
  moved_in: "home",
  upcoming: "clock",
  ended: "archive",
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <section className="passport-section passport-timeline-section" aria-labelledby="passport-timeline">
      <header className="passport-section-head"><h3 id="passport-timeline">Timeline</h3></header>
      <ol className="passport-timeline">
        {events.map((event, index) => (
          <li key={`${event.kind}-${event.on}-${index}`} className={`is-${event.kind}`}>
            <span className="passport-timeline-dot" aria-hidden="true"><Icon name={TIMELINE_GLYPH[event.kind]} /></span>
            <span className="passport-timeline-text">
              <strong>{event.title}</strong>
              {event.detail ? <span>{event.detail}</span> : null}
            </span>
            <time dateTime={event.on}>{dayMonthYear(event.on)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

// --- reading it -----------------------------------------------------------------------------------------

export function StatusLegend() {
  return (
    <section className="passport-section passport-legend" aria-labelledby="passport-legend">
      <header className="passport-section-head"><h3 id="passport-legend">How to read this</h3></header>
      <ul>
        {STATUS_MEANING.map((row) => (
          <li key={row.status}><StatusMark status={row.status} compact /><span>{row.meaning}</span></li>
        ))}
      </ul>
    </section>
  );
}

export function NotRecorded({ view, audience }: { view: PassportView; audience: Audience }) {
  if (!view.not_recorded.length) return null;
  const things = view.not_recorded.map((key) => NOT_RECORDED_LABEL[key] ?? key);
  const list = things.length > 1 ? `${things.slice(0, -1).join(", ")} or ${things.at(-1)}` : things[0];
  const first = view.holder.name.split(" ")[0];
  return (
    <p className="passport-not-recorded">
      <Icon name="info" />
      <span>
        Danpa HQ doesn’t record {list} yet, so {audience === "owner" ? "their absence here says nothing about you" : `their absence says nothing about ${first}`}.
        {" "}History from before Danpa HQ isn’t shown either.
      </span>
    </p>
  );
}

/** The whole document, for the preview and the recipient. */
export function PassportDocument({
  view,
  audience,
  coverFooter,
}: {
  view: PassportView;
  audience: Audience;
  coverFooter?: ReactNode;
}) {
  return (
    <div className="passport-document">
      <PassportCover view={view} audience={audience} footer={coverFooter} />
      {view.tenancies.length ? (
        <section className="passport-section" aria-labelledby="passport-record">
          <header className="passport-section-head">
            <h3 id="passport-record">Housing record</h3>
            <span className="passport-section-count">{view.tenancies.length}</span>
          </header>
          <div className="passport-tenancies">
            {view.tenancies.map((tenancy, index) => <TenancyRecord key={tenancy.id} tenancy={tenancy} order={index} />)}
          </div>
        </section>
      ) : null}
      {view.identity ? <IdentitySection identity={view.identity} /> : null}
      {view.timeline.length > 1 ? <Timeline events={view.timeline} /> : null}
      <StatusLegend />
      <NotRecorded view={view} audience={audience} />
    </div>
  );
}
