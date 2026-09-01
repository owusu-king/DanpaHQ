/**
 * What a property screen offers, decided by where the property actually is.
 *
 * The web component of the same name, said in React Native. Same states, same
 * rules, same words — a provider who checks a property on their phone and then
 * on a laptop must not be told two different things about it — with the step
 * list above the panel rather than beside it, per ADR 0014.
 *
 * The screen used to show the whole review inline regardless of state, so a
 * property sitting with a reviewer, one that had been rejected, and one approved
 * weeks earlier all offered the same thing. `authority_state` could not have
 * told it apart: four values, with `rejected` and `revoked` both arriving as
 * `unverified`.
 */

import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Field, Notice, Surface, Type, space } from "@/components/ui";
import { Disclosure } from "@/components/property/WorkspacePatterns";
import type { SetupStep } from "@/propertySetup";
import {
  archiveProperty,
  deleteProperty,
  withdrawPropertySubmission,
  type Property,
} from "@/provider";
import { theme } from "@/theme";

import { SetupProgress, SetupSteps } from "./SetupSteps";

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

  if (compact) return <CompactLifecycle property={property} steps={steps} onChanged={onChanged} />;

  // One card for where the property is, and — under it, in every state — the
  // destructive options the backend permits. `DangerZone` renders nothing when
  // neither is allowed, so this does not need to know which states those are.
  const card =
    reviewState === "verified" ? (
      <Verified property={property} />
    ) : reviewState === "suspended" ? (
      <Suspended property={property} />
    ) : reviewState === "pending_verification" ? (
      <WithReviewer property={property} onChanged={onChanged} />
    ) : reviewState === "changes_required" || reviewState === "rejected" || reviewState === "expired" ? (
      <NeedsAttention property={property} />
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

function CompactLifecycle({ property, steps, onChanged }: { property: Property; steps: SetupStep[]; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { state, review_state: reviewState } = property.verification;
  const edit = property.permitted_actions.edit;
  const submit = property.permitted_actions.submit_for_verification;
  const withdraw = property.permitted_actions.withdraw_submission;

  if (reviewState === "verified") return null;

  if (reviewState === "pending_verification") {
    return (
      <View style={{ gap: space[3], paddingLeft: space[4], borderLeftWidth: 3, borderLeftColor: theme.color.harmattan["500"] }}>
        <Type variant="bodyStrong">With our review team</Type>
        <Type variant="caption">
          {confirming
            ? "This returns the submission to you. The Property stays saved and private, and you can submit it again later."
            : "You can continue adding Units while the review is underway."}
        </Type>
        {error ? <Notice tone="error" title={error} /> : null}
        {withdraw?.allowed && !confirming ? <Button label="Withdraw…" variant="quiet" onPress={() => setConfirming(true)} /> : null}
        {confirming ? (
          <View style={{ gap: space[2] }}>
            <Button label="Confirm withdrawal" variant="destructive" busy={busy} onPress={async () => {
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
            }} />
            <Button label="Keep submitted" variant="quiet" disabled={busy} onPress={() => setConfirming(false)} />
          </View>
        ) : null}
      </View>
    );
  }

  if (reviewState === "suspended") {
    return <Notice tone="error" title="Property verification withdrawn" body={property.verification.decision_note || "Contact support before advertising or providing new tenant access."} />;
  }

  if (["changes_required", "rejected", "expired"].includes(reviewState)) {
    const attentionTitle =
      reviewState === "changes_required"
        ? "What to update"
        : reviewState === "rejected"
          ? "Before trying again"
          : "Verification needs renewing";
    return (
      <View style={{ gap: space[3], paddingLeft: space[4], borderLeftWidth: 3, borderLeftColor: theme.color.laterite["600"] }}>
        <Type variant="bodyStrong">{attentionTitle}</Type>
        <Type variant="caption">{property.verification.decision_note || "Update the requested information before sending this Property again."}</Type>
        {edit?.allowed ? <Button label="Update Property" onPress={() => router.push({ pathname: "/(app)/property-setup", params: { propertyId: property.id } })} /> : null}
        {submit?.allowed ? <Button label="Resubmit" variant="secondary" onPress={() => router.push({ pathname: "/(app)/property-verify", params: { propertyId: property.id } })} /> : null}
      </View>
    );
  }

  if (state === "ready_for_submission" || reviewState === "withdrawn") {
    return (
      <View style={{ gap: space[3], paddingLeft: space[4], borderLeftWidth: 3, borderLeftColor: theme.color.harmattan["500"] }}>
        <Type variant="bodyStrong">{reviewState === "withdrawn" ? "Submission returned to you" : "Ready for verification"}</Type>
        <Type variant="caption">Verify the Property before its Units can be advertised or shared with prospective tenants.</Type>
        {submit?.allowed ? <Button label="Submit for verification" onPress={() => router.push({ pathname: "/(app)/property-verify", params: { propertyId: property.id } })} /> : null}
      </View>
    );
  }

  const required = steps.filter((step) => !step.optional);
  const complete = required.filter((step) => step.status === "done").length;
  return (
    <View style={{ gap: space[3], paddingLeft: space[4], borderLeftWidth: 3, borderLeftColor: theme.color.field["300"] }}>
      <Type variant="bodyStrong">Finish setting up this Property</Type>
      <Type variant="caption">{complete} of {required.length} required steps complete. Everything is saved as you go.</Type>
      {edit?.allowed ? <Button label="Continue setup" onPress={() => router.push({ pathname: "/(app)/property-setup", params: { propertyId: property.id } })} /> : null}
    </View>
  );
}

export function PropertyMore({ property }: { property: Property }) {
  const hasDanger = Boolean(property.permitted_actions.delete?.allowed || property.permitted_actions.archive?.allowed);
  return (
    <View>
      <Disclosure title="Verification details">
        <Row term="Status" value={property.verification.review_state_label} />
        {property.verification.submitted_at ? <Row term="Submitted" value={on(property.verification.submitted_at)} /> : null}
        {property.verification.decided_at ? <Row term="Decided" value={on(property.verification.decided_at)} /> : null}
        <Row term="Package" value="Property details, authority document, photographs and amenities" />
        {property.verification.decision_note ? <Notice tone="info" title="Review note" body={property.verification.decision_note} /> : null}
      </Disclosure>
      {hasDanger ? <Disclosure title="Archive or delete"><DangerZone property={property} /></Disclosure> : null}
    </View>
  );
}

/**
 * Archiving and deleting, where they actually work.
 *
 * Both need a confirmation and a written reason (ADR 0021: the reason is what
 * the audit entry and anyone affected will read), so neither belongs on a list
 * row. Which of the two is offered is the backend's answer, never this
 * component's.
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
    <Surface style={{ gap: space[3] }}>
      <Type variant="bodyStrong">
        {act === "delete" ? "Delete this property" : "Archive this property"}
      </Type>
      <Type variant="caption">{decision.message}</Type>

      {error ? <Notice tone="error" title={error} /> : null}

      {open ? (
        <>
          <Field
            label="Why? This is recorded."
            value={reason}
            onChangeText={setReason}
            maxLength={400}
          />
          <Button
            label={act === "delete" ? "Delete it permanently" : "Archive it"}
            variant="destructive"
            busy={busy}
            disabled={!reason.trim()}
            onPress={async () => {
              setBusy(true);
              setError("");
              try {
                if (act === "delete") await deleteProperty(property.id, reason.trim());
                else await archiveProperty(property.id, reason.trim());
                router.replace("/(app)/(provider-tabs)/properties");
              } catch (cause) {
                setError(
                  cause instanceof ApiFailure
                    ? cause.error.message
                    : `Could not ${act} this property.`,
                );
                setBusy(false);
              }
            }}
          />
          <Button label="Keep it" variant="quiet" onPress={() => setOpen(false)} disabled={busy} />
        </>
      ) : (
        <Button
          label={act === "delete" ? "Delete property" : "Archive property"}
          variant="secondary"
          onPress={() => setOpen(true)}
        />
      )}
    </Surface>
  );
}

// --- creation ------------------------------------------------------------------

function StillCreating({ property, steps }: { property: Property; steps: SetupStep[] }) {
  const router = useRouter();
  const next = steps.find((step) => step.status !== "done" && !step.optional) ?? steps[0]!;
  const begun = steps.some((step) => step.status !== "todo");

  return (
    <Surface style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="label">BEING CREATED</Type>
        <Type variant="title2">Finish creating this property</Type>
        <Type variant="caption">
          Everything you have done so far is saved. Nothing has been sent to
          anybody — verification is a separate step you take afterwards.
        </Type>
      </View>

      <SetupProgress steps={steps} />
      <SetupSteps steps={steps} current={next.key} />

      <Button
        label={begun ? `Continue with ${next.title.toLowerCase()}` : "Start setting up"}
        onPress={() =>
          router.push({
            pathname: "/(app)/property-setup",
            params: { propertyId: property.id },
          })
        }
      />
    </Surface>
  );
}

/**
 * The property exists and its verification has not been submitted.
 *
 * No "continue setup" — there is nothing left to set up — and no pressure to
 * send. A provider may run a property privately for as long as they like;
 * verification is what lets them advertise it.
 */
function Created({ property }: { property: Property }) {
  const router = useRouter();
  const submit = property.permitted_actions.submit_for_verification;
  const edit = property.permitted_actions.edit;
  const withdrawn = property.verification.review_state === "withdrawn";

  return (
    <Surface style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="label">{withdrawn ? "WITHDRAWN" : "NOT SUBMITTED FOR VERIFICATION"}</Type>
        <Type variant="title2">{withdrawn ? "Submission returned to you" : `${property.title || "This property"} is set up`}</Type>
        <Type variant="caption">
          {withdrawn
            ? "Everything in the package is still saved. Edit it if needed, then submit the property again when you are ready."
            : "You can add the spaces inside it now. Until our team has verified it, private Unit access and advertising stay unavailable."}
        </Type>
      </View>

      {submit?.allowed ? (
        <Button
          label="Submit for verification"
          onPress={() =>
            router.push({
              pathname: "/(app)/property-verify",
              params: { propertyId: property.id },
            })
          }
        />
      ) : null}
      {edit?.allowed ? (
        <Button
          label="Edit property"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: "/(app)/property-setup",
              params: { propertyId: property.id },
            })
          }
        />
      ) : null}
      {!submit?.allowed && submit?.blockers?.length ? (
        <Type variant="caption">
          {submit.blockers.map((blocker) => blocker.message).join(" ")}
        </Type>
      ) : null}
    </Surface>
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
    <Surface style={{ gap: space[3] }}>
      <Type variant="label" style={{ color: theme.color.harmattan["600"] }}>
        PENDING VERIFICATION
      </Type>
      <Type variant="title2">
        This property is with our team
      </Type>
      <Type variant="caption">
        {verification.submitted_at ? `Sent on ${on(verification.submitted_at)}. ` : ""}
        There is nothing here waiting on you. You can keep adding spaces inside it —
        none of them wait on this.
      </Type>

      {error ? <Notice tone="error" title={error} /> : null}

      <Button
        label={showing ? "Hide submission details" : "View submission details"}
        variant="secondary"
        onPress={() => setShowing((open) => !open)}
      />
      {showing ? (
        <View style={{ gap: space[1] }}>
          <Row term="Sent" value={on(verification.submitted_at) || "Not recorded"} />
          <Row term="Package" value="Property details, documents, photos and amenities" />
          <Row term="Verification" value={verification.review_state_label} />
          {verification.decision_note ? (
            <Row term="From our team" value={verification.decision_note} />
          ) : null}
        </View>
      ) : null}

      {withdraw?.allowed ? (
        <Button
          label={confirming ? "Keep it with the team" : "Withdraw submission"}
          variant="quiet"
          onPress={() => setConfirming((open) => !open)}
        />
      ) : null}

      {confirming ? (
        <View style={{ gap: space[3] }}>
          <Notice
            tone="warning"
            title="Taking this back out of the queue"
            body={
              withdraw?.message ??
              "Everything you sent is kept, and you can send it again when you are ready."
            }
          />
          <Button
            label="Withdraw it"
            variant="destructive"
            busy={busy}
            onPress={async () => {
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
          />
        </View>
      ) : null}
    </Surface>
  );
}

function NeedsAttention({ property }: { property: Property }) {
  const router = useRouter();
  const [showing, setShowing] = useState(false);
  const { verification } = property;
  const rejected = verification.review_state === "rejected";
  const expired = verification.review_state === "expired";
  const submit = property.permitted_actions.submit_for_verification;

  // Which half asked. "Changes requested" with no idea whether it is the
  // document or the photographs tells a provider almost nothing.
  const halves = [
    { name: "The ownership document", half: verification.authority },
    { name: "The photographs", half: verification.photos },
  ].filter(({ half }) =>
    ["changes_requested", "rejected", "expired"].includes(half.state),
  );

  const open = (step?: string) =>
    router.push({
      pathname: "/(app)/property-setup",
      params: { propertyId: property.id, ...(step ? { step } : {}) },
    });

  return (
    <Surface style={{ gap: space[3] }}>
      <Type
        variant="label"
        style={{
          color: rejected ? theme.color.laterite["600"] : theme.color.harmattan["600"],
        }}
      >
        {verification.review_state_label.toUpperCase()}
      </Type>
      <Type variant="title2">
        {rejected
          ? "This property was not verified"
          : expired
            ? "This property's check has expired"
            : "Our team asked for something else"}
      </Type>
      <Type variant="caption">
        {verification.decided_at ? `Reviewed on ${on(verification.decided_at)}. ` : ""}
        {halves.length
          ? `${halves.map(({ name }) => name.toLowerCase()).join(" and ")} ${
              halves.length === 1 ? "needs" : "need"
            } attention.`
          : "Update what is outstanding and send it again."}
      </Type>

      {/* Verbatim: the note is written to say what to fix, and paraphrasing it
          leaves somebody stuck. */}
      {verification.decision_note ? (
        <Notice
          tone={rejected ? "error" : "warning"}
          title="What our team said"
          body={verification.decision_note}
        />
      ) : null}

      <Button label="Update property" onPress={() => open()} />
      {submit?.allowed ? (
        <Button
          label="Resubmit for verification"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: "/(app)/property-verify",
              params: { propertyId: property.id },
            })
          }
        />
      ) : null}
      {/* A rejected document cannot simply be sent again — the same one would
          come back the same way — so the refusal says what to replace. */}
      {!submit?.allowed && submit?.blockers?.length ? (
        <Type variant="caption">
          {submit.blockers.map((blocker) => blocker.message).join(" ")}
        </Type>
      ) : null}
      <Button
        label={showing ? "Hide review feedback" : "View review feedback"}
        variant="quiet"
        onPress={() => setShowing((value) => !value)}
      />

      {showing ? (
        <View style={{ gap: space[1] }}>
          {verification.authority.note ? (
            <Row term="Document feedback" value={verification.authority.note} />
          ) : null}
          {verification.photos.note ? (
            <Row term="Photo feedback" value={verification.photos.note} />
          ) : null}
          <Row term="Verification" value={verification.review_state_label} />
        </View>
      ) : null}
    </Surface>
  );
}

