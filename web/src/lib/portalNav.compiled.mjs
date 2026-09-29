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
          { href: "/leases", label: "Leases", icon: "leases", hint: "Agreements you have granted" },
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
            { href: "/enquiries", label: "Buyer enquiries", icon: "chat", hint: "Questions about properties you are selling" },
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
        { href: "/enquiries", label: "Enquiries", icon: "chat", hint: "Properties you asked to buy" },
      ],
    },
    ACCOUNT_SECTION,
  ];
}

export function activeHref(sections, pathname) {
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
  "/viewings",
  "/enquiries",
  "/organization",
  "/tenant",
  "/review",
  "/onboarding",
  "/choose-role",
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
  );
}
