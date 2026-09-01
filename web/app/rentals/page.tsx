"use client";

import { ListingBrowser } from "@/components/listings/ListingBrowser";
import { PageHeader } from "@/components/portal/PageHeader";
import { useSession } from "@/lib/session";

/**
 * Rentals: the public listing page, and the portal's Explore.
 *
 * Same search, same cards, same endpoint — one implementation, because the
 * public page is the one that must never break and a second copy is how it
 * would. What changes is the framing. A stranger gets the marketing header and
 * the reassurance that no account is needed; a signed-in tenant gets a portal
 * page title, because they are already inside and being sold to at that point
 * is noise.
 *
 * The surrounding chrome is chosen by AppShell from the same session, so no
 * "public mode" flag exists anywhere for these two to disagree about.
 */
export default function RentalsPage() {
  const { state } = useSession();

  if (state.status === "signed_in") {
    return (
      <>
        <PageHeader
          title="Explore"
          description="Every active listing comes from an approved property relationship."
        />
        <ListingBrowser />
      </>
    );
  }

  return (
    <div style={{ maxWidth: "72rem", margin: "0 auto", padding: "var(--space-10) var(--space-5)" }}>
      <header style={{ maxWidth: "48rem", marginBottom: "var(--space-8)" }}>
        <p className="type-label" style={{ color: "var(--color-kola-600)" }}>VERIFIED RENTALS</p>
        <h1 className="type-display-1" style={{ margin: "var(--space-2) 0" }}>Find your next place</h1>
        <p className="type-body" style={{ color: "var(--color-ink-700)" }}>
          Browse without an account. Every active listing comes from an approved property relationship.
        </p>
      </header>
      <ListingBrowser />
    </div>
  );
}
