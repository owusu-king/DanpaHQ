"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ChevronDown, Menu, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const LINKS = [
  { href: "/rentals", label: "Browse rentals" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#trust", label: "Verification" },
] as const;

/**
 * The two sides of the marketplace, and the two ways in.
 *
 * `workspace` is not decoration on the URL: sign-in reads it and calls
 * `chooseWorkspace`, so which link somebody follows decides which experience
 * they land in. Offering one undifferentiated "Sign in" makes the account pick
 * a side after authenticating, which is a decision it already had the answer to.
 */
const LOGINS = [
  {
    href: "/sign-in?workspace=tenant",
    icon: UserRound,
    label: "I'm a tenant",
    hint: "Find, apply and pay rent",
  },
  {
    href: "/sign-in?workspace=provider",
    icon: Building2,
    label: "I own or manage property",
    hint: "List and manage your units",
  },
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
    <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6">
      {/*
        Three columns: brand, links, actions.

        `1fr auto 1fr` rather than `grid-cols-3` — the outer tracks are equal, so
        the middle one is centred on the bar itself rather than on whatever the
        brand and the buttons happen to measure. Equal thirds would centre it
        too, but would also cap the links at a third of the width and wrap them
        the moment a label grows; here the middle track takes exactly what it
        needs and the sides split the rest.

        When the links are hidden the middle track collapses to nothing and the
        two remaining tracks resolve to a plain left/right bar.
      */}
      <div
        className={cn(
          "mx-auto grid h-16 w-full max-w-[68rem] grid-cols-[1fr_auto_1fr] items-center gap-4",
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
            GR
          </span>
          Ghana Rental
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 justify-self-center lg:flex">
          {LINKS.map((link) => {
            const active = link.href === "/rentals"
              ? pathname.startsWith("/rentals")
              : pathname === "/" && link.href.startsWith("/#");
            return (
              <Link
                key={link.href}
                href={link.href as never}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  active ? "text-brand" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 justify-self-end">
          {me ? (
            <Button asChild size="lg" className="hidden sm:inline-flex">
              <Link href={resolveWebEntry(me) as never}>Go to your portal</Link>
            </Button>
          ) : (
            <>
              {/* One trigger, two destinations. Two side-by-side buttons would
                  make the bar ask a question before anybody has decided they
                  want to sign in at all. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="lg" className="hidden rounded-full sm:inline-flex">
                    Sign in
                    <ChevronDown className="size-4 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    Sign in as
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {LOGINS.map(({ href, icon: Icon, label, hint }) => (
                    <DropdownMenuItem key={href} asChild className="gap-3 py-2.5">
                      <Link href={href as never}>
                        <Icon className="size-4 shrink-0" />
                        <span className="grid gap-0.5">
                          <span className="font-medium">{label}</span>
                          <span className="text-muted-foreground text-xs">{hint}</span>
                        </span>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button asChild size="lg" className="hidden rounded-full bg-brand px-6 text-brand-foreground hover:bg-brand/90 sm:inline-flex">
                <Link href="/register">Get started</Link>
              </Button>
            </>
          )}

          {/* The rail becomes a drawer rather than shrinking. A row of nav links
              squeezed onto a 360px phone is three unreadable targets. */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-lg" className="rounded-full lg:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[19rem] gap-0">
              <SheetHeader>
                <SheetTitle className="font-display text-lg font-extrabold tracking-[-0.03em]">
                  Ghana Rental
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
                  <>
                    <SheetClose asChild>
                      <Button asChild size="lg">
                        <Link href="/register">Get started</Link>
                      </Button>
                    </SheetClose>
                    <span className="text-muted-foreground px-1 pt-1 text-xs font-semibold tracking-wider uppercase">
                      Sign in as
                    </span>
                    {LOGINS.map(({ href, icon: Icon, label }) => (
                      <SheetClose asChild key={href}>
                        <Button asChild variant="outline" size="lg" className="justify-start gap-3">
                          <Link href={href as never}>
                            <Icon className="size-4" />
                            {label}
                          </Link>
                        </Button>
                      </SheetClose>
                    ))}
                  </>
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
