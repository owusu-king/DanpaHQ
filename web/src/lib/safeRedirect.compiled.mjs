/* Test-only JS mirror of safeRedirect.ts. */
export function safeInternalPath(value) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
}
