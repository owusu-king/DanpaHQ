import { Suspense } from "react";

/**
 * Record pages read their identifier from the query string so one exported
 * HTML file can open any API-backed record. Keep that client-only read behind
 * a narrow boundary rather than turning the whole application shell into a
 * client-rendered fallback.
 */
export default function RecordLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="type-caption">Loading record…</p>}>
      {children}
    </Suspense>
  );
}
