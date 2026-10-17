"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { AuthLink } from "@/components/auth/AuthDialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { resolveWebEntry } from "@/lib/navigation";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/**
 * The public site's header, and only that.
 *
 * Everything an account can do lives in the portal shell. What remains here is
 * what an unauthenticated visitor needs: the brand, the few places worth
 * reading before signing up, and a way in. A signed-in visitor who lands on a
 * public page is offered the way back to their portal, because they arrived
 * from a link and almost certainly want to return.
 *
 * The bar is transparent over the hero and grows a background and a hairline
 * once the page moves. A header that is already opaque at the top puts a band
 * of chrome between the reader and the first thing they came to see; one that
 * never becomes opaque leaves white text sitting on whatever scrolls under it.
 */

/**
 * One place to go and one way in (owner, 2026-09-29). Finding a property needs
 * no account, so it is a link; everything else starts at the login page, where
 * the landing page's two doors — renting or managing — carry the workspace.
 */
const LINKS = [
  { href: "/rentals", label: "Find Property" },
] as const;

export function SiteNav() {
  const { state } = useSession();
  /**
   * Signed in, or not yet known.
   *
   * The way in is shown for both. `/me/` can take seconds on a slow connection,
   * and this used to render the auth branch only on a confirmed `signed_out` —
   * so for the whole of that wait the public header had an empty right-hand
   * side and no way to sign in or register at all. Being briefly offered a
   * "Sign in" you did not need costs nothing; being offered nothing is the bar
   * looking broken on the one page a stranger loads cold.
   */
  const me = state.status === "signed_in" ? state.me : null;
  const pathname = usePathname();
  const [lifted, setLifted] = useState(false);
  const [open, setOpen] = useState(false);


  /**
   * Whether the page has moved off the top.
   *
   * A plain passive listener rather than Motion's scroll tracking: this is one
   * boolean crossing one threshold, and the state is only ever set when the
   * answer actually changes, so the common case is a listener that does a
   * comparison and returns. `passive` matters on touch — a non-passive scroll
   * handler blocks the browser from starting the scroll until it has run.
   */
  useEffect(() => {
    const read = () => {
      const next = window.scrollY > 12;
      setLifted((current) => (current === next ? current : next));
    };
    read(); // The page can be restored mid-scroll on a back navigation.
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);

  return (
    /*
     * Deliberately not animated in.
     *
     * This used to slide down from `y: -72` on mount. Motion writes that
     * starting transform into the server-rendered HTML, so until hydration
     * lands the site's primary navigation sits three-quarters off the top of
     * the screen — and if the JavaScript is slow or never arrives, it stays
     * there. A quarter-second of delight is not worth putting the way out of
     * the page behind a script on a metered connection. The chrome is simply
     * present; the content below it is what animates.
     */
    <header className="site-header sticky top-0 z-50 px-4 pt-4 sm:px-6">
      {/*
        Two sides: the brand, and the two things the bar offers — Find Property
        and Get started — together on the right, as a pair of buttons rather
        than a link floating alone in the middle (owner, 2026-09-29). A phone
        folds both into the drawer.
      */}
      <div
        className={cn(
          "mx-auto flex h-16 w-full max-w-[68rem] items-center justify-between gap-4",
          "rounded-full border border-border bg-background/80 px-2 backdrop-blur-xl",
          "transition-[background-color,border-color,box-shadow] duration-300",
          // Only once the page has moved. At rest the pill is nearly weightless,
          // which keeps the hero the first thing seen rather than the chrome
          // above it.
          lifted && "bg-background/94 shadow-[0_10px_30px_-14px_oklch(0.17_0.014_165/0.22)]",
        )}
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 justify-self-start rounded-full pl-3 font-display text-[1.0625rem] font-extrabold tracking-[-0.03em] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-brand font-display text-[0.6875rem] font-extrabold text-brand-foreground"
          >
            DH
          </span>
          <span className="whitespace-nowrap">Danpa HQ</span>
        </Link>

        {/* Both things this bar offers sit together on the right, where the eye
            expects the way in (owner, 2026-09-29). */}
        <nav aria-label="Primary" className="ml-auto flex items-center gap-2">
          {LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Button
                key={link.href}
                asChild
                variant="outline"
                size="lg"
                className={cn(
                  "hidden rounded-full border-border bg-background/70 px-5 font-semibold sm:inline-flex",
                  active && "border-brand/40 text-brand",
                )}
              >
                <Link href={link.href as never} aria-current={active ? "page" : undefined}>
                  <Search className="size-4 text-brand" />
                  {link.label}
                </Link>
              </Button>
            );
          })}
          {me ? (
            <Button asChild size="lg" className="hidden sm:inline-flex">
              <Link href={resolveWebEntry(me) as never}>Go to your portal</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="lg" className="hidden rounded-full bg-brand px-6 text-brand-foreground hover:bg-brand/90 sm:inline-flex">
                {/* Get started asks how you will use Danpa HQ (owner, 2026-10-07). */}
                <AuthLink view="register">
                  Get started
                  <ArrowRight className="size-4" />
                </AuthLink>
              </Button>
            </>
          )}

        </nav>
        <div className="flex items-center sm:hidden">
          {/* The rail becomes a drawer rather than shrinking. A row of nav links
              squeezed onto a 360px phone is three unreadable targets. */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-lg" className="rounded-full" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[19rem] gap-0">
              <SheetHeader>
                <SheetTitle className="font-display text-lg font-extrabold tracking-[-0.03em]">
                  Danpa HQ
                </SheetTitle>
              </SheetHeader>
              <nav aria-label="Primary" className="grid gap-1 px-4">
                {LINKS.map((link) => (
                  <SheetClose asChild key={link.href}>
                    <Link
                      href={link.href as never}
                      className="rounded-lg px-3 py-3 text-base font-medium text-foreground transition-colors hover:bg-accent"
                    >
                      {link.label}
                    </Link>
                  </SheetClose>
                ))}
              </nav>
              <div className="mt-auto grid gap-2 border-t border-border p-4">
                {me ? (
                  <SheetClose asChild>
                    <Button asChild size="lg">
                      <Link href={resolveWebEntry(me) as never}>Go to your portal</Link>
                    </Button>
                  </SheetClose>
                ) : (
                  <SheetClose asChild>
                    <Button asChild size="lg">
                      <AuthLink view="register">Get started</AuthLink>
                    </Button>
                  </SheetClose>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

/** Kept so nothing that imported the old name has to change. */
export { SiteNav as Nav };
