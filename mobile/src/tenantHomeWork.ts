/**
 * What the tenant's Home says beyond its lists (owner, 2026-10-06): how
 * urgent each waiting thing is, and the few readings worth acting on.
 *
 * Built like the provider's `dashboardWork.ts`, so both Homes speak alike: the
 * costliest move leads, and a highlight says what is true, what follows from
 * it, and where to act — with the share its corner arc draws.
 */

import type Ionicons from "@expo/vector-icons/Ionicons";

type IconName = keyof typeof Ionicons.glyphMap;

export type MoveTone = "danger" | "warning" | "calm";

/** Late rent and an agreement waiting cost the most to leave; a choice to make costs time; a refusal is news. */
export function moveTone(kind: string): MoveTone {
  if (kind === "rent_overdue" || kind === "agreement_offered") return "danger";
  if (kind === "viewing" || kind === "application") return "warning";
  return "calm";
}

export function moveIcon(kind: string): IconName {
  if (kind === "rent_overdue") return "alert-circle-outline";
  if (kind === "agreement_offered") return "document-text-outline";
  if (kind === "viewing") return "calendar-outline";
  if (kind === "application") return "reader-outline";
  return "key-outline";
}

/** Rent overdue leads, then an agreement, then the rest in the order they came. */
export function rankMoves<T extends { kind: string }>(items: T[]): T[] {
  const weight = (kind: string) => (kind === "rent_overdue" ? 0 : kind === "agreement_offered" ? 1 : 2);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => weight(a.item.kind) - weight(b.item.kind) || a.index - b.index)
    .map((row) => row.item);
}

export type TenantHighlight = {
  key: string;
  icon: IconName;
  tone: "kola" | "laterite" | "harmattan" | "lagoon";
  headline: string;
  line: string;
  act: string;
  share: number;
  tag: string;
  /** Which tenancy, when the act opens one. */
  tenancyId?: string;
  /** The home, or its rent account. */
  to: "tenancy" | "rent";
};

/** The rent the highlights read: the home whose rent comes first. */
export type RentInput = {
  tenancyId: string;
  name: string;
  amount: string | null;
  dueOn: string | null;
  overdue: boolean;
  owedMinor: number;
};

export type TermInput = {
  id: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  /** The Unit or room, as the home row names it. */
  name: string;
};

const DAY = 86_400_000;

/** Month N of M, from the start and end dates, read at `now`. */
export function termProgress(startsOn: string, endsOn: string, now: number) {
  const start = new Date(`${startsOn}T12:00:00`).getTime();
  const end = new Date(`${endsOn}T12:00:00`).getTime();
  const span = Math.max(1, end - start);
  const share = Math.max(0, Math.min(1, (now - start) / span));
  const months = Math.max(1, Math.round(span / (30.44 * DAY)));
  const month = Math.max(1, Math.min(months, Math.ceil(((now - start) / span) * months)));
  const daysLeft = Math.max(0, Math.round((end - now) / DAY));
  return { share, month, months, daysLeft };
}

/**
 * The readings, each with its consequence and a way to act on it, and only
 * those with something to say: where each home's agreement has got to — an
 * end close enough to plan around is said as such.
 */
