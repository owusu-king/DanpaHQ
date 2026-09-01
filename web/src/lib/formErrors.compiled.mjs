/* Test-only JS mirror of formErrors.ts, kept in step by src/lib/formErrors.test.mjs.
   Node runs .mjs with no build step; formErrors.ts is the file that ships.

   ApiFailure is redeclared here rather than imported, because api.ts pulls in
   fetch and Next config that a plain `node --test` run has no business loading.
   The shape below is the part these helpers actually read. */
export class ApiFailure extends Error {
  constructor(error, status) {
    super(error.message);
    this.error = error;
    this.status = status;
    this.name = "ApiFailure";
  }
}

export function fieldErrorsFrom(cause) {
  if (!(cause instanceof ApiFailure)) return {};
  const fields = cause.error.details?.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};

  const result = {};
  for (const [field, value] of Object.entries(fields)) {
    const message = Array.isArray(value) ? value.join(" ") : String(value);
    if (message.trim()) result[field] = message.trim();
  }
  return result;
}

export function summaryErrorFrom(cause, fields) {
  if (!(cause instanceof ApiFailure)) return "Something went wrong. Try again.";
  return Object.keys(fields).length > 0 ? "" : cause.error.message;
}

export function isAccountExists(cause) {
  return (
    cause instanceof ApiFailure
    && cause.status === 409
    && cause.error.code === "ACCOUNT_EXISTS"
  );
}
