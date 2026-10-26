/**
 * What the browser tab says on each page: "Home | DanpaHQ" (owner,
 * 2026-10-25). Every page used to share "Danpa HQ — Verified rentals across
 * Ghana", so a row of tabs told a person nothing about which one was which.
 *
 * One table rather than a `metadata` export per route: nearly every page here
 * is a Client Component, which cannot export metadata, and eighty pass-through
 * layouts would scatter the names across the tree. `PageTitle` renders the
 * result. A record that knows its own name — a property, a passport holder —
 * replaces the generic one with `usePageTitle`.
 *
 * Names follow the navigation's own labels, so the tab and the link agree.
 */

export const BRAND = "DanpaHQ";

const TITLES: Record<string, string> = {
  "/": "Verified rentals across Ghana",

  // Signing in and getting started.
  "/sign-in": "Sign in",
  "/register": "Create account",
  "/forgot-password": "Reset password",
  "/choose-role": "Choose your role",
  "/onboarding": "Get started",
  "/welcome": "Welcome",
  "/restricted": "Account restricted",
  "/review": "Administration",

  // The workspaces.
  "/home": "Home",
  "/rentals": "Explore",
  "/saved": "Saved",
  "/applications": "Applications",
  "/viewings": "Viewings",
  "/leases": "Agreements",
  "/payments": "Payments",
  "/maintenance": "Maintenance",
  "/documents": "Documents",
  "/passport": "Passport",
  "/shared-passport": "Housing Passport",
  "/updates": "Updates",
  "/enquiries": "Danpa Intel",
  "/artisans": "Find artisans",
  "/properties": "Properties",
  "/units": "Units",
  "/units/new": "Add unit",
  "/tenants": "Tenants",
  "/provider": "Provider verification",
  "/portfolio-invitations": "Portfolio invitations",
  "/tenant/setup": "Join a home",

  // The artisan workspace.
  "/artisan": "Home",
  "/artisan/requests": "Requests",
  "/artisan/jobs": "Jobs",
  "/artisan/profile": "My profile",

  // One record at a time. A page that knows the record's name says it instead.
  "/record/application": "Application",
  "/record/apply": "Apply",
  "/record/enquiry": "Property interest",
  "/record/lease": "Agreement",
  "/record/lease-new": "New agreement",
  "/record/listing": "Listing",
  "/record/payment": "Payment",
  "/record/payment-checkout": "Checkout",
  "/record/payment-return": "Payment status",
  "/record/payout-account": "Settlement account",
  "/record/property": "Property",
  "/record/property-new": "New property",
  "/record/property-setup": "Property setup",
  "/record/property-spaces": "Units",
  "/record/property-verify": "Submit for verification",
  "/record/receipt": "Receipt",
  "/record/sale": "For sale",
  "/record/space": "Unit",
  "/record/space-new": "Add unit",
  "/record/space-listing": "Listing",
  "/record/tenancy": "Tenancy",
  "/record/tenant": "Tenant",
  "/record/viewing": "Viewing",

  // Settings.
  "/settings": "Your profile",
  "/settings/security": "Security",
  "/settings/notifications": "Notifications",
  "/settings/preferences": "Preferences",
  "/settings/verification": "Verification",
  "/settings/verification/identity": "Identity verification",
  "/settings/billing": "Plan & billing",
  "/settings/settlement": "Settlement account",
  "/settings/team": "Team",
  "/settings/archive": "Archive",

  // The Management console names itself after the page, as its tabs pile up.
  "/management": "Overview",
  "/management/login": "Sign in",
  "/management/users": "Users",
  "/management/providers": "Verification history",
  "/management/verifications": "Verification queue",
  "/management/properties": "Properties",
  "/management/listings": "Listings",
  "/management/rentals": "Rentals",
  "/management/artisans": "Artisans",
  "/management/payments": "Payments",
  "/management/billing": "Billing",
  "/management/support": "Support",
  "/management/reports": "Reports",
  "/management/audit-logs": "Audit log",
  "/management/account-deletions": "Account deletions",
  "/management/configuration": "Configuration",
  "/management/profile": "Your profile",
};

/** The page's own name, or null for an address the table does not know. */
export function pageName(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return TITLES[path] ?? null;
}

/** "Home | DanpaHQ", "Users | DanpaHQ Management", or the brand alone. */
export function documentTitle(pathname: string, name: string | null = pageName(pathname)): string {
  const brand = pathname === "/management" || pathname.startsWith("/management/") ? `${BRAND} Management` : BRAND;
  return name ? `${name} | ${brand}` : brand;
}
