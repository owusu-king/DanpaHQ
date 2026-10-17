"use client";

/**
 * The complete application record, shared by the deep-link page and the sheet
 * the list opens it in. Lifecycle meaning and mutations stay here so the two
 * presentations can never drift.
 *
 * Drawn in the same vocabulary as a provider's tenancy request (request-sheet
 * .css): a tinted hero that says where it stands, then the journey, the terms
 * offered, and what the tenant told the landlord behind one disclosure. The
 * two sides read one application; they should recognise each other's page.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon, type IconName } from "@/components/portal/icons";
import { useToast } from "@/components/toast/Toaster";
import { ModalSheet } from "@/components/workspace/ModalSheet";
import { applicationBucket, standing, timeline, type LeaseLink } from "@/lib/applicationMeaning";
import { ApiFailure } from "@/lib/api";
import { type Lease } from "@/lib/console";
import { withdrawMyApplication, type MyApplication } from "@/lib/tenant";
import { onDate } from "@/lib/time";

/**
 * How an application is coloured, on the row and in the record. Presentation
 * only: it reads the bucket and the journey the meaning module already decided,
 * so a refusal is told apart from an ended tenancy without a second opinion.
 */
export type ApplicationTone = "action" | "waiting" | "good" | "stopped" | "muted";

export function applicationTone(application: MyApplication, leases: readonly LeaseLink[]): ApplicationTone {
  const bucket = applicationBucket(application, leases);
  if (bucket === "action") return "action";
  if (bucket === "open") return "waiting";
  if (bucket === "approved") return "good";
  // Their own withdrawal is not a refusal, so it is not drawn as one.
  if (application.status === "withdrawn") return "muted";
  return timeline(application, leases).at(-1)?.state === "stopped" ? "stopped" : "muted";
}

/**
 * The record over the list. A plain click on a row opens it, held in the
 * page's state rather than the address. The last application shown is held so
 * the sheet can play its exit after the page has let it go.
 */
