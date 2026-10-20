/* Test-only JS mirror of portalNav.ts, kept in step by src/lib/portalNav.mirror.test.mjs.
   Node runs .mjs with no build step; portalNav.ts is the file that ships. */

const ACCOUNT_SECTION = {
  title: "You",
  items: [
    { href: "/updates", label: "Updates", icon: "updates", hint: "Notifications" },
  ],
};

export function portalSections(me, portfolioName, access) {
  const provider = me.capabilities.provider;
  const inProvider = me.capabilities.active_workspace === "provider"
    && (provider.workspace_access || provider.exists);

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
          { href: "/provider", label: "Verification", icon: "verification", hint: "Where your provider review stands" },
        ],
      },
      ACCOUNT_SECTION,
    ];
  }

  if (inProvider) {
    const operates = access ? access.can.operate_properties : true;
    const finances = access ? access.can.view_finances : true;
    const portfolio = [
      ...(operates
        ? [
          { href: "/properties", label: "Properties", icon: "properties", hint: "Buildings and their Units" },
          { href: "/units", label: "Units", icon: "units", hint: "Every rentable space in the Portfolio" },
          { href: "/tenants", label: "Tenants", icon: "users", hint: "Access, requests, tenancies and rent" },
          { href: "/documents", label: "Documents", icon: "leases", hint: "Contracts, terms templates and leases" },
        ]
        : []),
      ...(finances
        ? [{ href: "/payments", label: "Payments", icon: "payments", hint: "Rent balances and payment records" }]
        : []),
    ];
    return [
      { items: [{ href: "/home", label: "Home", icon: "home" }] },
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
          ],
        }]
        : []),
      ACCOUNT_SECTION,
    ];
  }

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
    {
      ...ACCOUNT_SECTION,
      items: [
        { href: "/passport", label: "Passport", icon: "passport", hint: "Your verified housing record" },
        ...ACCOUNT_SECTION.items,
      ],
    },
  ];
}

export function enquiriesEntry(me, access) {
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

export function activeHref(sections, pathname) {
  const recordOwner = {
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
  let best = null;
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

export function isPortalRoute(pathname) {
  return PORTAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isSharedListingRoute(pathname) {
  return (
    pathname === "/rentals"
    || pathname.startsWith("/rentals/")
    || pathname.startsWith("/listings/")
    || pathname.startsWith("/sales/")
    || pathname === "/record/listing"
    || pathname === "/record/sale"
  );
}

/**
 * The Artisans button in the top bar: the one way into the artisan network for
 * somebody who rents or manages property. Not offered inside the artisan
 * experience (that is where the work arrives, not where it is found) or to a
 * provider still in review, whose workspace has nothing to hire for yet.
 */
export function artisansEntry(me) {
  const workspace = me.capabilities.active_workspace;
  if (workspace === "artisan") return false;
  if (workspace === "provider") return me.capabilities.provider.workspace_access;
  return true;
}
