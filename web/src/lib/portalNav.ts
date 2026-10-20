import type { IconName } from "@/components/portal/icons";
import type { PortfolioAccess } from "@/lib/console";
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
 * The provider workspace is not "a provider account" — it is an *approved* one,
 * or a Portfolio somebody was invited into. Someone still under review gets a
 * portal with the review in it and no operational sections, because every one
 * of them would refuse.
 *
 * `access` is the Portfolio context the person is looking at, and it decides
 * which of the operational sections are theirs. It comes from the backend
 * whole: an accountant is not offered Properties because the backend says their
 * role does not operate Properties, not because this file knows what an
 * accountant is.
 */
export function portalSections(
  me: Me,
  portfolioName?: string | null,
  access?: PortfolioAccess | null,
): PortalSection[] {
  const provider = me.capabilities.provider;
  const inProvider =
    me.capabilities.active_workspace === "provider"
    && (provider.workspace_access || provider.exists);

  // The artisan experience: four places and no others. An artisan sees the work
  // they were invited to or given, never a tenant, property or request beyond it.
  // Updates stays in the top bar for them, as for everyone.
  if (me.capabilities.active_workspace === "artisan" && me.capabilities.artisan.workspace_access) {
    return [
      {
        items: [
          { href: "/home", label: "Home", icon: "home", hint: "Invitations, jobs and what needs you" },
          { href: "/artisan/requests", label: "Requests", icon: "receipt", hint: "Quote invitations and your quotes" },
          { href: "/artisan/jobs", label: "Jobs", icon: "wrench", hint: "Accepted work and its history" },
          { href: "/artisan/profile", label: "My Profile", icon: "hammer", hint: "Trades, area, work photos and certificates" },
        ],
      },
    ];
  }

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
    // No Portfolio context yet (an approved provider before their first one)
    // means nothing to scope by, and the whole workspace is theirs.
    const operates = access ? access.can.operate_properties : true;
    const finances = access ? access.can.view_finances : true;
    const portfolio: PortalItem[] = [
      ...(operates
        ? ([
          { href: "/properties", label: "Properties", icon: "properties", hint: "Buildings and their Units" },
          { href: "/units", label: "Units", icon: "units", hint: "Every rentable space in the Portfolio" },
          { href: "/tenants", label: "Tenants", icon: "users", hint: "Access, requests, tenancies and rent" },
          { href: "/documents", label: "Documents", icon: "leases", hint: "Contracts, terms templates and leases" },
        ] as PortalItem[])
        : []),
      ...(finances
        ? ([{ href: "/payments", label: "Payments", icon: "payments", hint: "Rent balances and payment records" }] as PortalItem[])
        : []),
    ];
    return [
      { items: [{ href: "/home", label: "Home", icon: "home" }] },
      // Named after the Portfolio being operated, so the rail answers "what am
      // I managing" without anyone having to open a menu to check.
      ...(portfolio.length
        ? [{ title: portfolioName?.trim() || "Portfolio", items: portfolio }]
        : []),
      ...(operates
        ? [{
          title: "Requests",
          items: [
            { href: "/applications", label: "Tenancy requests", icon: "applications", hint: "Review people asking to rent" },
            { href: "/viewings", label: "Viewings", icon: "viewings", hint: "Requests to see a place" },
            { href: "/maintenance", label: "Maintenance", icon: "wrench", hint: "Repairs your tenants report" },
          ] as PortalItem[],
        }]
        : []),
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
        { href: "/maintenance", label: "Maintenance", icon: "wrench", hint: "Report a problem where you live" },
      ],
    },
    // The tenant's own record, beside Updates: it belongs to the person, not
    // to any one rental, and it is what they take to the next landlord.
    {
      ...ACCOUNT_SECTION,
      items: [
        { href: "/passport", label: "Passport", icon: "passport", hint: "Your verified housing record" },
        ...ACCOUNT_SECTION.items,
      ],
    },
  ];
}

/**
 * Enquiries, as the top bar's Support button reaches them.
 *
 * They are conversations rather than a place to work through, so they left the
 * rail for the header. Who may reach them is unchanged from when they were a
 * rail item: a tenant always (the properties they asked to buy), a provider
 * only once approved and only where their Portfolio role operates Properties
 * (the questions about properties they sell), and nobody still in review.
 * `as` is the side of the conversation the list is read from.
 */
export function enquiriesEntry(
  me: Me,
  access?: PortfolioAccess | null,
): { href: "/enquiries"; as: "buyer" | "seller" } | null {
  const provider = me.capabilities.provider;
  const inProvider =
    me.capabilities.active_workspace === "provider"
    && (provider.workspace_access || provider.exists);
  if (me.capabilities.active_workspace === "artisan") return null;
  if (inProvider && !provider.workspace_access) return null;
  if (inProvider) {
    const operates = access ? access.can.operate_properties : true;
    return operates ? { href: "/enquiries", as: "seller" } : null;
  }
  return { href: "/enquiries", as: "buyer" };
}

/**
 * The Artisans button in the top bar: the one way into the artisan network for
 * somebody who rents or manages property. Not offered inside the artisan
 * experience (that is where the work arrives, not where it is found) or to a
 * provider still in review, whose workspace has nothing to hire for yet.
 */
export function artisansEntry(me: Me): boolean {
  const workspace = me.capabilities.active_workspace;
  if (workspace === "artisan") return false;
  if (workspace === "provider") return me.capabilities.provider.workspace_access;
  return true;
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
  // A tenant's own tenancy is one of their homes, reached from Home; it has no
  // rail entry of its own, so it lights Home rather than falling to "Portal".
  const recordOwner: Record<string, string> = {
    "/record/application": "/applications",
    "/record/apply": "/applications",
    "/record/lease": "/leases",
    "/record/lease-new": "/leases",
    "/record/payment": "/payments",
    "/record/payment-checkout": "/payments",
    "/record/payment-return": "/payments",
    "/record/payout-account": "/payments",
    "/record/receipt": "/payments",
    "/record/property": "/properties",
    "/record/property-new": "/properties",
    "/record/property-setup": "/properties",
    "/record/property-spaces": "/properties",
    "/record/property-verify": "/properties",
    "/record/space": "/properties",
    "/record/space-listing": "/properties",
    "/record/space-new": "/properties",
    "/record/tenant": "/tenants",
    "/record/tenancy": "/home",
    "/record/viewing": "/viewings",
  };
  pathname = recordOwner[pathname] ?? pathname;
  if (pathname.startsWith("/tenancies/")) pathname = "/home";
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
  "/passport",
  "/viewings",
  "/maintenance",
  "/artisan",
  "/enquiries",
  "/documents",
  "/organization",
  "/tenant",
  "/review",
  "/onboarding",
  "/choose-role",
  "/record/application",
  "/record/apply",
  "/record/enquiry",
  "/record/lease",
  "/record/lease-new",
  "/record/payment",
  "/record/payment-checkout",
  "/record/payment-return",
  "/record/payout-account",
  "/record/receipt",
  "/record/property",
  "/record/property-new",
  "/record/property-setup",
  "/record/property-spaces",
  "/record/property-verify",
  "/record/space",
  "/record/space-listing",
  "/record/space-new",
  "/record/tenancy",
  "/record/tenant",
  "/record/viewing",
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
    || pathname.startsWith("/sales/")
    || pathname === "/record/listing"
    || pathname === "/record/sale"
  );
}
