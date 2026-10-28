/** The same quiet robot identity in public and authenticated navigation. */
export function IntelMark() {
  return <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M16 8V4.5M5.5 29v-1a6 6 0 0 1 6-6h9a6 6 0 0 1 6 6v1" />
    <circle cx="16" cy="3" r="1" fill="currentColor" stroke="none" />
    <rect x="5.5" y="8" width="21" height="15" rx="7" fill="var(--intel-face, none)" />
    <path d="M3.5 13v5M28.5 13v5M14 16h4" />
    <circle cx="11" cy="16" r="2.5" /><circle cx="21" cy="16" r="2.5" />
    <circle cx="11" cy="16" r="1.1" fill="currentColor" stroke="none" /><circle cx="21" cy="16" r="1.1" fill="currentColor" stroke="none" />
  </svg>;
}
