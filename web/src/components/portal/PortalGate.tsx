"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck, WifiOff } from "lucide-react";

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
 *   still signed in, so this must not say otherwise; it retries on its own.
 *
 * All of it sits on a surface now. It was a centred column of text floating in
 * a white page with no rail above it and no card under it, which is what a
 * crashed page looks like — so the screen that exists to say "nothing is
 * broken" was the most broken-looking screen in the product.
 */
export function PortalGate() {
  const { state, refresh } = useSession();
  const pathname = usePathname();

  if (state.status === "loading") {
    return (
      <>
        <PageHeader title="Loading" />
        <LoadingRows rows={4} />
      </>
    );
  }

  if (state.status === "unavailable") return <Unreachable refresh={refresh} />;

  // Signed out for real. `next` carries them back to the page they wanted.
  const next = encodeURIComponent(pathname);
  return (
    <div className="portal-gate">
      <article className="portal-gate-card">
        <span className="portal-gate-mark" data-tone="brand" aria-hidden="true">
          <KeyRound />
        </span>
        <h1>Sign in to continue</h1>
        <p>Your session has ended. Signing in again brings you straight back here.</p>
        <div className="portal-gate-actions">
          <Link href={`/sign-in?next=${next}` as never} className="portal-gate-button">
            Sign in
          </Link>
          <Link href="/rentals" className="portal-gate-link">Browse rentals</Link>
        </div>
      </article>
    </div>
  );
}

/**
 * How long to wait before trying again, per attempt.
 *
 * A connection that has just dropped is usually back within seconds, so the
 * first wait is short. After that it backs off: a phone on a dead cell has no
 * use for a request every five seconds, and the retries cost battery on exactly
 * the connection that is already struggling. It stops lengthening at half a
 * minute, because past that the screen stops feeling live.
 */
const BACKOFF = [5, 10, 20, 30] as const;

/**
 * The service is unreachable.
 *
 * It retries by itself, and says when. A lone "Try again" button makes getting
 * back in the reader's job, and the one thing they know for certain is that
 * pressing it a moment ago did not work — so most people press it twice and
 * leave. The countdown is the honest version: the page is already doing what
 * the button does, the button is there for anyone who has just fixed their
 * connection and does not want to wait out the clock.
 */
function Unreachable({ refresh }: { refresh: () => Promise<unknown> }) {
  const [attempt, setAttempt] = useState(0);
  const [seconds, setSeconds] = useState<number>(BACKOFF[0]);
  const [retrying, setRetrying] = useState(false);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
      // Whether it worked decides whether this component is still mounted. If
      // it is, the next wait is a longer one.
      setAttempt((count) => count + 1);
    }
  }, [refresh]);

  useEffect(() => {
    const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)]!;
    setSeconds(wait);
    let left = wait;
    const timer = setInterval(() => {
      left -= 1;
      setSeconds(left);
      if (left <= 0) {
        clearInterval(timer);
        void retry();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [attempt, retry]);

  return (
    <div className="portal-gate">
      <article className="portal-gate-card">
        <span className="portal-gate-mark" data-tone="warning" aria-hidden="true">
          <WifiOff />
        </span>
        <h1>We could not reach the service</h1>
        <p>
          This is almost certainly a connection problem rather than anything to do
          with your account. Check your network — we will keep trying from here.
        </p>

        {/* The one thing this screen exists to say, given its own surface so it
            cannot be skimmed past. Somebody who reads "could not reach the
            service" and nothing else assumes they have been logged out. */}
        <p className="portal-gate-reassure">
          <ShieldCheck aria-hidden="true" />
          <span>
            <strong>You have not been signed out.</strong>
            Nothing on your account has changed, and your details are safe.
          </span>
        </p>

        <div className="portal-gate-actions">
          <button
            type="button"
            className="portal-gate-button"
            disabled={retrying}
            onClick={() => void retry()}
          >
            {retrying ? "Trying…" : "Try again now"}
          </button>
          <Link href="/rentals" className="portal-gate-link">Browse rentals meanwhile</Link>
        </div>

        {/* `role="status"` rather than an alert: this is a progress report on
            something already under way, and a live region that interrupts once
            a second would be unusable with a screen reader. `aria-live="off"`
            on the counter itself keeps the ticking silent; the attempt line
            below is what actually gets announced. */}
        <p className="portal-gate-progress" role="status">
          <span className="portal-gate-dot" aria-hidden="true" />
          {retrying ? (
            "Trying again now…"
          ) : (
            <>
              <span aria-live="off">Trying again in {seconds}s</span>
              {attempt > 0 ? (
                <span className="portal-gate-attempts">
                  · {attempt} {attempt === 1 ? "attempt" : "attempts"} so far
                </span>
              ) : null}
            </>
          )}
        </p>
      </article>
    </div>
  );
}
