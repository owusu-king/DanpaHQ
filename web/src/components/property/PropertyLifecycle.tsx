"use client";

/**
 * What a property page offers, decided by where the property actually is.
 *
 * The page used to offer "Continue with property details" in every state — to a
 * provider whose property was sitting with a reviewer, to one whose claim had
 * been rejected, and to one whose property had been approved weeks earlier. It
 * was not ignoring the state; `authority_state` has four values and collapses
 * `rejected` and `revoked` into `unverified`, so the page was never told the
 * difference between "not started" and "we said no".
 *
 * The backend now answers with one combined state — see
 * `apps/property/verification.py` — and this renders that. Every control it
 * shows is also gated by `permitted_actions`, so hiding one is a courtesy and
 * the API refuses it either way (ADR 0021).
 *
 * The shape of the page follows the shape of the life:
 *
 *     CREATION  →  VERIFICATION  →  VERIFIED MANAGEMENT
 *
 * and it does not stay in the first of those forever.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { ApiFailure } from "@/lib/api";
import {
  archiveProperty,
  deleteProperty,
  withdrawPropertySubmission,
  type Property,
} from "@/lib/console";
import type { SetupStep } from "@/lib/propertySetup";

import { SetupProgress, SetupSteps } from "./SetupSteps";

/** A date somebody can read, or nothing if there isn't one. */
function on(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function PropertyLifecycle({
  property,
  steps,
  onChanged,
  compact = false,
}: {
  property: Property;
  steps: SetupStep[];
  onChanged: () => Promise<void>;
  compact?: boolean;
}) {
  const { state, review_state: reviewState } = property.verification;

  if (compact) {
    return <CompactLifecycle property={property} steps={steps} onChanged={onChanged} />;
  }

  // One card for where the property is, and — under it, in every state — the
  // destructive options the backend actually permits. `DangerZone` renders
  // nothing when neither is allowed, so this does not need to know which states
  // those are; asking it to would be a second copy of the policy.
  //
  // `ready_for_submission` is its own card rather than part of "still setting
  // up": it is the state the creation/submission split exists to express.
  const card =
    reviewState === "verified" ? (
      <Verified property={property} />
    ) : reviewState === "suspended" ? (
      <Suspended property={property} />
    ) : reviewState === "pending_verification" ? (
      <WithReviewer property={property} onChanged={onChanged} />
    ) : reviewState === "changes_required" || reviewState === "rejected" || reviewState === "expired" ? (
      <NeedsAttention property={property} steps={steps} />
    ) : state === "ready_for_submission" || reviewState === "withdrawn" ? (
      <Created property={property} />
    ) : (
      <StillCreating property={property} steps={steps} />
    );

  return (
    <>
      {card}
      <DangerZone property={property} />
    </>
  );
}

/**
 * The management page needs one concise operational interruption, not a second
 * page inside the page. Routine verified state is already in the entity header;
 * this renders only unfinished, waiting or exceptional work.
 */
function CompactLifecycle({
  property,
  steps,
  onChanged,
}: {
  property: Property;
  steps: SetupStep[];
  onChanged: () => Promise<void>;
}) {
  const { state, review_state: reviewState } = property.verification;
  const edit = property.permitted_actions.edit;
  const submit = property.permitted_actions.submit_for_verification;

  if (reviewState === "verified") return null;

  if (reviewState === "pending_verification") {
    return <CompactPending property={property} onChanged={onChanged} />;
  }

  if (reviewState === "suspended") {
    return (
      <div className="attention-band" data-tone="attention">
        <div>
          <h2>Property verification withdrawn</h2>
          <p>{property.verification.decision_note || "Contact support before trying to advertise or provide new tenant access."}</p>
        </div>
      </div>
    );
  }

  if (["changes_required", "rejected", "expired"].includes(reviewState)) {
    const attentionTitle =
      reviewState === "changes_required"
        ? "What to update"
        : reviewState === "rejected"
          ? "Before trying again"
          : "Verification needs renewing";
    return (
      <div className="attention-band" data-tone="attention">
        <div>
          <h2>{attentionTitle}</h2>
          <p>{property.verification.decision_note || "Update the requested information before sending this Property again."}</p>
        </div>
        <div className="attention-band-actions">
          {edit?.allowed ? <Link href={`/properties/${property.id}/setup` as never} className="button-link">Update property</Link> : null}
          {submit?.allowed ? <Link href={`/properties/${property.id}/verify` as never} className="button-link secondary">Resubmit</Link> : null}
        </div>
      </div>
    );
  }

  if (state === "ready_for_submission" || reviewState === "withdrawn") {
    return (
      <div className="attention-band" data-tone="waiting">
        <div>
          <h2>{reviewState === "withdrawn" ? "Submission returned to you" : "Ready for verification"}</h2>
          <p>{reviewState === "withdrawn" ? "Your information is still saved. Review it, then submit again when ready." : "Verify the Property before its Units can be advertised or shared with prospective tenants."}</p>
        </div>
        <div className="attention-band-actions">
          {submit?.allowed ? <Link href={`/properties/${property.id}/verify` as never} className="button-link">Submit for verification</Link> : null}
          {edit?.allowed ? <Link href={`/properties/${property.id}/setup` as never} className="button-link secondary">Edit</Link> : null}
        </div>
      </div>
    );
  }

  const required = steps.filter((step) => !step.optional);
  const complete = required.filter((step) => step.status === "done").length;
  return (
    <div className="attention-band">
      <div>
        <h2>Finish setting up this Property</h2>
        <p>{complete} of {required.length} required steps complete. Everything is saved as you go.</p>
      </div>
      <div className="attention-band-actions">
        {edit?.allowed ? <Link href={`/properties/${property.id}/setup` as never} className="button-link">Continue setup</Link> : null}
      </div>
    </div>
  );
}

function CompactPending({
  property,
  onChanged,
}: {
  property: Property;
  onChanged: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const withdraw = property.permitted_actions.withdraw_submission;

  return (
    <div className="attention-band" data-tone="waiting">
      <div>
        <h2>With our review team</h2>
        <p>
          {confirming
            ? "This returns the submission to you. The Property stays saved and private, and you can submit it again later."
            : `${property.verification.submitted_at ? `Submitted ${on(property.verification.submitted_at)}. ` : ""}You can continue adding Units while the review is underway.`}
        </p>
        {error ? <Notice tone="error" title={error} /> : null}
      </div>
      <div className="attention-band-actions">
        {withdraw?.allowed && !confirming ? (
          <Button variant="quiet" onClick={() => setConfirming(true)}>Withdraw…</Button>
        ) : null}
        {confirming ? (
          <>
            <Button
              variant="destructive"
              busy={busy}
              busyLabel="Withdrawing…"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await withdrawPropertySubmission(property.id, "Withdrawn by the provider.");
                  setConfirming(false);
                  await onChanged();
                } catch (cause) {
                  setError(cause instanceof ApiFailure ? cause.error.message : "Could not withdraw this submission.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm withdrawal
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setConfirming(false)}>Keep submitted</Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Verification evidence and destructive actions are available without owning
 * the main management surface. */
export function PropertyMore({ property }: { property: Property }) {
  const hasDanger = Boolean(
    property.permitted_actions.delete?.allowed || property.permitted_actions.archive?.allowed,
  );
  return (
    <section className="workspace-section" aria-labelledby="property-more-heading">
      <div className="workspace-section-head">
        <h2 id="property-more-heading">Property details</h2>
      </div>
      <details className="detail-disclosure">
        <summary>Verification details</summary>
        <div className="detail-disclosure-body">
          <dl className="fact-grid">
            <div><dt>Status</dt><dd>{property.verification.review_state_label}</dd></div>
            {property.verification.submitted_at ? <div><dt>Submitted</dt><dd>{on(property.verification.submitted_at)}</dd></div> : null}
            {property.verification.decided_at ? <div><dt>Decided</dt><dd>{on(property.verification.decided_at)}</dd></div> : null}
            <div><dt>Package</dt><dd>Property details, authority document, photographs and amenities</dd></div>
          </dl>
          {property.verification.decision_note ? <Notice tone="info" title="Review note" body={property.verification.decision_note} /> : null}
        </div>
      </details>
      {hasDanger ? (
        <details className="detail-disclosure">
          <summary>Archive or delete</summary>
          <div className="detail-disclosure-body"><DangerZone property={property} /></div>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Archiving and deleting, where they actually work.
 *
 * These were rendered in the properties list as links to this page — controls
 * labelled "Delete" that navigated and removed nothing. A destructive action
 * needs a confirmation and a reason (ADR 0021: the reason is what the audit
 * entry and anyone affected will read), and neither fits in a list row, so the
 * row now points here and this is the thing that does it.
 *
 * Which of the two is offered is the backend's answer, never this component's.
 * Delete is refused the moment our team has seen the property; archive is
 * refused while they are holding it.
 */
function DangerZone({ property }: { property: Property }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = property.permitted_actions.delete;
  const archive = property.permitted_actions.archive;
  const act = remove?.allowed ? "delete" : archive?.allowed ? "archive" : null;
  if (!act) return null;

  const decision = act === "delete" ? remove! : archive!;

  return (
    <section
      id="danger"
      aria-labelledby="danger-heading"
      style={{
        marginTop: "var(--space-8)",
        padding: "var(--space-5)",
        border: "var(--border-hairline) solid var(--color-field-200)",
        borderRadius: "var(--radius-md)",
        display: "grid",
        gap: "var(--space-3)",
      }}
    >
      <h2 id="danger-heading" className="type-body-strong" style={{ margin: 0 }}>
        {act === "delete" ? "Delete this property" : "Archive this property"}
      </h2>
      <p className="type-caption" style={{ margin: 0, maxWidth: "58ch" }}>
        {decision.message}
      </p>

      {error ? <Notice tone="error" title={error} /> : null}

      {open ? (
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          <label style={{ display: "grid", gap: "var(--space-2)" }}>
            <span className="type-caption" style={{ color: "var(--color-ink-700)" }}>
              Why? This is recorded.
            </span>
            <input
              value={reason}
              maxLength={400}
              onChange={(event) => setReason(event.target.value)}
              className="type-body"
              style={{
                minHeight: "var(--target-min)",
                padding: "0 var(--space-3)",
                background: "var(--color-field-0)",
                border: "var(--border-hairline) solid var(--color-field-300)",
                borderRadius: "var(--radius-md)",
                color: "var(--color-ink-900)",
              }}
            />
          </label>
          <Actions>
            <Button
              variant="destructive"
              busy={busy}
              busyLabel={act === "delete" ? "Deleting…" : "Archiving…"}
              disabled={!reason.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  if (act === "delete") await deleteProperty(property.id, reason.trim());
                  else await archiveProperty(property.id, reason.trim());
                  router.push("/properties" as never);
                } catch (cause) {
                  setError(
                    cause instanceof ApiFailure
                      ? cause.error.message
                      : `Could not ${act} this property.`,
                  );
                  setBusy(false);
                }
              }}
            >
              {act === "delete" ? "Delete it permanently" : "Archive it"}
            </Button>
            <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>
              Keep it
            </Button>
          </Actions>
          {!reason.trim() ? (
            <p className="type-caption" style={{ margin: 0 }}>
              A reason is required — whoever this affects will see it.
            </p>
          ) : null}
        </div>
      ) : (
        <Actions>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {act === "delete" ? "Delete property" : "Archive property"}
          </Button>
        </Actions>
      )}
    </section>
  );
}

// --- creation ------------------------------------------------------------------

function StillCreating({
  property,
  steps,
}: {
  property: Property;
  steps: SetupStep[];
}) {
  const next = steps.find((step) => step.status !== "done" && !step.optional) ?? steps[0]!;
  const begun = steps.some((step) => step.status !== "todo");

  return (
    <Card labelledBy="setup">
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <span className="type-label" style={{ color: "var(--color-ink-500)" }}>
          BEING CREATED
        </span>
        <h2 id="setup" className="type-title-2" style={{ margin: 0 }}>
          Finish creating this property
        </h2>
        <p className="type-caption" style={{ margin: 0, maxWidth: "58ch" }}>
          Everything you have done so far is saved. Nothing has been sent to
          anybody — verification is a separate step you take afterwards.
        </p>
      </div>

      <SetupProgress steps={steps} />
      <Framed>
        <SetupSteps steps={steps} current={next.key} onSelect={() => undefined} />
      </Framed>

      <Actions>
        <Link href={`/properties/${property.id}/setup` as never}>
          <Button>
            {begun ? `Continue with ${next.title.toLowerCase()}` : "Start setting up"}
          </Button>
        </Link>
      </Actions>
    </Card>
  );
}

/**
 * The property exists and its verification has not been submitted.
 *
 * There is no "continue setup" here — there is nothing left to set up — and no
 * pressure to submit. A provider may run a property privately for as long as
 * they like; verification is what lets them advertise it.
 */
function Created({ property }: { property: Property }) {
  const submit = property.permitted_actions.submit_for_verification;
  const edit = property.permitted_actions.edit;
  const withdrawn = property.verification.review_state === "withdrawn";

  return (
    <Card labelledBy="created">
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <span className="type-label" style={{ color: "var(--color-ink-500)" }}>
          {withdrawn ? "WITHDRAWN" : "NOT SUBMITTED FOR VERIFICATION"}
        </span>
        <h2 id="created" className="type-title-2" style={{ margin: 0 }}>
          {withdrawn ? "Submission returned to you" : `${property.title || "This property"} is set up`}
        </h2>
        <p className="type-caption" style={{ margin: 0, maxWidth: "58ch" }}>
          {withdrawn
            ? "Everything in the package is still saved. Edit it if needed, then submit the property again when you are ready."
            : "You can add the spaces inside it now. Until our team has verified it, private Unit access and advertising stay unavailable."}
        </p>
      </div>

      <Actions>
        {submit?.allowed ? (
          <Link href={`/properties/${property.id}/verify` as never}>
            <Button>Submit for verification</Button>
          </Link>
        ) : null}
        {edit?.allowed ? (
          <Link href={`/properties/${property.id}/setup` as never}>
            <Button variant="secondary">Edit property</Button>
          </Link>
        ) : null}
      </Actions>

      {!submit?.allowed && submit?.blockers?.length ? (
        <p className="type-caption" style={{ margin: 0 }}>
          {submit.blockers.map((blocker) => blocker.message).join(" ")}
        </p>
      ) : null}
    </Card>
  );
}

// --- verification ---------------------------------------------------------------

function WithReviewer({
  property,
  onChanged,
}: {
  property: Property;
  onChanged: () => Promise<void>;
}) {
  const [showing, setShowing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { verification } = property;
  const withdraw = property.permitted_actions.withdraw_submission;

  return (
    <Card labelledBy="review-status">
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <span className="type-label" style={{ color: "var(--color-harmattan-600)" }}>
          PENDING VERIFICATION
        </span>
        <h2 id="review-status" className="type-title-2" style={{ margin: 0 }}>
          This property is with our team
        </h2>
        <p className="type-caption" style={{ margin: 0, maxWidth: "58ch" }}>
          {verification.submitted_at
            ? `Sent on ${on(verification.submitted_at)}. `
            : ""}
          There is nothing here waiting on you. You can keep adding spaces inside
          it — none of them wait on this.
        </p>
      </div>

      {error ? <Notice tone="error" title={error} /> : null}

      <Actions>
        <Button variant="secondary" onClick={() => setShowing((open) => !open)}>
          {showing ? "Hide submission details" : "View submission details"}
        </Button>
        {withdraw?.allowed ? (
          <Button variant="quiet" onClick={() => setConfirming((open) => !open)}>
            {confirming ? "Keep it with the team" : "Withdraw submission"}
          </Button>
        ) : null}
      </Actions>

      {showing ? (
        <Framed>
          <dl style={{ margin: 0, display: "grid" }}>
            <Row term="Sent" value={on(verification.submitted_at) || "Not recorded"} />
            <Row term="Package" value="Property details, documents, photos and amenities" />
            <Row term="Verification" value={verification.review_state_label} />
            {verification.decision_note ? (
              <Row term="From our team" value={verification.decision_note} />
            ) : null}
          </dl>
        </Framed>
      ) : null}

      {confirming ? (
        <>
          <Notice
            tone="warning"
            title="Taking this back out of the queue"
            body={
              withdraw?.message ??
              "Everything you sent is kept, and you can send it again when you are ready."
            }
          />
          <Actions>
            <Button
              variant="destructive"
              busy={busy}
              busyLabel="Withdrawing…"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await withdrawPropertySubmission(
                    property.id,
                    "Withdrawn by the provider.",
                  );
                  setConfirming(false);
                  await onChanged();
                } catch (cause) {
                  setError(
                    cause instanceof ApiFailure
                      ? cause.error.message
                      : "Could not withdraw this.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Withdraw it
            </Button>
          </Actions>
        </>
      ) : null}
    </Card>
  );
}

function NeedsAttention({
  property,
  steps,
}: {
  property: Property;
  steps: SetupStep[];
}) {
  const [showing, setShowing] = useState(false);
  const { verification } = property;
  const rejected = verification.review_state === "rejected";
  const expired = verification.review_state === "expired";
  const submit = property.permitted_actions.submit_for_verification;

  // Which half asked. A provider told "changes requested" with no idea whether
  // it is the document or the photographs has been told almost nothing.
  const halves = [
    { name: "The ownership document", half: verification.authority },
    { name: "The photographs", half: verification.photos },
  ].filter(({ half }) =>
    ["changes_requested", "rejected", "expired"].includes(half.state),
  );

  return (
    <Card labelledBy="attention" tone={rejected ? "attention" : "waiting"}>
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <span
          className="type-label"
          style={{
            color: rejected
              ? "var(--color-laterite-600)"
              : "var(--color-harmattan-600)",
          }}
        >
          {verification.review_state_label.toUpperCase()}
        </span>
        <h2 id="attention" className="type-title-2" style={{ margin: 0 }}>
          {rejected
            ? "This property was not verified"
            : expired
              ? "This property's check has expired"
              : "Our team asked for something else"}
        </h2>
        <p className="type-caption" style={{ margin: 0, maxWidth: "58ch" }}>
          {verification.decided_at ? `Reviewed on ${on(verification.decided_at)}. ` : ""}
          {halves.length
            ? `${halves.map(({ name }) => name.toLowerCase()).join(" and ")} ${
                halves.length === 1 ? "needs" : "need"
              } attention.`
            : "Update what is outstanding and send it again."}
        </p>
      </div>

      {/* Verbatim, per the design system: the note is written to say what to
          fix, and paraphrasing it leaves somebody stuck. */}
      {verification.decision_note ? (
        <Notice
          tone={rejected ? "error" : "warning"}
          title="What our team said"
          body={verification.decision_note}
        />
      ) : null}

      <Actions>
        <Link href={`/properties/${property.id}/setup` as never}>
          <Button>Update property</Button>
        </Link>
        {submit?.allowed ? (
          <Link href={`/properties/${property.id}/verify` as never}>
            <Button variant="secondary">Resubmit for verification</Button>
          </Link>
        ) : null}
        <Button variant="quiet" onClick={() => setShowing((open) => !open)}>
          {showing ? "Hide review feedback" : "View review feedback"}
        </Button>
      </Actions>

      {/* A rejected document cannot simply be sent again — the same one would
          come back the same way — so the refusal says what to replace. */}
      {!submit?.allowed && submit?.blockers?.length ? (
        <p className="type-caption" style={{ margin: 0 }}>
          {submit.blockers.map((blocker) => blocker.message).join(" ")}
        </p>
      ) : null}

      {showing ? (
        <Framed>
          <dl style={{ margin: 0, display: "grid" }}>
            {verification.authority.note ? (
              <Row term="Document feedback" value={verification.authority.note} />
            ) : null}
            {verification.photos.note ? (
              <Row term="Photo feedback" value={verification.photos.note} />
            ) : null}
            <Row term="Verification" value={verification.review_state_label} />
            <Row
              term="Setup"
              value={`${steps.filter((s) => !s.optional && s.status === "done").length} of ${
                steps.filter((s) => !s.optional).length
              } steps done`}
            />
          </dl>
        </Framed>
      ) : null}
    </Card>
  );
}

function Suspended({ property }: { property: Property }) {
  const [showing, setShowing] = useState(false);
  const { verification } = property;

  return (
    <Card labelledBy="suspended" tone="attention">
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <span className="type-label" style={{ color: "var(--color-laterite-600)" }}>
          RESTRICTED
        </span>
        <h2 id="suspended" className="type-title-2" style={{ margin: 0 }}>
          This property&apos;s verification was withdrawn
        </h2>
        <p className="type-caption" style={{ margin: 0, maxWidth: "58ch" }}>
          {verification.decided_at ? `On ${on(verification.decided_at)}. ` : ""}
          Its spaces cannot be advertised and no new private access codes can be used.
          Existing tenancies are unaffected — they are agreements between you and
          the people in them, and this does not touch them.
        </p>
      </div>

      <Notice
        tone="error"
        title="Sending it again is not the next step"
        body={
          verification.decision_note ||
          "Our team withdrew this check. Contact support to understand what is needed before anything else."
        }
      />

      <Actions>
        <Button variant="secondary" onClick={() => setShowing((open) => !open)}>
          {showing ? "Hide details" : "View details"}
        </Button>
      </Actions>

      {showing ? (
        <Framed>
          <dl style={{ margin: 0, display: "grid" }}>
            <Row term="Verification" value={verification.review_state_label} />
            <Row term="Withdrawn" value={on(verification.decided_at) || "Not recorded"} />
            {verification.decision_note ? (
              <Row term="Reason given" value={verification.decision_note} />
            ) : null}
          </dl>
        </Framed>
      ) : null}
    </Card>
  );
}

// --- verified management ---------------------------------------------------------

/**
 * A verified property: managed, and fixed.
 *
 * No edit here, and no half-door. A verification is a statement about a
 * described thing, so the description is part of what was checked — the name a
 * tenant reads as much as the water source a reviewer counted photographs
 * against. Letting any of it move under a live approval makes the mark vouch for
 * something nobody looked at.
 *
 * Spaces have a way out of this (`request_recheck`, which supersedes the
 * approval and returns the space to draft). Properties do not yet, so this says
 * where to go instead of offering a control the API refuses.
 */
function Verified({ property }: { property: Property }) {
  const [showing, setShowing] = useState(false);
  const { verification } = property;

  return (
    <Card labelledBy="verified" tone="good">
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <span className="type-label" style={{ color: "var(--color-kola-600)" }}>
          ✓ VERIFIED PROPERTY
        </span>
        <h2 id="verified" className="type-title-2" style={{ margin: 0 }}>
          Confirmed as yours to let
        </h2>
        <p className="type-caption" style={{ margin: 0, maxWidth: "58ch" }}>
          {verification.decided_at
            ? `Checked on ${on(verification.decided_at)}. `
            : ""}
          Units here can be advertised or shared privately by Unit access code once each
          Unit has been checked in its own right. The property&apos;s own details
          are fixed while this check stands.
        </p>
      </div>

      <Actions>
        <Link href={`/properties/${property.id}/spaces/new` as never}>
          <Button>Add Unit</Button>
        </Link>
        <Button variant="quiet" onClick={() => setShowing((open) => !open)}>
          {showing ? "Hide verification details" : "View verification details"}
        </Button>
      </Actions>

      {showing ? (
        <Framed>
          <dl style={{ margin: 0, display: "grid" }}>
            <Row term="Verification" value={`${verification.review_state_label}${verification.decided_at ? ` · ${on(verification.decided_at)}` : ""}`} />
            <Row term="Package checked" value="Property details, authority documents, photographs and amenities" />
            <Row
              term="What can change"
              value="Nothing. This property's details are fixed while the check stands — contact support if something here is genuinely wrong."
            />
          </dl>
        </Framed>
      ) : null}
    </Card>
  );
}

// --- small pieces -----------------------------------------------------------------

const TONES = {
  good: "var(--color-kola-600)",
  waiting: "var(--color-harmattan-500)",
  attention: "var(--color-laterite-600)",
  neutral: "var(--color-field-200)",
} as const;

function Card({
  children,
  labelledBy,
  tone = "neutral",
}: {
  children: React.ReactNode;
  labelledBy: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      style={{
        marginTop: "var(--space-8)",
        display: "grid",
        gap: "var(--space-5)",
        padding: "var(--space-6)",
        background: "var(--color-field-0)",
        border: "var(--border-hairline) solid var(--color-field-200)",
        // A hairline down one side rather than a coloured panel: the design
        // system's mark, and it survives the LCD panels this runs on.
        borderLeft: `var(--border-stamp) solid ${TONES[tone]}`,
        borderRadius: "var(--radius-md)",
      }}
    >
      {children}
    </section>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
      {children}
    </div>
  );
}

function Framed({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "var(--border-hairline) solid var(--color-field-200)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(9rem, 12rem) 1fr",
        gap: "var(--space-4)",
        padding: "var(--space-3)",
        borderBottom: "var(--border-hairline) solid var(--color-field-200)",
      }}
    >
      <dt className="type-caption" style={{ color: "var(--color-ink-500)" }}>
        {term}
      </dt>
      <dd className="type-body" style={{ margin: 0 }}>
        {value}
      </dd>
    </div>
  );
}
