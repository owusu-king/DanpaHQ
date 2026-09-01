import { ApiFailure } from "@/api";

export type FieldErrors = Record<string, string>;

/**
 * Pull per-field messages out of an API failure.
 *
 * The backend reports form problems as `details.fields`, keyed by field name and
 * carrying every message for that field — the same shape DRF's own serializer
 * errors arrive in, so both go through here. A form that only ever showed
 * `error.message` next to the submit button left the person to work out which
 * of six inputs it was about.
 */
export function fieldErrorsFrom(cause: unknown): FieldErrors {
  if (!(cause instanceof ApiFailure)) return {};
  const fields = (cause.error.details as { fields?: unknown } | undefined)?.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};

  const result: FieldErrors = {};
  for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
    const message = Array.isArray(value) ? value.join(" ") : String(value);
    if (message.trim()) result[field] = message.trim();
  }
  return result;
}

/**
 * The message to show above the form: whatever the server said, unless it is a
 * bare summary of faults already shown on the fields themselves.
 */
export function summaryErrorFrom(cause: unknown, fields: FieldErrors): string {
  if (!(cause instanceof ApiFailure)) return "Something went wrong. Try again.";
  return Object.keys(fields).length > 0 ? "" : cause.error.message;
}

/**
 * The one failure a sign-up screen treats as an outcome rather than an error.
 *
 * The backend refuses `purpose="sign_up"` for a number that already has an
 * account, before any code is sent. Branching on the code rather than the
 * message keeps the two ends independent: the copy can change without silently
 * turning this back into a generic failure.
 */
export function isAccountExists(cause: unknown): boolean {
  return (
    cause instanceof ApiFailure
    && cause.status === 409
    && cause.error.code === "ACCOUNT_EXISTS"
  );
}

/**
 * The mirror of {@link isAccountExists}, on the recovery screen.
 *
 * There is nothing to reset for a number with no account, and the backend now
 * says so before sending anything. The answer is an offer to create an account,
 * not a red banner.
 */
export function isNoAccount(cause: unknown): boolean {
  return (
    cause instanceof ApiFailure
    && cause.status === 404
    && cause.error.code === "NO_ACCOUNT"
  );
}

/**
 * A tenant account asking for the provider experience.
 *
 * Also an outcome rather than an error: the answer is a screen saying they are
 * not a provider, with a way into their tenant space or out of the session.
 * Becoming a provider starts at registration.
 */
export function isNotAProvider(cause: unknown): boolean {
  return (
    cause instanceof ApiFailure
    && cause.status === 403
    && cause.error.code === "NOT_A_PROVIDER"
  );
}
