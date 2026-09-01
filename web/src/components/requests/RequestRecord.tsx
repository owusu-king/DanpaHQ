"use client";

/**
 * One tenancy request, in full.
 *
 * This was the inside of a `<dialog>` on the requests list. It is the wrong
 * thing to put in a layer: accepting or declining is a decision about a person,
 * it carries a note somebody types, and where it leads is a whole agreement
 * form. A provider comparing two applicants, or checking the Unit before
 * deciding, should be able to leave and come back — and a colleague should be
 * able to be sent the link.
 *
 * Nothing about who may decide moved with it. `can_manage` still comes from the
 * server and still gates both buttons, and the endpoints are unchanged.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
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
  requestWhere,
  type RequestItem,
} from "@/lib/tenancyRequests";

export function RequestRecord({
  item,
  onChanged,
}: {
  item: RequestItem;
  onChanged: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDecline, setConfirmingDecline] = useState(false);

  const application = item.kind === "application" ? item.application : null;
  const request = item.kind === "private" ? item.request : null;

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

  return (
    <div className="request-detail">
      <div className="request-detail-identity">
        <p className="type-body-strong">{requestWhere(item)}</p>
        <span className={`request-row-state is-${requestTone(item)}`}>
          <i />
          {requestStatus(item)}
        </span>
        <p className="type-caption">Received {formatRequestDate(requestCreatedAt(item))}</p>
      </div>

      {application ? (
        <ApplicationDetails application={application} />
      ) : request?.message ? (
        <blockquote>“{request.message}”</blockquote>
      ) : null}

      {application?.decision_note && stage === "history" ? (
        <Notice tone="info" title="Decision note" body={application.decision_note} />
      ) : null}
      {request?.decision_note ? (
        <Notice tone="info" title="Decision note" body={request.decision_note} />
      ) : null}
      {error ? <Notice tone="error" title={error} /> : null}

      {stage === "action" ? (
        <div className="request-action-area">
          {application ? (
            <Field
              label="Note to the applicant (optional)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
            />
          ) : null}
          {!confirmingDecline ? (
            <div className="request-actions">
              {application?.status === "submitted" ? (
                <Button
                  variant="secondary"
                  busy={busy}
                  onClick={() => void run(() => applicationAction(application.id, "review", note))}
                >
                  Mark under review
                </Button>
              ) : null}
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
                Accept request
              </Button>
              <Button
                variant="destructive"
                disabled={busy || Boolean(request && !request.can_manage)}
                onClick={() => setConfirmingDecline(true)}
              >
                Decline
              </Button>
            </div>
          ) : (
            <div className="request-inline-confirm">
              <Notice
                tone="warning"
                title="Decline this request?"
                body="The person will see that the request was not accepted."
              />
              {request ? (
                <Field
                  label="Reason (optional)"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={400}
                />
              ) : null}
              <div className="request-actions">
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
                  Confirm decline
                </Button>
                <Button variant="quiet" disabled={busy} onClick={() => setConfirmingDecline(false)}>
                  Go back
                </Button>
              </div>
            </div>
          )}
          {request && !request.can_manage ? (
            <Notice
              tone="info"
              title="View only"
              body="An Owner, Admin or assigned property manager must act."
            />
          ) : null}
        </div>
      ) : null}

      {stage === "agreement" ? (
        <div className="request-detail-section">
          <h3>Next: prepare the agreement</h3>
          <p className="type-caption">
            Acceptance permits an agreement to be prepared. The tenancy starts only after the tenant
            accepts and activation completes.
          </p>
          {item.kind === "application" ? (
            item.lease?.status === "draft" ? (
              <Button busy={busy} onClick={() => void run(() => leaseAction(item.lease!.id, "offer"))}>
                Send saved agreement
              </Button>
            ) : (
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
                onDone={onChanged}
              />
            )
          ) : !request!.lease_id ? (
            <LeasePreparationForm
              unitId={request!.unit_id}
              bedId={request!.bed_id}
              tenantId={request!.requester_id}
              source={{ kind: "join_request", id: request!.id }}
              onDone={onChanged}
            />
          ) : (
            <Button busy={busy} onClick={() => void run(() => leaseAction(request!.lease_id!, "offer"))}>
              Send saved agreement
            </Button>
          )}
        </div>
      ) : null}

      {stage === "history" && (item.kind === "application" ? item.lease : request?.lease_id) ? (
        <p className="type-body-strong">
          {item.kind === "application"
            ? agreementStatus(item.lease)
            : agreementStatus(request?.lease_status ?? null)}
        </p>
      ) : null}

      <div className="request-detail-section">
        <h3>Related record</h3>
        <p>
          <Link
            href={
              (item.kind === "application"
                ? `/listings/${application!.listing_id}`
                : `/properties/${request!.property_id}/spaces/${request!.unit_id}`) as never
            }
            className="type-body-strong"
          >
            View {item.kind === "application" ? "listing" : "Unit"} →
          </Link>
        </p>
      </div>
    </div>
  );
}

function ApplicationDetails({ application }: { application: RentalApplication }) {
  return (
    <>
      <div className={`request-advance${application.meets_advance ? " is-match" : " is-short"}`}>
        <strong>
          {application.meets_advance
            ? `Offers the requested ${application.advance_months_asked} months advance`
            : `${application.advance_shortfall_months} month${application.advance_shortfall_months === 1 ? "" : "s"} below the requested advance`}
        </strong>
        <span>
          Offers {application.advance_months_offered}; asking {application.advance_months_asked}.
        </span>
      </div>
      <dl className="request-facts">
        <div>
          <dt>Move-in</dt>
          <dd>{application.move_in_from ? formatRequestDate(application.move_in_from) : "Not stated"}</dd>
        </div>
        <div>
          <dt>Household</dt>
          <dd>{application.household_size ? `${application.household_size} people` : "Not stated"}</dd>
        </div>
        <div>
          <dt>Occupation</dt>
          <dd>{application.occupation || "Not stated"}</dd>
        </div>
        <div>
          <dt>Employer</dt>
          <dd>{application.employer || "Not stated"}</dd>
        </div>
      </dl>
      <div className="request-detail-section">
        <h3>Guarantor</h3>
        <p className="type-caption">
          {application.guarantor_name ? (
            <>
              {application.guarantor_name}
              {application.guarantor_relationship ? ` · ${application.guarantor_relationship}` : ""}
              {application.guarantor_phone ? (
                <>
                  {" · "}
                  <a href={`tel:${application.guarantor_phone}`}>{application.guarantor_phone}</a>
                </>
              ) : null}
            </>
          ) : (
            "None provided"
          )}
        </p>
      </div>
      {application.message ? <blockquote>“{application.message}”</blockquote> : null}
    </>
  );
}
