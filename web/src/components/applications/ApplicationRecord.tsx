"use client";

/**
 * One application this person sent, in full.
 *
 * It was the right-hand pane of a split view, and the pane was a deliberate
 * choice at the time: *"an application record is a thing somebody reads against
 * the other applications they have out."* That reading holds, and the list is
 * where it happens \u2014 every row already carries `standing()`, which is the one
 * line that says where an application stands. What the record adds is the
 * detail behind one of them: the timeline, what was offered, what was told to
 * the landlord, the guarantor, the landlord's note.
 *
 * That is a record, and it now has an address \u2014 which is also what the phone
 * has always given it (`app/(app)/application/[id].tsx`). Parity here is
 * semantic, and web was the odd one out.
 *
 * What the tenant sent, what came back, and the one irreversible thing they can
 * still do. Withdrawing asks first — it cannot be undone, and it frees the Unit
 * to somebody else. It is still `withdrawMyApplication` that does it.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { placeOf, standing, timeline } from "@/lib/applicationMeaning";
import { ApiFailure } from "@/lib/api";
import { type Lease } from "@/lib/console";
import { withdrawMyApplication, type MyApplication } from "@/lib/tenant";
import { onDate } from "@/lib/time";

export function ApplicationRecord({
  application,
  leases,
  onChanged,
}: {
  application: MyApplication;
  leases: Lease[];
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Selecting a different application must not carry the previous one's
  // half-finished withdrawal or its error across.
  useEffect(() => {
    setConfirming(false);
    setError("");
  }, [application.id]);

  const state = standing(application, leases);
  const open = ["submitted", "under_review"].includes(application.status);
  const asked = application.advance_months_asked;
  const offered = application.advance_months_offered;

  return (
    <div className="application-detail">
      <header className="application-detail-head">
        {/* Enough photograph to recognise the place. The row carries one too,
            and somebody arriving here from a list of four needs to know which
            of the four this is before they read a word. */}
        <span className="application-detail-photo">
          {application.photo_url ? (
            /* Short-lived signed URLs from the files service. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={application.photo_url} alt="" />
          ) : null}
        </span>
        <h2>{application.listing_headline}</h2>
        <p className="type-caption">{placeOf(application)}</p>
      </header>

      <div className="application-detail-body">
        <p className={`application-standing is-${state.stage}`}>
          <i aria-hidden="true" />
          {state.line}
          <em>applied {onDate(application.created_at)}{application.decided_at ? ` · answered ${onDate(application.decided_at)}` : ""}</em>
        </p>

        {/* Where it stands is the line above. This is how it got there and
            what is still to come. */}
        <ol className="application-timeline">
          {timeline(application, leases).map((step) => (
            <li key={step.id} data-state={step.state}>
              <span className="application-timeline-mark" aria-hidden="true" />
              <span className="application-timeline-text">
                <strong>{step.label}</strong>
                {step.when ? <small>{onDate(step.when)}</small> : null}
              </span>
            </li>
          ))}
        </ol>

        {/* The landlord's own words, when there are any. */}
        {application.decision_note ? (
          <blockquote className="application-note">{application.decision_note}</blockquote>
        ) : null}

        <dl className="application-facts">
          <div>
            <dt>Advance offered</dt>
            <dd>{offered} month{offered === 1 ? "" : "s"}{offered === asked ? "" : ` of ${asked}`}</dd>
          </div>
          <div><dt>Rent</dt><dd>{application.rent_formatted ?? "—"}</dd></div>
          <div><dt>Move in from</dt><dd>{application.move_in_from ? onDate(application.move_in_from) : "Not stated"}</dd></div>
          <div><dt>Household</dt><dd>{application.household_size ? `${application.household_size} people` : "Not stated"}</dd></div>
        </dl>

        {/* The tenant already knows what they wrote. It is here to be checked,
            not read. */}
        <details className="application-told">
          <summary>What you told them</summary>
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
        </details>

        {error ? <Notice tone="error" title={error} /> : null}
      </div>

      <footer className="application-detail-foot">
        {/* The agreement this became, not every agreement. The application
            already knows which one it is. */}
        {state.stage === "action" ? (
          <Link
            href={(state.leaseId ? `/leases/${state.leaseId}` : "/leases") as never}
            className="application-primary"
          >
            Review agreement
          </Link>
        ) : (
          <Link href={`/listings/${application.listing_id}`} className="application-secondary">
            View the listing
          </Link>
        )}
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
                    router.push("/applications");
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
    </div>
  );
}
