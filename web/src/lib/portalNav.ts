import type { IconName } from "@/components/portal/icons";
import type { Me } from "@/lib/session";

/**
 * What the portal offers this account, decided from `capabilities`.
 *
 * Pure and separately testable, because navigation is the one place where a
 * wrong answer is visible on every screen. It reads capabilities and nothing
 * else — never `account_type`, never a role name, never the URL. Those were how
 * the old nav decided, which meant a role an account had granted itself put the
 * provider console in the menu.
 *
 * To be clear about what this is for: hiding a link is a courtesy, not a
 * boundary. Every endpoint behind these links refuses the request on its own.
 */

export type PortalItem = {
  href: string;
  label: string;
  /** Carries the item when the rail is collapsed and labels are hidden. */
  icon: IconName;
  /** Second line in the slide-over, where there is room to explain. */
  hint?: string;
};

export type PortalSection = {
  /** Omitted for the first group, which needs no heading above it. */
  title?: string;
  items: PortalItem[];
};

/**
 * The provider workspace is not "a provider account" — it is an *approved* one.
 * Someone still under review gets a portal with the review in it and no
 * operational sections, because every one of them would refuse.
 */
export function portalSections(me: Me, portfolioName?: string | null): PortalSection[] {
  const provider = me.capabilities.provider;
  const inProvider = me.capabilities.active_workspace === "provider" && provider.exists;

  if (inProvider && !provider.workspace_access) {
    return [
      { items: [{ href: "/home", label: "Home", icon: "home" }] },
      {
        title: "Getting set up",
        items: [
          {
            href: "/provider",
            label: "Verification",
            icon: "verification",
            hint: "Where your provider review stands",
          },
        ],
      },
      ACCOUNT_SECTION,
    ];
  }

  if (inProvider) {
    return [
      { items: [{ href: "/home", label: "Home", icon: "home" }] },
      {
        // Named after the Portfolio being operated, so the rail answers "what am
        // I managing" without anyone having to open a menu to check.
        title: portfolioName?.trim() || "Portfolio",
        items: [
          { href: "/properties", label: "Properties", icon: "properties", hint: "Buildings and their Units" },
          { href: "/units", label: "Units", icon: "units", hint: "Every rentable space in the Portfolio" },
          { href: "/tenants", label: "Tenants", icon: "users", hint: "Access, requests, tenancies and rent" },
          { href: "/leases", label: "Leases", icon: "leases", hint: "Agreements you have granted" },
          { href: "/payments", label: "Payments", icon: "payments", hint: "Rent balances and payment records" },
        ],
      },
      {
        title: "Requests",
        items: [
          { href: "/applications", label: "Tenancy requests", icon: "applications", hint: "Review people asking to rent" },
          { href: "/viewings", label: "Viewings", icon: "viewings", hint: "Requests to see a place" },
        ],
      },
      ACCOUNT_SECTION,
    ];
  }

  // The tenant experience, and the one anonymous browsing resolves to once
  // there is an account behind it.
  return [
    { items: [{ href: "/home", label: "Home", icon: "home" }] },
    {
      title: "Renting",
      items: [
        { href: "/rentals", label: "Explore", icon: "explore", hint: "Find a place" },
        { href: "/saved", label: "Saved", icon: "saved", hint: "Your shortlist" },
        { href: "/applications", label: "Applications", icon: "applications", hint: "Places you have applied for" },
        { href: "/leases", label: "Agreements", icon: "leases", hint: "Offers waiting for your decision" },
        { href: "/payments", label: "Payments", icon: "payments", hint: "Rent due, payment activity and receipts" },
        { href: "/viewings", label: "Viewings", icon: "viewings", hint: "Times you arranged to visit" },
      ],
    },
    ACCOUNT_SECTION,
  ];
}

/**
 * Updates only. Account is deliberately absent: the avatar at the foot of the
 * rail is the one account control, and listing it here as well would be the
 * second competing menu the shell is meant to avoid.
 */
const ACCOUNT_SECTION: PortalSection = {
  title: "You",
  items: [
    { href: "/updates", label: "Updates", icon: "updates", hint: "Notifications" },
  ],
};

/**
 * Which nav item owns the current URL.
 *
 * Longest match wins, so `/properties/new` highlights Properties rather than
 * lighting up nothing, and `/home` does not claim every path beginning with a
 * slash. Exported for the test.
 */
export function activeHref(sections: PortalSection[], pathname: string): string | null {
  let best: string | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (best === null || item.href.length > best.length)) {
        best = item.href;
      }
    }
  }
  return best;
}

/**
 * Routes that belong to the authenticated portal rather than the public site.
 *
 * `/rentals` and `/listings` are deliberately absent: they are the shared
 * listing experience and belong to whichever chrome the visitor is already in —
 * public site for a stranger, portal for a signed-in tenant. The shell decides
 * that from the session, not from the path.
 */
const PORTAL_PREFIXES = [
  "/home",
  "/settings",
  "/apply",
  "/applications",
  "/leases",
  "/payments",
  "/properties",
  "/units",
  "/provider",
  "/saved",
  "/tenancies",
  "/tenants",
  // Portfolio and Team are Settings panels now, covered by the "/settings"
  // prefix. This one stays: an invitee arrives on it from a secure link, and the
  // matcher is exact-or-slash so nothing else covers the hyphenated route.
  "/portfolio-invitations",
  "/updates",
  "/viewings",
  "/organization",
  "/tenant",
  "/review",
  "/onboarding",
  "/choose-role",
];

export function isPortalRoute(pathname: string): boolean {
  return PORTAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** The shared listing experience, which either chrome may host. */
export function isSharedListingRoute(pathname: string): boolean {
  return (
    pathname === "/rentals"
    || pathname.startsWith("/rentals/")
    || pathname.startsWith("/listings/")
  );
}
