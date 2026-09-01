/** Accept only an absolute path on this site, never a protocol-relative URL. */
export function safeInternalPath(value: string | null): string | null {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : null;
}
