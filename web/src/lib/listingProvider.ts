import type { ListingDetail } from "./listings";
import type { TrustState } from "./trust";

const CATEGORY_LABELS: Record<string, string> = {
  individual_owner: "Individual property owner",
  property_company: "Property company",
  property_manager: "Property management company",
  hostel_operator: "Student hostel operator",
};

/** Only the public credential allowlist belongs here; no private Passport fetch. */
export function listingProvider(listing: ListingDetail) {
  const providers = (listing.provider_passports ?? []).filter(provider => provider.verified).map(provider => ({
    ...provider,
    categoryLabel: CATEGORY_LABELS[provider.category] ?? "Property provider",
  }));
  const identity = listing.trust_stamps.identity.state;
  const relationship = listing.trust_stamps.relationship === "owner"
    ? "Listed by its owner" : "Listed by an authorized representative";
  const checks: { label: string; icon: "verification" | "portfolio" | "home" | "units"; state: TrustState; status?: string }[] = [
    { label: "Identity", icon: "verification", state: identity },
    {
      // Only this category guarantees a registration and business evidence.
      label: providers.length > 0 && providers.every(provider => provider.category === "property_company")
        ? "Business credentials" : "Provider credentials",
      icon: "portfolio", state: providers.length ? "verified" : "unverified",
      ...(!providers.length ? { status: "Not published" } : {}),
    },
    { label: "Property authorization", icon: "home", state: listing.property_context.authority.state },
    { label: "Rental unit", icon: "units", state: listing.space.verification.checked ? "verified" : "unverified" },
  ];
  return { providers, identity, relationship, checks };
}
