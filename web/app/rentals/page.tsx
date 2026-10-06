"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ListingBrowser } from "@/components/listings/ListingBrowser";
import { AllBrowser } from "@/components/explore/AllBrowser";
import { SaleBrowser } from "@/components/sales/SaleBrowser";
import { Reveal } from "@/components/motion/Reveal";
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
 *
 * The search is read from the address bar, so the browser sits in a Suspense
 * boundary: a statically rendered page that reads search params without one
 * fails the production build.
 */
export default function RentalsPage() {
  const { state } = useSession();

  if (state.status === "signed_in") {
    return (
      <>
        <Suspense fallback={<ExploreFallback />}>
          <Explore />
        </Suspense>
      </>
    );
  }

  return (
    /* `lp-light` carries the same green blooms as the landing page, so arriving
       here from the hero does not feel like crossing into a different product.
       The wash is pulled up behind the floating header the way the landing page
       does it — the header is sticky and sits before <main> in flow, so without
       this there is a bare strip above the title. */
    <div className="lp-light -mt-20 bg-background pt-20 text-foreground">
      <div className="relative mx-auto w-full max-w-[76rem] px-5 pt-8 pb-24 sm:px-8 lg:px-12 lg:pt-10">
        <span aria-hidden="true" className="lp-wash top-0 h-[26rem]" />

        {/* The page's own header and the search it introduces are one green
            piece (owner, 2026-09-29): this is its top, and the search tray
            below continues it without a seam — see `explore-hero.css`. */}
        <header className="explore-public-head">
          <Reveal y={12}>
            <span className="explore-public-chip">
              <span aria-hidden="true" />
              No account needed to look
            </span>
          </Reveal>

          <Reveal delay={0.06}>
            <h1>Find your next place</h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p>
              Every active listing comes from an approved property relationship,
              and every mark says what was checked.
            </p>
          </Reveal>
        </header>

        <Suspense fallback={<ExploreFallback />}>
          <Explore />
        </Suspense>
      </div>
    </div>
  );
}

/**
 * All, Rent or Buy. Explore opens on everything — rentals and properties for
 * sale together — and the console's Show chip narrows it to one side (owner,
 * 2026-10-05; it was a segmented bar fused to the search). Properties for sale
 * are their own search — sold whole, priced in the hundreds of thousands,
 * filtered by tenure — so Buy swaps the browser rather than adding filters to
 * Rent's (owner, 2026-09-28).
 */
function Explore() {
  const asked = useSearchParams().get("mode");
  if (asked === "buy") return <SaleBrowser />;
  if (asked === "rent") return <ListingBrowser />;
  return <AllBrowser />;
}

/** The tray's footprint while the search is read, so nothing jumps when it arrives. */
function ExploreFallback() {
  return <div className="explore-discovery explore-discovery-pending" aria-hidden="true" />;
}
