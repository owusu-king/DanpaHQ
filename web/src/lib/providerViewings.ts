/**
 * A viewing, as the person hosting it reads it.
 *
 * Twelve statuses, and a provider is only ever asking one of three questions:
 * does this need me now, is it still to come, or is it done.
 *
 * `viewingMeaning.ts` answers the tenant's version of that and is mirrored with
 * the phone. This is the host's, has no mobile counterpart, and is therefore
 * **web-only and not mirrored**. The filter type is named for the provider
 * because the tenant's `ViewingFilter` is imported into the same page.
 *
 * Nothing here re-derives permission. `actions`, `check_in`, `attendance` and
 * `post_viewing` are computed per-reader on the server; this reads them to
 * choose a list and a sentence, nothing more.
 *
 * Split out of the viewings page when the record it opens became a page of its
 * own — the list and the record both say what a viewing's state is, and two
 * copies of that would eventually disagree.
 */

import type { Viewing } from "@/lib/console";

export type ProviderViewingView = "action" | "upcoming" | "history";

export type ProviderViewingFilter = "all" | ProviderViewingView;

export const PROVIDER_VIEWING_FILTERS: ProviderViewingFilter[] = [
  "all",
  "action",
  "upcoming",
  "history",
];

export function providerViewingFilterLabel(filter: ProviderViewingFilter) {
  return filter === "all" ? "All" : viewingViewLabel(filter);
}

/**
 * The three counts across the top.
 *
 * An aggregate, a time both sides have agreed, and a visit that actually
 * happened. Deliberately not the stage counts — those are the pills below, and
 * saying the same number twice on one screen is how a page stops being read.
 *
 * No-shows and disputes are real outcomes and are not summarised here: three
 * numbers is the budget, and "how many people did not turn up" is a question
 * about a Property rather than about today's work.
 */
export function viewingTotals(viewings: Viewing[]) {
  return {
    total: viewings.length,
    confirmed: viewings.filter((viewing) => viewing.status === "confirmed").length,
    completed: viewings.filter((viewing) => viewing.status === "completed").length,
  };
}

export function viewingSearchText(viewing: Viewing) {
  return [viewing.tenant_name, viewing.listing_headline, viewing.locality_name, viewing.landmark]
    .filter(Boolean)
    .join(" ");
}

export function formatViewingTime(value: string) {
  return new Date(value).toLocaleString("en-GH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function providerViewingView(viewing: Viewing): ProviderViewingView {
  if (
    viewing.status === "requested" ||
    viewing.status === "checked_in" ||
    (viewing.status === "attendance_pending" && viewing.attendance.can_respond) ||
    (viewing.status === "confirmed" && viewing.check_in.can_validate)
  ) return "action";
  if (["offered", "confirmed", "attendance_pending"].includes(viewing.status)) return "upcoming";
  return "history";
}

export function providerViewingSummary(viewing: Viewing): { label: string; tone: "neutral" | "good" | "waiting" | "attention" } {
  if (viewing.status === "requested") return { label: "Needs a reply", tone: "attention" };
  if (viewing.status === "offered") return { label: "Waiting for tenant", tone: "waiting" };
  if (viewing.status === "confirmed" && viewing.check_in.can_validate) return { label: "Ready for check-in", tone: "attention" };
  if (viewing.status === "confirmed") return { label: "Confirmed", tone: "good" };
  if (viewing.status === "checked_in") return { label: "Checked in", tone: "attention" };
  if (viewing.status === "attendance_pending" && viewing.attendance.can_respond) return { label: "Response needed", tone: "attention" };
  if (viewing.status === "attendance_pending") return { label: "Attendance pending", tone: "waiting" };
  if (viewing.status === "completed") return { label: "Completed", tone: "good" };
  return { label: viewing.status_display, tone: "neutral" };
}

export function providerViewingMoment(viewing: Viewing): string {
  if (viewing.confirmed_starts_at) return formatViewingTime(viewing.confirmed_starts_at);
  if (viewing.status === "offered") {
    const next = viewing.slots.find((slot) => !slot.is_past);
    return next ? `First option ${formatViewingTime(next.starts_at)}` : "New times needed";
  }
  return new Date(viewing.created_at).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

export function providerViewingSort(view: ProviderViewingView) {
  return (a: Viewing, b: Viewing) => {
    const aDate = a.confirmed_starts_at || a.created_at;
    const bDate = b.confirmed_starts_at || b.created_at;
    return view === "history"
      ? new Date(bDate).getTime() - new Date(aDate).getTime()
      : new Date(aDate).getTime() - new Date(bDate).getTime();
  };
}

export function viewingViewLabel(view: ProviderViewingView) {
  return view === "action" ? "Needs action" : view === "upcoming" ? "Upcoming" : "History";
}

export function viewingEmptyTitle(view: ProviderViewingView) {
  if (view === "action") return "Nothing needs action";
  if (view === "upcoming") return "No upcoming visits";
  return "No viewing history yet";
}

export function viewingEmptyBody(view: ProviderViewingView) {
  if (view === "action") return "New requests, ready check-ins and attendance responses appear here.";
  if (view === "upcoming") return "Offered and confirmed viewing times appear here.";
  return "Completed, cancelled and declined viewings remain available here.";
}