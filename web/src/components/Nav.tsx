"use client";

import Link from "next/link";

import { useSession } from "@/lib/session";
import { resolveWebEntry } from "@/lib/navigation";

/**
 * The public site's header, and only that.
 *
 * It used to be the whole product's navigation: browse, updates, properties,
 * viewings, applications, leases, account and a workspace switcher, all in one
 * bar, on every screen. That made the authenticated experience feel like a
 * website with role pages bolted on — a signed-in landlord managing a building
 * was looking at the same chrome as a stranger reading the landing page.
 *
 * Everything an account can do now lives in the portal shell. What remains here
 * is what an unauthenticated visitor needs: the brand, and a way in. A signed-in
 * visitor who lands on a public page is offered the way back to their portal,
 * because they arrived here from a link and almost certainly want to return.
 */
export function Nav() {
  const { state } = useSession();
  const me = state.status === "signed_in" ? state.me : null;

  return (
    <nav
      aria-label="Primary"
      style={{
        borderBottom: "var(--border-hairline) solid var(--color-field-200)",
        background: "var(--color-field-0)",
      }}
    >
      <div
        style={{
          maxWidth: "72rem",
          margin: "0 auto",
          padding: "0 var(--space-5)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          minHeight: "var(--target-min)",
        }}
      >
        <Link
          href="/"
          className="type-body-strong"
          style={{ color: "var(--color-ink-900)", textDecoration: "none" }}
        >
          Ghana Rental
        </Link>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
          {me ? (
            <Link
              href={resolveWebEntry(me) as never}
              className="type-caption"
              style={{ color: "var(--color-kola-600)", fontWeight: 600 }}
            >
              Go to your portal →
            </Link>
          ) : state.status === "signed_out" ? (
            // Registering is offered by the landing page, which is where someone
            // without an account starts. Signing in is what a returning visitor
            // wants from any page, so it belongs in the bar.
            <Link href="/sign-in" className="type-caption" style={{ color: "var(--color-ink-900)" }}>
              Sign In
            </Link>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