export function tenantHighlights(input: {
  tenancies: TermInput[];
  /** The first home's rent, read from the ranked homes; null with no home. */
  rent?: RentInput | null;
  now: number;
  date: (iso: string) => string;
}): TenantHighlight[] {
  const rows: TenantHighlight[] = [];

  // Rent leads (owner, 2026-10-06): it is the thing a tenant cannot let slip,
  // and there is always something true to say about it — late, coming, or paid.
  const rent = input.rent;
  if (rent) {
    const dueIn = rent.dueOn ? Math.round((new Date(`${rent.dueOn}T12:00:00`).getTime() - input.now) / DAY) : null;
    if (rent.overdue && rent.dueOn) {
      rows.push({
        key: "rent", icon: "alert-circle-outline", tone: "laterite",
        headline: `Rent overdue since ${input.date(rent.dueOn)}`,
        line: `${rent.amount ?? "Rent"} for ${rent.name}. Pay it before it grows.`,
        act: "Pay rent", share: 1, tag: "Overdue", tenancyId: rent.tenancyId, to: "rent",
      });
    } else if (rent.dueOn && dueIn !== null) {
      const soon = dueIn <= 7;
      rows.push({
        key: "rent", icon: "calendar-outline", tone: soon ? "harmattan" : "kola",
        headline: dueIn <= 0 ? "Rent is due today" : `Rent due in ${dueIn} ${dueIn === 1 ? "day" : "days"}`,
        line: `${rent.amount ?? "Rent"} for ${rent.name}, on ${input.date(rent.dueOn)}.`,
        act: soon ? "Pay rent" : "See your rent",
        // The arc fills as the day comes, over the month before it.
        share: Math.max(0.04, 1 - Math.min(Math.max(dueIn, 0), 30) / 30),
        tag: soon ? "Due soon" : "Rent", tenancyId: rent.tenancyId, to: "rent",
      });
    } else {
      rows.push({
        // Money owed is never green or ticked: that reads as paid.
        key: "rent", icon: rent.owedMinor ? "wallet-outline" : "checkmark-circle-outline", tone: rent.owedMinor ? "harmattan" : "kola",
        headline: rent.owedMinor ? "Rent outstanding" : "You are paid up",
        line: rent.owedMinor ? `${rent.amount ?? "Something"} is owed on ${rent.name}.` : `Nothing is owed on ${rent.name}.`,
        act: rent.owedMinor ? "Pay rent" : "See your rent", share: rent.owedMinor ? 0.5 : 1, tag: rent.owedMinor ? "Owed" : "Paid up",
        tenancyId: rent.tenancyId, to: "rent",
      });
    }
  }

  for (const tenancy of input.tenancies.slice(0, 2)) {
    if (!tenancy.starts_on || !tenancy.ends_on) {
      rows.push({
        key: `term-${tenancy.id}`, icon: "home-outline", tone: "kola",
        headline: tenancy.status === "upcoming" ? `${tenancy.name} is coming up` : `Your home: ${tenancy.name}`,
        line: tenancy.status === "upcoming" ? "Your tenancy has not started yet." : "Its agreement, rent and repairs are in one place.",
        act: "See your home", share: tenancy.status === "upcoming" ? 0.1 : 0.5, tag: "Tenancy",
        tenancyId: tenancy.id, to: "tenancy",
      });
      continue;
    }
    if (tenancy.status !== "active") continue;
    const term = termProgress(tenancy.starts_on, tenancy.ends_on, input.now);
    const ending = term.daysLeft <= 60;
    rows.push(ending
      ? {
        key: `term-${tenancy.id}`,
        icon: "hourglass-outline",
        tone: "harmattan",
        headline: `Your agreement ends in ${term.daysLeft} ${term.daysLeft === 1 ? "day" : "days"}`,
        line: `${tenancy.name}, on ${input.date(tenancy.ends_on)}. Talk to your landlord about what comes next.`,
        act: "Plan ahead",
        share: term.share,
        tag: "Ending",
        tenancyId: tenancy.id,
        to: "tenancy",
      }
      : {
        key: `term-${tenancy.id}`,
        icon: "home-outline",
        tone: "kola",
        headline: `Month ${term.month} of ${term.months} at ${tenancy.name}`,
        line: `Your agreement runs to ${input.date(tenancy.ends_on)}.`,
        act: "See your home",
        share: term.share,
        tag: "Tenancy",
        tenancyId: tenancy.id,
        to: "tenancy",
      });
  }

  // How the applications went is not one of them: the half dial in the
  // Overview says it, and saying it twice was noise (owner, 2026-10-06).

  return rows;
}