export function ApplicationSheet({
  application,
  leases,
  onClose,
  onChanged,
}: {
  application: MyApplication | null;
  leases: Lease[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [shown, setShown] = useState<MyApplication | null>(application);
  // Adjusted while rendering rather than in an effect, so a reload shows the
  // new state in the same frame and a close keeps the old one for the exit.
  if (application && application !== shown) setShown(application);
  const current = application ?? shown;
  if (!current) return null;

  return (
    <ModalSheet
      open={Boolean(application)}
      onClose={onClose}
      size="sm"
      icon="applications"
      title="Your application"
      meta={`Sent ${onDate(current.created_at)}`}
      className="request-sheet application-sheet"
      closeLabel="Close application"
    >
      {(close) => (
        <ApplicationRecord
          key={current.id}
          application={current}
          leases={leases}
          onChanged={onChanged}
          onWithdrawn={close}
        />
      )}
    </ModalSheet>
  );
}

export function ApplicationRecord({
  application,
  leases,
  onChanged,
  onWithdrawn,
}: {
  application: MyApplication;
  leases: Lease[];
  onChanged: () => Promise<void>;
  /** Inside the sheet: leave it. On the record's own page: back to the list. */
  onWithdrawn?: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmRef = useRef<HTMLElement>(null);

  // The question is asked where the answer is given, not off the bottom of the sheet.
  useEffect(() => {
    if (confirming) confirmRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [confirming]);

  const state = standing(application, leases);
  const tone = applicationTone(application, leases);
  const journey = timeline(application, leases);
  const open = ["submitted", "under_review"].includes(application.status);
  const asked = application.advance_months_asked;
  const offered = application.advance_months_offered;
  const cells = Math.max(asked, offered, 1);
  const short = Math.max(0, asked - offered);
  const property = application.property_title || application.listing_headline;
  const place = [application.unit_label, application.space_type_label, application.locality_name].filter(Boolean).join(" · ");
  const agreementHref = (state.leaseId ? `/record/lease?leaseId=${state.leaseId}` : "/leases") as never;

  async function withdraw() {
    setBusy(true);
    setError("");
    try {
      await withdrawMyApplication(application.id, "No longer needed");
      await onChanged();
      toast({ tone: "success", title: "Application withdrawn", description: `${property} is now in your history.` });
      if (onWithdrawn) onWithdrawn();
      else router.push("/applications");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not withdraw this application.");
      setBusy(false);
    }
  }

  return (
    <div className="rq ap" aria-busy={busy || undefined}>
      <section className="rq-hero ap-hero" data-tone={tone} aria-label="Where it stands">
        <div className="ap-place">
          <span className="ap-photo" aria-hidden="true">
            {application.photo_url ? (
              /* Short-lived signed URLs from the files service. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={application.photo_url} alt="" />
            ) : <Icon name="properties" />}
          </span>
          <span className="ap-place-copy">
            <h2>{property}</h2>
            {place ? <small>{place}</small> : null}
            {application.rent_formatted ? <span className="ap-rent">{application.rent_formatted}<small> / month</small></span> : null}
          </span>
          <Link className="rq-place-link" href={`/record/listing?id=${application.listing_id}` as never} aria-label="View listing" title="View listing">
            <Icon name="share" />
          </Link>
        </div>
        <p className={`ap-standing is-${tone}`}>
          <i aria-hidden="true" />
          <strong>{state.line}</strong>
          <span>
            <time dateTime={application.created_at}>Applied {onDate(application.created_at)}</time>
            {application.decided_at ? <> · <time dateTime={application.decided_at}>Answered {onDate(application.decided_at)}</time></> : null}
          </span>
        </p>
      </section>

      <section className="ap-journey" aria-label="Progress">
        <ol className="application-timeline">
          {journey.map((step) => (
            <li key={step.id} data-state={step.state}>
              <span className="application-timeline-mark" aria-hidden="true">
                {step.state === "done" ? <Icon name="check" /> : step.state === "stopped" ? <Icon name="close" /> : null}
              </span>
              <span className="application-timeline-text">
                <strong>{step.label}</strong>
                {step.when ? <small>{onDate(step.when)}</small> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {application.decision_note ? (
        <p className="rq-decision-note"><Icon name="chat" /><span><small>From the landlord</small>{application.decision_note}</span></p>
      ) : null}

      <section className={`rq-advance${short ? " is-short" : " is-match"}`} aria-label="Advance offered">
        <div className="rq-advance-head">
          <strong>{offered} of {asked} month{asked === 1 ? "" : "s"} advance</strong>
          <span>{short ? `${short} month${short === 1 ? "" : "s"} short of their ask` : "Meets their ask"}</span>
        </div>
        <span className="rq-advance-bar" aria-hidden="true">
          {Array.from({ length: cells }).map((_, index) => (
            <i key={index} data-on={index < offered ? "" : undefined} data-asked={index < asked ? "" : undefined} />
          ))}
        </span>
      </section>

      <dl className="rq-facts ap-facts">
        <Fact icon="clock" label="Move in" value={application.move_in_from ? onDate(application.move_in_from) : "Not stated"} />
        <Fact icon="users" label="Household" value={application.household_size ? `${application.household_size} ${application.household_size === 1 ? "person" : "people"}` : "Not stated"} />
      </dl>

      <details className="ap-told">
        <summary>
          <Icon name="info" />
          <span>What you told them</span>
          <Icon name="chevron-down" />
        </summary>
        <div className="ap-told-body">
          <dl className="rq-facts">
            <Fact icon="account" label="Occupation" value={application.occupation || "Not stated"} />
            <Fact icon="portfolio" label="Employer" value={application.employer || "Not stated"} />
          </dl>
          <div className="rq-guarantor">
            <span className="rq-guarantor-mark" aria-hidden="true"><Icon name="shield" /></span>
            <span className="rq-guarantor-copy">
              <small>Guarantor</small>
              <strong>{application.guarantor_name || "None given"}</strong>
              {application.guarantor_relationship ? <span>{application.guarantor_relationship}</span> : null}
            </span>
          </div>
          {application.message ? <blockquote className="rq-message">“{application.message}”</blockquote> : null}
        </div>
      </details>

      {error ? <Notice tone="error" title={error} /> : null}

      {open && confirming ? (
        <section ref={confirmRef} className="rq-confirm application-confirm" role="alert">
          <Icon name="warning" />
          <span>
            <strong>Withdraw? This cannot be undone.</strong>
            <small>The landlord stops considering it, and you would need to apply again.</small>
          </span>
        </section>
      ) : null}

      {/* The listing is one press away in the hero, so the foot holds only what
          moves the application on — and is absent when nothing can. */}
      {open || state.leaseId ? (
        <div className="rq-actions">
          {open && confirming ? (
            <>
              <Button variant="destructive" busy={busy} busyLabel="Withdrawing…" onClick={() => void withdraw()}>Yes, withdraw</Button>
              <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>Keep it</Button>
            </>
          ) : (
            <>
              {state.stage === "action" ? (
                <Link href={agreementHref} className="btn btn-primary"><Icon name="leases" />Review agreement</Link>
              ) : state.leaseId ? (
                <Link href={agreementHref} className="btn btn-secondary"><Icon name="leases" />Open agreement</Link>
              ) : null}
              {open ? (
                <>
                  <span className="rq-actions-spacer" />
                  <Button variant="quiet" className="ap-withdraw" onClick={() => setConfirming(true)}>Withdraw</Button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Fact({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="rq-fact">
      <dt><Icon name={icon} />{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
