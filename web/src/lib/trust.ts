/**
 * Shared trust vocabulary for the web console.
 *
 * The mapping from a verification state to what a person is told lives here so
 * that the reviewer console, the profile page and any future surface all say the
 * same words. Divergent labels for the same state are how a product starts
 * meaning different things in different places.
 */

export type TrustState = "verified" | "pending" | "unverified" | "expired";

export type TrustEntry = {
  state: TrustState;
  decided_at: string | null;
  expires_at: string | null;
  method: string;
};

export const STATE_LABEL: Record<TrustState, string> = {
  verified: "Verified",
  pending: "Check in progress",
  unverified: "Not checked",
  expired: "Check out of date",
};

export const KIND_LABEL: Record<string, string> = {
  phone: "Phone number",
  identity: "Identity (Ghana Card)",
  selfie_match: "Face matches ID",
  address: "Residential address",
  agency: "Agent licence",
  company: "Company registration",
  bank_account: "Bank or mobile money account",
  ownership: "Property ownership",
};

export function formatDecidedOn(value: string | null): string | undefined {
  if (!value) return undefined;
  return new Date(value).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * How long until a check lapses, phrased for a person rather than a system.
 * Returns null when there is nothing worth saying.
 */
export function expiryNotice(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "This check has lapsed and needs doing again.";
  if (days === 0) return "This check lapses today.";
  if (days <= 14) return `This check lapses in ${days} day${days === 1 ? "" : "s"}.`;
  return null;
}
