"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useSession } from "@/lib/session";

import { LoadingRows, PageHeader } from "./PageHeader";

/**
 * What a portal route shows when there is nobody to show it to.
 *
 * The three answers are genuinely different and used to be one blank page:
 * every portal page returned `null` unless signed in, so a session that could
 * not be confirmed left the person on an empty screen with no rail, no message
 * and nothing to click.
 *
 * - **loading** — the shape of what is coming, so the page does not flash.
 * - **signed_out** — the server refused. Offer the way back in, and remember
 *   where they were so signing in returns them there.
 * - **unavailable** — we could not reach the service. They are very likely
 *   still signed in, so this must not say otherwise; it offers a retry.
 */
export function PortalGate() {
  const { state, refresh } = useSession();
  const pathname = usePathname();
  const [retrying, setRetrying] = useState(false);

  if (state.status === "loading") {
    return (
      <>
        <PageHeader title="Loading" />
        <LoadingRows rows={4} />
      </>
    );
  }

  if (state.status === "unavailable") {
    return (
      <div className="portal-gate">
        <h1>We could not reach the service</h1>
        <p>
          This is almost certainly a connection problem rather than anything to do
          with your account — you have not been signed out. Try again in a moment.
        </p>
        <div className="portal-gate-actions">
          <button
            type="button"
            className="portal-gate-button"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try { await refresh(); } finally { setRetrying(false); }
            }}
          >
            {retrying ? "Trying…" : "Try again"}
          </button>
          <Link href="/rentals" className="portal-gate-link">Browse rentals meanwhile</Link>
        </div>
      </div>
    );
  }

  // Signed out for real. `next` carries them back to the page they wanted.
  const next = encodeURIComponent(pathname);
  return (
    <div className="portal-gate">
      <h1>Sign in to continue</h1>
      <p>Your session has ended. Signing in again brings you straight back here.</p>
      <div className="portal-gate-actions">
        <Link href={`/sign-in?next=${next}` as never} className="portal-gate-button">
          Sign in
        </Link>
        <Link href="/rentals" className="portal-gate-link">Browse rentals</Link>
      </div>
    </div>
  );
}
