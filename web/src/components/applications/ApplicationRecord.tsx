"use client";

/**
 * The complete application record, shared by the deep-link page and the
 * tenant's in-context modal. Lifecycle meaning and mutations stay here so the
 * two presentations can never drift.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Icon } from "@/components/portal/icons";
import { standing, timeline } from "@/lib/applicationMeaning";
import { ApiFailure } from "@/lib/api";
import { type Lease } from "@/lib/console";
import { withdrawMyApplication, type MyApplication } from "@/lib/tenant";
import { onDate } from "@/lib/time";

type ApplicationRecordProps = {
  application: MyApplication;
  leases: Lease[];
  onChanged: () => Promise<void>;
  titleId?: string;
  onWithdrawn?: () => void;
  onBusyChange?: (busy: boolean) => void;
};

export function ApplicationDetailModal({
  application,
  leases,
  onChanged,
  onClose,
}: {
  application: MyApplication;
  leases: Lease[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeTimer = useRef<number | null>(null);
  const closing = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    const sizeFrame = window.requestAnimationFrame(() => {
      if (!dialog) return;
      // Lock the natural opening height once. Disclosures may add scrollable
      // content, but never resize or re-centre the glass surface.
      dialog.style.setProperty("--application-modal-height", `${Math.ceil(dialog.offsetHeight)}px`);
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(sizeFrame);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (dialog?.open) dialog.close();
      opener?.focus({ preventScroll: true });
    };
  }, []);

  const requestClose = useCallback((force = false) => {
    const dialog = dialogRef.current;
    if (!dialog || closing.current || (recordBusy && !force)) return;
    closing.current = true;
    setLeaving(true);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      return;
    }
    closeTimer.current = window.setTimeout(() => dialog.close(), 160);
  }, [recordBusy]);

  return (
    <dialog
      ref={dialogRef}
      className={`application-modal${leaving ? " is-leaving" : ""}`}
      aria-labelledby="application-modal-title"
      aria-busy={recordBusy}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
    >
      <div className="application-modal-surface">
        <button
          type="button"
          className="application-modal-close"
          aria-label="Close application details"
          disabled={recordBusy}
          onClick={() => requestClose()}
        >
          <Icon name="close" />
        </button>
        <ApplicationRecord
          application={application}
          leases={leases}
          onChanged={onChanged}
          titleId="application-modal-title"
          onBusyChange={setRecordBusy}
          onWithdrawn={() => requestClose(true)}
          headingRef={headingRef}
        />
      </div>
    </dialog>
  );
}

export function ApplicationRecord({
  application,
  leases,
  onChanged,
  titleId,
  onWithdrawn,
  onBusyChange,
  headingRef,
}: ApplicationRecordProps & { headingRef?: React.RefObject<HTMLHeadingElement | null> }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bodyScrolled, setBodyScrolled] = useState(false);

  useEffect(() => {
    setConfirming(false);
    setError("");
    setBodyScrolled(false);
  }, [application.id]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const state = standing(application, leases);
  const journey = timeline(application, leases);
  const open = ["submitted", "under_review"].includes(application.status);
  const asked = application.advance_months_asked;
  const offered = application.advance_months_offered;
  const property = application.property_title || application.listing_headline;
  const context = [application.unit_label, application.space_type_label, application.locality_name]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="application-detail" data-body-scrolled={bodyScrolled || undefined}>
      <header className="application-detail-head">
        <div className="application-detail-status">
          <span className={`application-detail-state is-${state.stage}`}>
            <i aria-hidden="true" />
            <span>
              <small>Application status</small>
              <strong>{state.line}</strong>
            </span>
          </span>
          <span className="application-detail-dates">
            <Icon name="clock" />
            <span>
              <time dateTime={application.created_at}>Applied {onDate(application.created_at)}</time>
              {application.decided_at ? <time dateTime={application.decided_at}>Answered {onDate(application.decided_at)}</time> : null}
            </span>
          </span>
        </div>

        <div className="application-detail-property">
          <span className="application-detail-photo">
            {application.photo_url ? (
              /* Short-lived signed URLs from the files service. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={application.photo_url} alt="" />
            ) : (
              <span className="application-detail-photo-fallback" aria-hidden="true"><Icon name="properties" /></span>
            )}
          </span>
          <span className="application-detail-property-copy">
            <small>Property &amp; Unit</small>
            <h2 id={titleId} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{property}</h2>
            {context ? <p><Icon name="landmark" />{context}</p> : null}
          </span>
        </div>
      </header>

      <div
        className="application-detail-body"
        onScroll={(event) => setBodyScrolled(event.currentTarget.scrollTop > 2)}
      >
        <section className="application-detail-section is-progress" aria-labelledby={`application-progress-${application.id}`}>
          <header className="application-detail-section-head">
            <Icon name="applications" />
            <h3 id={`application-progress-${application.id}`}>Progress</h3>
            <span>{journey.length} stages</span>
          </header>
          <ol className="application-timeline">
            {journey.map((step) => (
              <li key={step.id} data-state={step.state}>
                <span className="application-timeline-mark" aria-hidden="true" />
                <span className="application-timeline-text">
                  <strong>{step.label}</strong>
                  {step.when ? <small>{onDate(step.when)}</small> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="application-detail-main">
          {application.decision_note ? (
            <blockquote className="application-note">
              <small>From the landlord</small>
              <p>{application.decision_note}</p>
            </blockquote>
          ) : null}

          <section className="application-detail-section is-terms" aria-labelledby={`application-terms-${application.id}`}>
            <header className="application-detail-section-head">
              <Icon name="details" />
              <h3 id={`application-terms-${application.id}`}>Rental terms</h3>
            </header>
            <dl className="application-facts">
              <div>
                <dt>Advance offered</dt>
                <dd>{offered} month{offered === 1 ? "" : "s"}{offered === asked ? "" : ` of ${asked}`}</dd>
              </div>
              <div><dt>Monthly rent</dt><dd>{application.rent_formatted ?? "—"}</dd></div>
              <div><dt>Move in from</dt><dd>{application.move_in_from ? onDate(application.move_in_from) : "Not stated"}</dd></div>
              <div><dt>Household</dt><dd>{application.household_size ? `${application.household_size} people` : "Not stated"}</dd></div>
            </dl>
          </section>

          <details className="application-told">
            <summary>
              <span><Icon name="info" />What you told them</span>
              <Icon name="chevron-down" />
            </summary>
            <div className="application-told-body">
              <dl className="application-facts">
                <div><dt>Occupation</dt><dd>{application.occupation || "Not stated"}</dd></div>
                <div><dt>Employer</dt><dd>{application.employer || "Not stated"}</dd></div>
                <div>
                  <dt>Guarantor</dt>
                  <dd>
                    {application.guarantor_name
                      ? `${application.guarantor_name}${application.guarantor_relationship ? ` · ${application.guarantor_relationship}` : ""}`
                      : "None given"}
                  </dd>
                </div>
              </dl>
              {application.message ? <blockquote>{application.message}</blockquote> : null}
            </div>
          </details>

          {error ? <Notice tone="error" title={error} /> : null}
        </div>
      </div>

      <footer className="application-detail-foot">
        <div className="application-detail-context-actions">
          {state.stage === "action" ? (
            <Link
              href={(state.leaseId ? `/leases/${state.leaseId}` : "/leases") as never}
              className="application-primary"
            >
              Review agreement
            </Link>
          ) : null}
          <Link href={`/listings/${application.listing_id}`} className="application-secondary">
            View listing
          </Link>
        </div>
        {open ? (
          confirming ? (
            <span className="application-confirm">
              <span className="type-caption">Withdraw? This cannot be undone.</span>
              <Button
                variant="destructive"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await withdrawMyApplication(application.id, "No longer needed");
                    await onChanged();
                    if (onWithdrawn) onWithdrawn();
                    else router.push("/applications");
                  } catch (cause) {
                    setError(cause instanceof ApiFailure ? cause.error.message : "Could not withdraw this application.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >Yes, withdraw</Button>
              <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>Keep it</Button>
            </span>
          ) : (
            <Button variant="quiet" onClick={() => setConfirming(true)}>Withdraw</Button>
          )
        ) : null}
      </footer>
    </article>
  );
}