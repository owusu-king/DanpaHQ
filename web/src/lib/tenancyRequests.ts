/**
 * What a tenancy request is, and where it has got to.
 *
 * Two different records arrive on this screen and are read as one list: a
 * public application against a listing, and a private request to join a Unit
 * directly. They have separate tables, separate endpoints and separate status
 * vocabularies, and a provider does not care — the question is the same one
 * either way, so the words have to be the same too.
 *
 * Split out of the page when the record it opens became a page of its own. Both
 * the list and the record say what a request's state is, and two copies of that
 * would eventually disagree.
 *
 * **Web-only, and deliberately not mirrored.** `applicationMeaning.ts` is the
 * mirrored module and is shared with the phone; this is the provider's own
 * reading of two server-side vocabularies and has no mobile counterpart.
 */

import type { Lease, ProviderTenancyRequest, RentalApplication } from "@/lib/console";

export type RequestItem =
  | { key: string; kind: "application"; application: RentalApplication; lease: Lease | null }
  | { key: string; kind: "private"; request: ProviderTenancyRequest; lease: Lease | null };

/** Where a request has got to, which is also the order somebody works in. */
export type RequestStage = "action" | "agreement" | "history";

export type RequestFilter = "all" | RequestStage;

export const REQUEST_FILTERS: RequestFilter[] = ["all", "action", "agreement", "history"];

export function requestFilterLabel(filter: RequestFilter) {
  return filter === "all"
    ? "All"
    : filter === "action"
      ? "Needs action"
      : filter === "agreement"
        ? "Agreement"
        : "History";
}

export function requestStage(item: RequestItem): RequestStage {
  if (item.kind === "application") {
    if (["submitted", "under_review"].includes(item.application.status)) return "action";
    if (item.application.status === "accepted" && (!item.lease || agreementUnsent(item.lease.status))) {
      return "agreement";
    }
    return "history";
  }
  if (item.request.status === "pending") return "action";
  if (
    item.request.status === "approved" &&
    (!item.request.lease_id || agreementUnsent(item.request.lease_status))
  ) {
    return "agreement";
  }
  return "history";
}

/**
 * The decision that was taken, where one was.
 *
 * Only what the two servers actually record. A request the *requester* walked
 * away from — `withdrawn` on an application, `cancelled` on a direct request —
 * is neither accepted nor declined, and counting it as either would put a
 * decision in the provider's name that they never made. So the three counts do
 * not sum to the total, and should not.
 */
export function requestOutcome(item: RequestItem): "accepted" | "declined" | "open" {
  if (item.kind === "application") {
    if (item.application.status === "accepted") return "accepted";
    if (item.application.status === "rejected") return "declined";
    return "open";
  }
  if (item.request.status === "approved") return "accepted";
  if (item.request.status === "rejected") return "declined";
  return "open";
}

/**
 * Saved but not sent. "Ready" is what finishing the builder leaves behind; it
 * was read as settled, so a generated agreement dropped out of Agreement with
 * no way to send it from the request.
 */
export function agreementUnsent(status: Lease["status"] | null | undefined) {
  return status === "draft" || status === "ready";
}

export function agreementStatus(value: Lease | Lease["status"] | null | undefined) {
  const status = typeof value === "string" ? value : value?.status;
  return (
    (
      {
        draft: "Agreement in progress",
        ready: "Agreement ready to send",
        offered: "Waiting for tenant",
        awaiting_activation: "Waiting for activation",
        active: "Tenancy active",
        declined: "Agreement declined",
        cancelled: "Agreement cancelled",
        ended: "Tenancy ended",
      } as Record<string, string>
    )[status ?? ""] ?? "Request settled"
  );
}

export function requestStatus(item: RequestItem) {
  if (item.kind === "application") {
    return item.lease ? agreementStatus(item.lease) : item.application.status_display;
  }
  if (item.request.status === "pending") return "Decision needed";
  return item.request.lease_status ? agreementStatus(item.request.lease_status) : "Agreement needed";
}

export function requestTone(item: RequestItem) {
  const stage = requestStage(item);
  // Settled is quiet unless it settled into a tenancy: a decline or a
  // withdrawal is a record, not a success.
  if (stage === "action") return "attention";
  if (stage === "agreement") return "waiting";
  return requestOutcome(item) === "accepted" ? "good" : "muted";
}

export function requestCreatedAt(item: RequestItem) {
  return item.kind === "application" ? item.application.created_at : item.request.created_at;
}

/** The person, wherever they came from. */
export function requestWho(item: RequestItem) {
  return item.kind === "application"
    ? item.application.applicant_name
    : item.request.requester_display;
}

/** The place, however it is described by whichever record this is. */
export function requestWhere(item: RequestItem) {
  if (item.kind === "application") return item.application.listing_headline;
  const { property_title, unit_label, bed_label } = item.request;
  return `${property_title} · ${unit_label}${bed_label ? ` · ${bed_label}` : ""}`;
}

export function requestSearchText(item: RequestItem) {
  return item.kind === "application"
    ? `${item.application.applicant_name} ${item.application.listing_headline} ${item.application.locality_name ?? ""}`
    : `${item.request.requester_display} ${item.request.property_title} ${item.request.unit_label} ${item.request.bed_label ?? ""}`;
}

/**
 * The id this request answers to in a URL.
 *
 * The record's own id, not the composite key the list uses to tell two kinds
 * apart in one array. Both are UUIDs from different tables, so a single segment
 * is unambiguous in practice and the kind is recovered by finding the item.
 */
export function requestRecordId(item: RequestItem) {
  return item.kind === "application" ? item.application.id : item.request.id;
}

export function formatRequestDate(value: string) {
  return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