function Suspended({ property }: { property: Property }) {
  const [showing, setShowing] = useState(false);
  const { verification } = property;

  return (
    <Surface style={{ gap: space[3] }}>
      <Type variant="label" style={{ color: theme.color.laterite["600"] }}>
        RESTRICTED
      </Type>
      <Type variant="title2">This property&apos;s verification was withdrawn</Type>
      <Type variant="caption">
        {verification.decided_at ? `On ${on(verification.decided_at)}. ` : ""}
        Its spaces cannot be advertised and no new private access codes can be used.
        Existing tenancies are unaffected — they are agreements between you and the
        people in them, and this does not touch them.
      </Type>

      <Notice
        tone="error"
        title="Sending it again is not the next step"
        body={
          verification.decision_note ||
          "Our team withdrew this check. Contact support to understand what is needed before anything else."
        }
      />

      <Button
        label={showing ? "Hide details" : "View details"}
        variant="secondary"
        onPress={() => setShowing((value) => !value)}
      />
      {showing ? (
        <View style={{ gap: space[1] }}>
          <Row term="Verification" value={verification.review_state_label} />
          <Row term="Withdrawn" value={on(verification.decided_at) || "Not recorded"} />
        </View>
      ) : null}
    </Surface>
  );
}

// --- verified management ---------------------------------------------------------

