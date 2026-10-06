"use client";

/**
 * One tenancy request, in full.
 *
 * Read in a modal over the requests list, and at its own address for a link.
 * Top to bottom it answers what a provider decides on: who is asking and for
 * what, whether the advance they offer meets the ask, who they are, who stands
 * behind them, and what they said — then the decision, pinned to the foot.
 *
 * After acceptance the same record leads into the agreement. In the modal the
 * sheet widens into the wizard (`onPrepareAgreement`); on the page the wizard
 * opens in a sheet of its own. An agreement already saved is carried on from.
 *
 * Nothing about who may decide moved. `can_manage` still comes from the server
 * and still gates both buttons, and the endpoints are unchanged.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { type LeaseSpec } from "@/components/leases/LeaseWizard";
import { Icon, type IconName } from "@/components/portal/icons";
import { LeasePreparationForm } from "@/components/property/SpaceTenantAccess";
import { ApiFailure } from "@/lib/api";
import {
  applicationAction,
  decidePropertyJoinRequest,
  leaseAction,
  type RentalApplication,
} from "@/lib/console";
import {
  agreementStatus,
  formatRequestDate,
  requestCreatedAt,
  requestStage,
  requestStatus,
  requestTone,
  requestWho,
  type RequestItem,
} from "@/lib/tenancyRequests";

export function RequestRecord({
  item,
  onChanged,
  portfolioName = "",
  onPrepareAgreement,
}: {
  item: RequestItem;
  onChanged: () => Promise<void>;
  portfolioName?: string;
  /** In the requests modal: widen the sheet into the wizard instead of opening another. */
  onPrepareAgreement?: (spec: LeaseSpec) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const confirmRef = useRef<HTMLElement>(null);

  // The confirmation opens below the fold of a sheet; bring it into view.
  useEffect(() => {
    if (confirmingDecline) confirmRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [confirmingDecline]);

  const application = item.kind === "application" ? item.application : null;
  const request = item.kind === "private" ? item.request : null;
  const lease = item.lease;

  useEffect(() => {
    setNote(item.kind === "application" ? item.application.decision_note : item.request.decision_note);
    setError("");
    setConfirmingDecline(false);
  }, [item]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That action did not work.");
    } finally {
      setBusy(false);
    }
  }

  const stage = requestStage(item);
  const who = requestWho(item);
  const tone = requestTone(item);
  const property = application ? application.property_title || application.listing_headline : request!.property_title;
  const place = application
    ? [application.unit_label, application.space_type_label, application.locality_name].filter(Boolean).join(" · ")
    : [request!.unit_label, request!.bed_label].filter(Boolean).join(" · ");
  const decisionNote = application?.decision_note && stage === "history" ? application.decision_note : request?.decision_note ?? "";

  const context: LeaseSpec["context"] = {
    tenantName: who,
    tenantVerified: application?.applicant_phone_verified,
    providerName: portfolioName || undefined,
    propertyTitle: property,
    unitLabel: application ? application.unit_label : request!.unit_label,
    bedLabel: request?.bed_label ?? null,
    locality: application?.locality_name ?? null,
    photoUrl: application?.photo_url ?? null,
    sourceLabel: application ? "Public listing" : "Direct request",
    advanceAsked: application?.advance_months_asked,
  };

  return (
    <div className="rq">
      <section className="rq-hero" data-tone={tone} aria-label="Request">
        <div className="rq-who">
          <span className="rq-avatar" aria-hidden="true">{initialsOf(who)}</span>
          <span className="rq-who-copy">
            <strong>{who}</strong>
            <small>
              {application ? "Public listing" : "Direct request"} · {formatRequestDate(requestCreatedAt(item))}
              {application?.applicant_phone_verified ? <em><Icon name="verification" />Verified</em> : null}
            </small>
          </span>
          <span className={`request-row-state is-${tone}`}><i />{requestStatus(item)}</span>
        </div>
        <div className="rq-place">
          <span className="rq-photo" aria-hidden="true">
            {application?.photo_url ? (
              /* Short-lived signed URLs from the files service. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={application.photo_url} alt="" />
            ) : <Icon name="properties" />}
          </span>
          <span className="rq-place-copy">
            <strong>{property}</strong>
            <small>{[place || null, application?.rent_formatted ? `${application.rent_formatted}/mo` : null].filter(Boolean).join(" · ")}</small>
          </span>
          <Link
            className="rq-place-link"
            aria-label={application ? "View listing" : "View Unit"}
            title={application ? "View listing" : "View Unit"}
            href={
              (item.kind === "application"
                ? `/listings/${application!.listing_id}`
                : `/properties/${request!.property_id}/spaces/${request!.unit_id}`) as never
            }
          >
            <Icon name="share" />
          </Link>
        </div>
      </section>

      {application ? (
        <ApplicationDetails application={application} />
      ) : request?.message ? (
        <blockquote className="rq-message">“{request.message}”</blockquote>
      ) : null}

      {decisionNote ? (
        <p className="rq-decision-note"><Icon name="chat" /><span><small>Your note</small>{decisionNote}</span></p>
      ) : null}
      {error ? <Notice tone="error" title={error} /> : null}

      {stage === "action" && application && !confirmingDecline ? (
        <Field
          label="Note to the applicant (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={300}
        />
      ) : null}

      {stage === "action" && confirmingDecline ? (
        <section ref={confirmRef} className="rq-confirm">
          <Notice
            tone="warning"
            title="Decline this request?"
            body="They will see it was not accepted."
          />
          <Field
            label={request ? "Reason (optional)" : "Note to the applicant (optional)"}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={request ? 400 : 300}
          />
        </section>
      ) : null}

      {stage === "action" && request && !request.can_manage ? (
        <Notice
          tone="info"
          title="View only"
          body="An Owner, Admin or assigned property manager must act."
        />
      ) : null}

      {stage === "agreement" ? (
        <section className="rq-agreement" data-saved={lease ? "" : undefined}>
          <span className="rq-agreement-mark" aria-hidden="true"><Icon name="leases" /></span>
          <span className="rq-agreement-copy">
            <strong>{lease ? agreementStatus(lease) : "Next: the agreement"}</strong>
            <small>
              {lease?.status === "ready"
                ? "Generated. Review it, then send."
                : lease
                  ? "Saved. Carry on where you left off."
                  : "Six short steps, then it goes to the tenant."}
            </small>
          </span>
          <ol className="rq-agreement-track" aria-hidden="true">
            {["Parties", "Term", "Rent", "Duties", "Terms", "Send"].map((label, index) => (
              <li key={label} data-done={lease?.status === "ready" ? (index < 5 ? "" : undefined) : lease ? (index < 1 ? "" : undefined) : undefined}>{label}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {stage === "history" && lease ? (
        <p className="rq-settled"><Icon name="leases" />{agreementStatus(lease)}</p>
      ) : stage === "history" && request?.lease_status ? (
        <p className="rq-settled"><Icon name="leases" />{agreementStatus(request.lease_status)}</p>
      ) : null}

      {stage === "action" ? (
        <div className="rq-actions">
          {!confirmingDecline ? (
            <>
              <Button
                busy={busy}
                disabled={request ? !request.can_manage : false}
                onClick={() =>
                  void run(() =>
                    application
                      ? applicationAction(application.id, "accept", note)
                      : decidePropertyJoinRequest(request!.id, true, ""),
                  )
                }
              >
                <Icon name="check" />Accept
              </Button>
              {application?.status === "submitted" ? (
                <Button
                  variant="secondary"
                  busy={busy}
                  onClick={() => void run(() => applicationAction(application.id, "review", note))}
                >
                  Mark under review
                </Button>
              ) : null}
              <span className="rq-actions-spacer" />
              <Button
                variant="quiet"
                disabled={busy || Boolean(request && !request.can_manage)}
                onClick={() => setConfirmingDecline(true)}
              >
                Decline
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                busy={busy}
                onClick={() =>
                  void run(() =>
                    application
                      ? applicationAction(application.id, "reject", note)
                      : decidePropertyJoinRequest(request!.id, false, note),
                  )
                }
              >
                Decline
              </Button>
              <Button variant="quiet" disabled={busy} onClick={() => setConfirmingDecline(false)}>
                Keep
              </Button>
            </>
          )}
        </div>
      ) : null}

      {stage === "agreement" ? (
        <div className="rq-actions">
          {item.kind === "application" ? (
            <LeasePreparationForm
              unitId={application!.unit_id}
              bedId={null}
              tenantId={application!.tenant_id}
              source={{
                kind: "application",
                id: application!.id,
                listingId: application!.listing_id,
              }}
              initialRentMinor={application!.rent_minor}
              initialAdvanceMonths={application!.advance_months_offered}
              context={context}
              lease={lease}
              label={agreementLabel(lease?.status)}
              icon={agreementIcon(lease?.status)}
              onOpen={onPrepareAgreement}
              onDone={onChanged}
            />
          ) : (
            <LeasePreparationForm
              unitId={request!.unit_id}
              bedId={request!.bed_id}
              tenantId={request!.requester_id}
              source={{ kind: "join_request", id: request!.id }}
              context={context}
              lease={lease}
              label={agreementLabel(lease?.status)}
              icon={agreementIcon(lease?.status)}
              onOpen={onPrepareAgreement}
              onDone={onChanged}
            />
          )}
          {lease?.status === "ready" ? (
            <Button variant="secondary" busy={busy} onClick={() => void run(() => leaseAction(lease.id, "offer"))}>
              Send now
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function agreementLabel(status: string | undefined) {
  return status === "ready" ? "Review & send" : status ? "Continue agreement" : "Prepare agreement";
}

function agreementIcon(status: string | undefined): IconName {
  return status === "ready" ? "share" : "leases";
}

function ApplicationDetails({ application }: { application: RentalApplication }) {
  const asked = application.advance_months_asked;
  const offered = application.advance_months_offered;
  const cells = Math.max(asked, offered, 1);
  return (
    <>
      <section className={`rq-advance${application.meets_advance ? " is-match" : " is-short"}`} aria-label="Advance">
        <div className="rq-advance-head">
          <strong>{offered} of {asked} months advance</strong>
          <span>
            {application.meets_advance
              ? "Meets your ask"
              : `${application.advance_shortfall_months} month${application.advance_shortfall_months === 1 ? "" : "s"} short`}
          </span>
        </div>
        <span className="rq-advance-bar" aria-hidden="true">
          {Array.from({ length: cells }).map((_, index) => (
            <i key={index} data-on={index < offered ? "" : undefined} data-asked={index < asked ? "" : undefined} />
          ))}
        </span>
      </section>

      <dl className="rq-facts">
        <Fact icon="clock" label="Move-in" value={application.move_in_from ? formatRequestDate(application.move_in_from) : "Not stated"} />
        <Fact icon="users" label="Household" value={application.household_size ? `${application.household_size} people` : "Not stated"} />
        <Fact icon="account" label="Occupation" value={application.occupation || "Not stated"} />
        <Fact icon="portfolio" label="Employer" value={application.employer || "Not stated"} />
      </dl>

      <section className="rq-guarantor" aria-label="Guarantor">
        <span className="rq-guarantor-mark" aria-hidden="true"><Icon name="shield" /></span>
        <span className="rq-guarantor-copy">
          <small>Guarantor</small>
          <strong>{application.guarantor_name || "None provided"}</strong>
          {application.guarantor_relationship ? <span>{application.guarantor_relationship}</span> : null}
        </span>
        {application.guarantor_phone ? (
          <a className="vr-icon-button" href={`tel:${application.guarantor_phone}`} aria-label={`Call ${application.guarantor_name}`} title={application.guarantor_phone}>
            <Icon name="handset" />
          </a>
        ) : null}
      </section>

      {application.message ? <blockquote className="rq-message">“{application.message}”</blockquote> : null}
    </>
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

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}
