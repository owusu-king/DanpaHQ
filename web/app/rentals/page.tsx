"use client";

import { Suspense } from "react";

import { ListingBrowser } from "@/components/listings/ListingBrowser";
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
          <ListingBrowser />
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
      <div className="relative px-5 pt-10 pb-8 sm:px-8 lg:px-12 lg:pt-14">
        <span aria-hidden="true" className="lp-wash top-0 h-[26rem]" />

        <div className="relative mx-auto w-full max-w-[76rem]">
          <Reveal y={12}>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
              No account needed to look
            </span>
          </Reveal>

          <Reveal delay={0.06}>
            <h1 className="mt-6 max-w-[18ch] font-display text-[clamp(2.25rem,4.6vw,3.5rem)] leading-[1.04] font-extrabold tracking-[-0.035em] text-balance">
              Find your next place
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mt-4 max-w-[54ch] text-lg leading-relaxed text-muted-foreground">
              Browse without an account. Every active listing comes from an approved
              property relationship, and every mark says what was checked.
            </p>
          </Reveal>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[76rem] px-5 pb-24 sm:px-8 lg:px-12">
        <Suspense fallback={<ExploreFallback />}>
          <ListingBrowser />
        </Suspense>
      </div>
    </div>
  );
}

/** The tray's footprint while the search is read, so nothing jumps when it arrives. */
function ExploreFallback() {
  return <div className="explore-discovery explore-discovery-pending" aria-hidden="true" />;
}