/**
 * A verified property: managed, and fixed.
 *
 * No edit, and no half-door. A verification is a statement about a described
 * thing, so the description is part of what was checked — the name a tenant
 * reads as much as the water source a reviewer counted photographs against.
 * Spaces have a way out (`request_recheck`); properties do not yet.
 */
function Verified({ property }: { property: Property }) {
  const router = useRouter();
  const [showing, setShowing] = useState(false);
  const { verification } = property;

  return (
    <Surface style={{ gap: space[3] }}>
      <Type variant="label" style={{ color: theme.color.kola["600"] }}>
        ✓ VERIFIED PROPERTY
      </Type>
      <Type variant="title2">Confirmed as yours to let</Type>
      <Type variant="caption">
        {verification.decided_at ? `Checked on ${on(verification.decided_at)}. ` : ""}
        Units here can be advertised or shared privately by Unit access code once each Unit
        has been checked in its own right. The property&apos;s own details are
        fixed while this check stands.
      </Type>

      <Button
        label="Add Unit"
        onPress={() =>
          router.push({
            pathname: "/(app)/space-new",
            params: { propertyId: property.id },
          })
        }
      />
      <Button
        label={showing ? "Hide verification details" : "View verification details"}
        variant="quiet"
        onPress={() => setShowing((value) => !value)}
      />

      {showing ? (
        <View style={{ gap: space[1] }}>
          <Row term="Verification" value={`${verification.review_state_label}${verification.decided_at ? ` · ${on(verification.decided_at)}` : ""}`} />
          <Row term="Package checked" value="Property details, authority documents, photographs and amenities" />
          <Row
            term="What can change"
            value="Nothing. This property's details are fixed while the check stands — contact support if something here is genuinely wrong."
          />
        </View>
      ) : null}
    </Surface>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Type variant="label">{term.toUpperCase()}</Type>
      <Type variant="body">{value}</Type>
    </View>
  );
}
