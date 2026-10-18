/* Test-only JS mirror of the session failure rule in session.tsx, kept in step
   by src/lib/session.test.mjs. Node runs .mjs with no build step; session.tsx
   is the file that ships. */

/** Stand-in for ApiFailure: the mirror only needs the status. */
export class ApiFailure extends Error {
  constructor(status, code = "request_failed", details = {}) {
    super("api failure");
    this.status = status;
    this.error = { code, details };
  }
}

export function isRefusal(cause) {
  if (!(cause instanceof ApiFailure)) return false;
  if (cause.status === 401) {
    return ["signed_out", "not_authenticated", "authentication_failed"].includes(cause.error.code);
  }
  if (cause.status === 403) return cause.error.code === "permission_denied";
  return cause.status === 422
    && cause.error.code === "validation_failed"
    && Object.keys(cause.error.details).length === 0;
}

export function stateAfterFailure(cause, current) {
  if (isRefusal(cause)) return { status: "signed_out" };
  return current.status === "signed_in"
    ? { ...current, stale: true }
    : { status: "unavailable" };
}

export function shouldRestoreSession(requireSession, hint) {
  return requireSession || hint === "1";
}
