/**
 * What a Unit's private access code means to the provider holding it.
 *
 * The code is a possession secret: somebody who has it can ask to join this
 * verified space, and the provider still approves or rejects that request. It
 * is not an invitation token and it is not readable after it is issued — the
 * backend stores a peppered hash and returns the raw value exactly once.
 *
 * This module exists because the two clients said different things about the
 * same states, and because "when is this section worth showing at all" was
 * answered twice. A Unit that has never been checked does not need a card
 * explaining that it cannot have a code: its verification section already says
 * what is missing. What is worth saying is the case where everything *is*
 * verified and one specific thing still blocks sharing.
 *
 * The twin of `mobile/src/accessCodeMeaning.ts`; a mirror test keeps the two
 * identical below the header comment.
 */

export type AccessCodeState = "unavailable" | "not_created" | "active" | "expired" | "revoked";

export type AccessCodeLike = {
  state: AccessCodeState;
  expires_at: string | null;
  can_rotate: boolean;
  can_revoke: boolean;
  /** False for somebody who may read the Unit but not share it. */
  can_manage?: boolean;
};

export type PrivateAccess = {
  /** Whether the section belongs on this screen at all. */
  show: boolean;
  headline: string;
  detail: string;
  /** The label for creating or replacing, when either is possible. */
  primary: string | null;
  canRevoke: boolean;
  /** Whether a freshly issued code is worth keeping on screen. */
  tone: "active" | "idle" | "blocked";
};

/**
 * Whether to show the section, and what it should say.
 *
 * `verified` and `occupied` come from the Unit's own condition and availability
 * — the two facts that decide whether a code is possible at all.
 */
export function privateAccess(
  code: AccessCodeLike,
  context: { verified: boolean; occupied: boolean },
): PrivateAccess {
  const hidden: PrivateAccess = {
    show: false,
    headline: "",
    detail: "",
    primary: null,
    canRevoke: false,
    tone: "blocked",
  };

  // Nothing to manage, nothing to explain: a reader who cannot share this space
  // does not need to be told it has a sharing mechanism.
  if (code.can_manage === false) return hidden;

  if (code.state === "unavailable") {
    // An unchecked Unit is not a blocked one — it simply has not got there yet,
    // and its verification section already says so.
    if (!context.verified) return hidden;
    return {
      show: true,
      headline: context.occupied ? "Not while someone lives here" : "Not available yet",
      detail: context.occupied
        ? "End the tenancy to share it again."
        : "Property and Unit must stay verified.",
      primary: null,
      canRevoke: false,
      tone: "blocked",
    };
  }

  const expiry = code.expires_at ? `Expires ${onDay(code.expires_at)}. ` : "";

  if (code.state === "active") {
    return {
      show: true,
      headline: "A code is active",
      detail: `${expiry}Shown once, never stored.`,
      primary: code.can_rotate ? "New code" : null,
      canRevoke: code.can_revoke,
      tone: "active",
    };
  }

  const headline =
    code.state === "expired"
      ? "The code expired"
      : code.state === "revoked"
        ? "The code was revoked"
        : "No code yet";

  return {
    show: true,
    headline,
    detail: "Lets someone ask to join. You approve.",
    primary: code.can_rotate ? (code.state === "not_created" ? "Create code" : "New code") : null,
    canRevoke: false,
    tone: "idle",
  };
}

/** What to say the moment a code has been issued, while it is still on screen. */
export function issuedNotice(code: AccessCodeLike): { title: string; body: string } {
  return {
    title: "Copy this now — it is shown once",
    body: code.expires_at
      ? `Danpa HQ does not store the readable value. It expires ${onDay(code.expires_at)}.`
      : "Danpa HQ does not store the readable value.",
  };
}

function onDay(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "automatically";
  return at.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
