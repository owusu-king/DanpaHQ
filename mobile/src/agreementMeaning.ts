/**
 * What an agreement means to the tenant holding it.
 *
 * Higher consequence than an application, so this module is deliberately less
 * clever: it decides the standing, and it decides *which copy of the terms is
 * authoritative*. Nothing else.
 *
 * The second job matters more than it looks. A lease carries its terms twice —
 * once as live columns on the row, and once as the frozen snapshot inside the
 * executed agreement, whose canonical bytes produced the hash both parties
 * accepted. The snapshot is the one that answers "we agreed six months, not
 * twelve" eight months later, so it wins wherever it exists. Both screens used
 * to reach for `terms?.x ?? lease.x` field by field, fourteen times each, which
 * is fourteen chances for one screen to fall back where the other did not.
 *
 * The twin of `web/src/lib/agreementMeaning.ts`; a mirror test keeps the two
 * identical below the header comment.
 */

export type AgreementStage = "action" | "active" | "past";
export type AgreementFilter = "all" | AgreementStage;

export const agreementFilters: readonly { id: AgreementFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "action", label: "Needs you" },
  { id: "active", label: "Active" },
  { id: "past", label: "Past" },
];

export function matchesAgreementFilter(
  stage: AgreementStage,
  filter: AgreementFilter,
): boolean {
  return filter === "all" || stage === filter;
}

export type AgreementStanding = {
  stage: AgreementStage;
  /** Where it stands and what follows, in one line. */
  line: string;
  /** True only while the tenant may still accept or decline. */
  decisionOpen: boolean;
};

/** The shape both clients' `Lease` types satisfy. */
export type AgreementLike = {
  status: string;
  property_title: string;
  unit_label: string;
  bed_label: string | null;
  locality_name: string | null;
  landlord_name: string;
  tenant_name: string;
  rent_minor: number;
  rent_currency: string;
  rent_period: string;
  advance_months: number;
  deposit_months: number;
  agency_fee_months: number;
  move_in_total_minor: number;
  starts_on: string;
  ends_on: string | null;
  term_months: number;
  conditions: string;
  decline_reason: string;
  agreement: {
    terms?: {
      property?: { title?: string; address?: string };
      space?: { unit_label?: string; bed_label?: string | null };
      parties?: { landlord?: { name?: string }; tenant?: { name?: string } };
      money?: {
        rent_minor?: number;
        rent_currency?: string;
        rent_period?: string;
        advance_months?: number;
        deposit_months?: number;
        agency_fee_months?: number;
        move_in_total_minor?: number;
      };
      term?: { starts_on?: string | null; ends_on?: string | null; term_months?: number };
      conditions?: string;
    };
  } | null;
};

/**
 * Only `offered` is open to the tenant — `OPEN_TO_TENANT` in the backend
 * policies. Everything else is a state to be read, not answered.
 */
export function standing(lease: { status: string }): AgreementStanding {
  switch (lease.status) {
    case "offered":
      return { stage: "action", line: "Waiting for your decision", decisionOpen: true };
    case "tenant_accepted":
      return { stage: "active", line: "You accepted — provider confirmation needed", decisionOpen: false };
    case "awaiting_activation":
      return { stage: "active", line: "Accepted — starting soon", decisionOpen: false };
    case "active":
      return { stage: "active", line: "In place", decisionOpen: false };
    case "declined":
      return { stage: "past", line: "You declined this", decisionOpen: false };
    case "cancelled":
      return { stage: "past", line: "The landlord withdrew this", decisionOpen: false };
    case "ended":
      return { stage: "past", line: "Ended", decisionOpen: false };
    default:
      // `draft` never reaches a tenant: /me/leases/ excludes it.
      return { stage: "past", line: "Not sent", decisionOpen: false };
  }
}

export type AgreedTerms = {
  /** False for a lease offered before agreements were recorded. */
  frozen: boolean;
  propertyTitle: string;
  unitLabel: string;
  bedLabel: string | null;
  address: string;
  landlordName: string;
  tenantName: string;
  rentMinor: number;
  rentCurrency: string;
  rentPeriod: string;
  advanceMonths: number;
  depositMonths: number;
  agencyFeeMonths: number;
  moveInTotalMinor: number;
  startsOn: string | null;
  endsOn: string | null;
  termMonths: number;
  conditions: string;
};

/** The terms as agreed, preferring the frozen snapshot over the live row. */
export function agreedTerms(lease: AgreementLike): AgreedTerms {
  const terms = lease.agreement?.terms;
  const money = terms?.money;
  const term = terms?.term;
  return {
    frozen: Boolean(terms),
    propertyTitle: terms?.property?.title || lease.property_title,
    unitLabel: terms?.space?.unit_label ?? lease.unit_label,
    bedLabel: terms?.space?.bed_label ?? lease.bed_label,
    address: terms?.property?.address ?? "",
    landlordName: terms?.parties?.landlord?.name || lease.landlord_name,
    tenantName: terms?.parties?.tenant?.name || lease.tenant_name,
    rentMinor: money?.rent_minor ?? lease.rent_minor,
    rentCurrency: money?.rent_currency || lease.rent_currency || "GHS",
    rentPeriod: money?.rent_period || lease.rent_period,
    advanceMonths: money?.advance_months ?? lease.advance_months,
    depositMonths: money?.deposit_months ?? lease.deposit_months,
    agencyFeeMonths: money?.agency_fee_months ?? lease.agency_fee_months,
    moveInTotalMinor: money?.move_in_total_minor ?? lease.move_in_total_minor,
    startsOn: term?.starts_on ?? lease.starts_on,
    endsOn: term?.ends_on ?? lease.ends_on,
    termMonths: term?.term_months ?? lease.term_months,
    conditions: terms?.conditions ?? lease.conditions,
  };
}

/** Which home, in one line. */
export function homeOf(terms: AgreedTerms): string {
  const space = [terms.unitLabel, terms.bedLabel].filter(Boolean).join(" · ");
  return space ? `${terms.propertyTitle} — ${space}` : terms.propertyTitle;
}

/** Frozen money has no server-rendered string, so both clients format it here. */
export function money(minor: number, currency: string): string {
  const value = (minor / 100).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency === "GHS" ? "GH₵" : `${currency} `}${value}`;
}

export function months(count: number): string {
  return `${count} month${count === 1 ? "" : "s"}`;
}

/** The period as a tenant says it, not as the column stores it. */
export function per(period: string): string {
  return period === "yearly" ? "year" : "month";
}
