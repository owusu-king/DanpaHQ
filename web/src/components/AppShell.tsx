"use client";

import { usePathname } from "next/navigation";

import { AuthDialogProvider } from "@/components/auth/AuthDialog";
import { SiteNav } from "@/components/SiteNav";
import { ToastProvider } from "@/components/toast/Toaster";
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
      <ToastProvider>
        {/* Above the chrome, so the dialog survives the move from an old auth
            address to the front door, and from any page to the dashboard. */}
        <AuthDialogProvider>
          <ConsumerChrome pathname={pathname}>{children}</ConsumerChrome>
        </AuthDialogProvider>
      </ToastProvider>
    </SessionProvider>
  );
}

/** Screens that carry their own full-page layout and want no header at all. */
const BARE = ["/sign-in", "/register", "/welcome", "/forgot-password", "/restricted"];

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
    return <PortalShell key={state.status === "signed_in" ? state.me.id : "public"}>{children}</PortalShell>;
  }

  // A shared page whose session is still unknown: the public layout renders
  // (it is the right answer for a stranger, and what the server sent), but in
  // a wrapper the head script hides when this browser was last signed in — so
  // a refresh shows nothing for a moment rather than the wrong page.
  const pending = state.status === "loading" && isSharedListingRoute(pathname);
  const chrome = (
    <>
      <SiteNav />
      <main id="main">{children}</main>
    </>
  );
  return pending ? <div className="shared-pending">{chrome}</div> : chrome;
}
