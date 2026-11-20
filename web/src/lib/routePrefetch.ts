"use client";

/**
 * Start a provider screen's reads as soon as someone shows intent to open it.
 *
 * Each entry calls the same loaders, with the same arguments, that the screen
 * calls when it mounts, so the request paths match by construction and the
 * screen receives responses that are already on their way. See
 * `prefetchReads` in `auth.ts` for how long and how often they may be used.
 */

import { prefetchReads } from "@/lib/auth";
import {
  countOpenApplications,
  getHostViewingAgenda,
  getOrganizationHome,
  getOrganizationPortfolio,
  getOrganizationTenancyRequests,
  getPortfolioContracts,
  listGrantedLeases,
  listHostViewings,
  listNotificationHistory,
  listOrganizationProperties,
  listPortfolioUnits,
  listProperties,
  listPropertyExpenses,
  listReceivedApplications,
} from "@/lib/console";
import { listOrganizationMaintenance } from "@/lib/maintenance";

const PROVIDER_READS: Record<string, (organization: string) => void> = {
  "/home": (organization) => {
    const scope = { organization };
    void getOrganizationHome(organization);
    void listOrganizationProperties(organization);
    void countOpenApplications(scope);
    void getHostViewingAgenda(scope);
    void listGrantedLeases(scope);
  },
  "/properties": (organization) => void listProperties({ organization }),
  "/units": (organization) => void listPortfolioUnits(organization),
  "/tenants": (organization) => void getOrganizationPortfolio(organization),
  "/documents": (organization) => void getPortfolioContracts(organization),
  "/payments": (organization) => {
    void getOrganizationPortfolio(organization, "finance");
    void listOrganizationProperties(organization);
    void listPropertyExpenses(organization);
  },
  "/applications": (organization) => {
    const scope = { organization };
    void listReceivedApplications(false, scope);
    void listGrantedLeases(scope);
    void getOrganizationTenancyRequests(organization);
  },
  "/viewings": (organization) => void listHostViewings(false, { organization }),
  "/maintenance": (organization) => void listOrganizationMaintenance(organization),
  "/updates": () => void listNotificationHistory(),
};

const recent = new Map<string, number>();

/** Prefetch the reads behind `href` for the Portfolio in `activeContext`, if known. */
export function prefetchProviderRoute(href: string, activeContext: string | null | undefined) {
  const reads = PROVIDER_READS[href];
  if (!reads || !activeContext?.startsWith("organization:")) return;
  // Hovering back and forth should not repeat the work every time.
  const key = `${activeContext}|${href}`;
  const now = Date.now();
  if (now - (recent.get(key) ?? 0) < 2_000) return;
  recent.set(key, now);
  const organization = activeContext.slice("organization:".length);
  prefetchReads(() => reads(organization));
}
