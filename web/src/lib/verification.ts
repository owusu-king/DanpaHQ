/**
 * Condition verification: what a property or space must show, and what is left.
 *
 * The backend has been able to answer this since the named slots landed, and
 * nothing asked. "Verify this property" pointed at a page with no verification
 * on it, which is why clicking it appeared to do nothing at all.
 *
 * One shape for both subjects. A property and a rentable space are asked for
 * different photographs, but the flow is identical — see what is needed, add
 * photos against named slots, submit when nothing required is outstanding — and
 * writing it twice would guarantee the two drifted.
 */

import { authedFetch } from "./auth";
import { idempotentMutation } from "./api";

export type EvidenceSlot = {
  key: string;
  evidence_type: string;
  label: string;
  /** Said in the product's voice: why this particular photo is asked for. */
  why: string;
  required: boolean;
  group: string;
  accepts: string[];
  provided: boolean;
  /** What is in the slot, when something is — so it can be seen and undone. */
  file_id: string | null;
  preview_url: string | null;
  filename: string;
};

export type VerificationProgress = {
  policy_version: string;
  status: string;
  verification_id: string | null;
  /** True once a reviewer has been asked to look. */
  submitted: boolean;
  decision_note: string;
  required_total: number;
  required_outstanding: number;
  can_submit: boolean;
  slots: EvidenceSlot[];
  outstanding: EvidenceSlot[];
};

/** Whether this is a property review or a rentable-space one. */
export type Subject = "property" | "unit";

function base(subject: Subject, id: string): string {
  return subject === "property" ? `/record/property?id=${id}` : `/units/${id}`;
}

export function getVerification(subject: Subject, id: string) {
  return authedFetch<VerificationProgress>(`${base(subject, id)}/verification/`, {
    cache: "no-store",
  });
}

/**
 * Attach one uploaded file to one named slot.
 *
 * The slot key is checked against the policy server-side, so a client cannot
 * invent a requirement and have it stored as though it had been asked for.
 */
export function attachEvidence(
  subject: Subject,
  id: string,
  input: { slot_key: string; file_id: string },
) {
  return authedFetch<VerificationProgress>(`${base(subject, id)}/verification/evidence/`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Ask for a decision. Refused, naming what is missing, until it is complete. */
export function submitForReview(subject: Subject, id: string) {
  return authedFetch<VerificationProgress>(`${base(subject, id)}/verification/`, {
    method: "POST",
    body: JSON.stringify({}),
    ...idempotentMutation(),
  });
}

/**
 * Take one slot's photograph back down.
 *
 * The half that was missing since P3: `condition.detach` existed and nothing
 * exposed it, so a filled slot showed a flat "Added" with no control on it and
 * a wrong photograph could never be corrected. Refused once a reviewer has been
 * asked to look.
 */
export function removeEvidence(subject: Subject, id: string, slotKey: string) {
  return authedFetch<VerificationProgress>(`${base(subject, id)}/verification/evidence/`, {
    method: "DELETE",
    body: JSON.stringify({ slot_key: slotKey }),
  });
}
