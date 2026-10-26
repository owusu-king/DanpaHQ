import { apiFetch, idempotentMutation } from "@/api";

/**
 * Condition verification: what a property or space must show, and what is left.
 *
 * Mirrors `web/src/lib/verification.ts` against the same endpoints, deliberately
 * — a provider who starts photographing a building on their phone and finishes
 * on a laptop has to see the same checklist in the same state.
 *
 * One shape for both subjects. A property and a rentable space are asked for
 * different photographs, but the flow is identical: see what is needed, add
 * photos against named slots, submit when nothing required is outstanding.
 */

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

export type Subject = "property" | "unit";

function base(subject: Subject, id: string): string {
  return subject === "property" ? `/properties/${id}` : `/units/${id}`;
}

export function getVerification(subject: Subject, id: string) {
  return apiFetch<VerificationProgress>(`${base(subject, id)}/verification/`);
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
  return apiFetch<VerificationProgress>(`${base(subject, id)}/verification/evidence/`, {
    method: "POST",
    body: input,
  });
}

/** Ask for a decision. Refused, naming what is missing, until it is complete. */
export function submitForReview(subject: Subject, id: string) {
  return apiFetch<VerificationProgress>(`${base(subject, id)}/verification/`, {
    method: "POST",
    body: {},
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
  return apiFetch<VerificationProgress>(`${base(subject, id)}/verification/evidence/`, {
    method: "DELETE",
    body: { slot_key: slotKey },
  });
}
