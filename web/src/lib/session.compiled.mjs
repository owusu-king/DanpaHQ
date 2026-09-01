/* Test-only JS mirror of the session failure rule in session.tsx, kept in step
   by src/lib/session.test.mjs. Node runs .mjs with no build step; session.tsx
   is the file that ships. */

/** Stand-in for ApiFailure: the mirror only needs the status. */
export class ApiFailure extends Error {
  constructor(status) {
    super("api failure");
    this.status = status;
  }
}

export function isRefusal(cause) {
  return cause instanceof ApiFailure && cause.status >= 400 && cause.status < 500;
}

export function stateAfterFailure(cause, current) {
  if (isRefusal(cause)) return { status: "signed_out" };
  return current.status === "signed_in"
    ? { ...current, stale: true }
    : { status: "unavailable" };
}
