"use client";

import { usePathname } from "next/navigation";

import { Nav } from "@/components/Nav";
import { PortalShell } from "@/components/portal/PortalShell";
import { isPortalRoute, isSharedListingRoute } from "@/lib/portalNav";
import { SessionProvider, useSession } from "@/lib/session";

/**
 * Which chrome a route gets.
 *
 * Three surfaces, and the difference between them is the point of this file:
 *
 * - **Operations** (`/management`) brings its own shell and is not touched here.
 * - **The public site** — landing, listings, sign-in, register — is a website,
 *   and keeps the marketing header.
 * - **The portal** is software, and gets the application shell.
 *
 * The listing pages belong to both. A stranger browsing rentals is on the
 * public site; a signed-in tenant looking at the same page is in Explore, one
 * item of their own navigation. That is decided from the session rather than
 * the URL, which is what keeps a single listing implementation serving both
 * without a "public mode" concept existing anywhere.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith("/management")) {
    return children;
  }

  return (
    <SessionProvider>
      <ConsumerChrome pathname={pathname}>{children}</ConsumerChrome>
    </SessionProvider>
  );
}

/** Screens that carry their own full-page layout and want no header at all. */
const BARE = ["/sign-in", "/register", "/forgot-password", "/restricted"];

function ConsumerChrome({
  pathname,
  children,
}: {
  pathname: string;
  children: React.ReactNode;
}) {
  const { state } = useSession();

  if (BARE.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return <main id="main">{children}</main>;
  }

  const signedIn = state.status === "signed_in";
  const inPortal = isPortalRoute(pathname) || (signedIn && isSharedListingRoute(pathname));

  // While /me/ is in flight on a portal route, render the shell rather than the
  // public header: flashing marketing chrome and then replacing it is worse
  // than a moment of empty rail, and the portal routes are behind a gate anyway.
  if (inPortal || (state.status === "loading" && isPortalRoute(pathname))) {
    return <PortalShell>{children}</PortalShell>;
  }

  return (
    <>
      <Nav />
      <main id="main">{children}</main>
    </>
  );
}
