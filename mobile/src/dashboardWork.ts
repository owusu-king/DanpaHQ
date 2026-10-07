/**
 * What the provider's Home says, decided away from the screen (owner,
 * 2026-10-06): what to do next, in the order it costs the provider most to
 * leave it, and the few readings worth acting on.
 *
 * Home used to give every figure the same weight — a gauge, a ledger, a list
 * of counts each marked "Soon" — so the one thing that mattered had to be
 * found. Now one move leads, with the verb for it, and the rest wait under it.
 */

import type Ionicons from "@expo/vector-icons/Ionicons";

type IconName = keyof typeof Ionicons.glyphMap;

/** Money late or stuck, then what someone is waiting on, then what is merely unread. */
export type MoveTone = "danger" | "warning" | "calm";

export type Href = string | { pathname: string; params: Record<string, string> };

export type NextMove = {
  key: string;
  /** What is waiting, as a fact: "2 payment records to confirm". */
  title: string;
  /** The verb for the button when this move leads. */
  act: string;
  icon: IconName;
  tone: MoveTone;
  to: Href;
};

export type MoveInput = {
  overdueMinor: number;
  settlementAttentionMinor: number;
  recordsToConfirm: number;
  maintenanceAlerts: number;
  requests: number;
  viewingRequests: number;
  draftAgreements: number;
  propertiesToUpdate: number;
  unreadEnquiries: number;
  money: (minor: number) => string;
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * Every move waiting on the provider, most costly first. Late rent leads
 * because every day it waits is harder to collect; money stuck in payout is
 * the provider's own; a tenant's word about a payment, a repair, and a
 * request each have a person waiting; drafts, Property fixes and unread
 * buyers wait on nobody's clock but the provider's.
 */
export function nextMoves(input: MoveInput): NextMove[] {
  const moves: (NextMove | null)[] = [
    input.overdueMinor > 0
      ? { key: "overdue", title: `${input.money(input.overdueMinor)} overdue`, act: "Chase overdue rent", icon: "alert-circle-outline", tone: "danger", to: "/(app)/(provider-tabs)/payments" }
      : null,
    input.settlementAttentionMinor > 0
      ? { key: "payout", title: `${input.money(input.settlementAttentionMinor)} needs payout review`, act: "Review payouts", icon: "card-outline", tone: "danger", to: "/(app)/(provider-tabs)/payments" }
      : null,
    input.recordsToConfirm > 0
      ? { key: "records", title: `${input.recordsToConfirm} payment ${plural(input.recordsToConfirm, "record", "records")} to confirm`, act: "Confirm payments", icon: "wallet-outline", tone: "warning", to: "/(app)/(provider-tabs)/payments" }
      : null,
    input.maintenanceAlerts > 0
      ? { key: "repairs", title: `${input.maintenanceAlerts} ${plural(input.maintenanceAlerts, "repair", "repairs")} waiting`, act: "See repairs", icon: "construct-outline", tone: "warning", to: "/(app)/maintenance" }
      : null,
    input.requests > 0
      ? { key: "requests", title: `${input.requests} tenancy ${plural(input.requests, "request", "requests")}`, act: "Review requests", icon: "document-text-outline", tone: "warning", to: "/(app)/provider-applications" }
      : null,
    input.viewingRequests > 0
      ? { key: "viewings", title: `${input.viewingRequests} viewing ${plural(input.viewingRequests, "request", "requests")}`, act: "Set viewing times", icon: "calendar-outline", tone: "warning", to: "/(app)/provider-viewings" }
      : null,
    input.draftAgreements > 0
      ? { key: "drafts", title: `${input.draftAgreements} ${plural(input.draftAgreements, "agreement", "agreements")} to send`, act: "Send agreements", icon: "create-outline", tone: "calm", to: "/(app)/leases" }
      : null,
    input.propertiesToUpdate > 0
      ? { key: "properties", title: `${input.propertiesToUpdate} ${plural(input.propertiesToUpdate, "Property needs", "Properties need")} an update`, act: "Update Properties", icon: "shield-checkmark-outline", tone: "calm", to: "/(app)/(provider-tabs)/properties" }
      : null,
    input.unreadEnquiries > 0
      ? { key: "enquiries", title: `${input.unreadEnquiries} unread buyer ${plural(input.unreadEnquiries, "enquiry", "enquiries")}`, act: "Reply to buyers", icon: "chatbubbles-outline", tone: "calm", to: "/(app)/enquiries" }
      : null,
  ];
  return moves.filter((move): move is NextMove => move !== null);
}

/** A reading worth acting on: what it says, what follows from it, and where to act. */
export type Insight = {
  key: string;
  icon: IconName;
  tone: "kola" | "laterite";
  headline: string;
  line: string;
  act: string;
  to: Href;
  /** What the card's corner arc draws, from 0 to 1. */
  share: number;
  /** A word or two in the corner pill. */
  tag: string;
};

export type InsightInput = {
  units: number;
  occupied: number;
  vacant: number;
  /** The Portfolio's largest Property. */
  largest: { id: string; title: string; units: number; occupied: number } | null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The month a `YYYY-MM` period names, or the period as given. */
export function monthName(period: string): string {
  return MONTHS[Number(period.slice(5, 7)) - 1] ?? period;
}

/**
 * The readings, each with its consequence and a way to act on it. Only those
 * with something to say: an empty Portfolio gets no "0% collected".
 */
export function insights(input: InsightInput): Insight[] {
  const rows: (Insight | null)[] = [];

  // This month's collection is not one of them: the rent ring in the overview
  // already says it, and saying it twice was noise (owner, 2026-10-06).
  if (input.units > 0) {
    rows.push(input.vacant > 0
      ? {
        key: "vacancy",
        icon: "key-outline",
        tone: "laterite",
        headline: `${input.vacant} ${plural(input.vacant, "Unit is", "Units are")} empty`,
        line: `${input.occupied} of ${input.units} let. Each empty month is rent lost.`,
        act: input.vacant === 1 ? "Fill it" : "Fill them",
        to: "/(app)/units",
        // The arc is the empty share, in the card's laterite.
        share: input.vacant / input.units,
        tag: `${input.vacant} empty`,
      }
      : {
        key: "vacancy",
        icon: "key-outline",
        tone: "kola",
        headline: "Every Unit is let",
        line: `${input.units} of ${input.units} occupied`,
        act: "See Units",
        to: "/(app)/units",
        share: 1,
        tag: "Full",
      });
  }

  if (input.largest && input.largest.units > 0) {
    const share = Math.round((input.largest.occupied / input.largest.units) * 100);
    rows.push({
      key: "largest",
      icon: "business-outline",
      tone: "kola",
      headline: `${input.largest.title} is ${share}% let`,
      line: `${input.largest.units} ${plural(input.largest.units, "Unit", "Units")}, your largest Property`,
      act: "Open it",
      to: { pathname: "/(app)/provider-property", params: { propertyId: input.largest.id } },
      share: input.largest.occupied / input.largest.units,
      tag: "Largest",
    });
  }

  return rows.filter((row): row is Insight => row !== null);
}

/** "Today", "Yesterday", "3 days ago", then the date. Relative to when the page opened. */
export function ago(at: string, now: number): string {
  const then = new Date(at);
  const today = new Date(now);
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(then)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}
