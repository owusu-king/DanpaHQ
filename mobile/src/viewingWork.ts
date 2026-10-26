/**
 * A host's viewings, read as a day to plan (owner, 2026-10-06).
 *
 * The Viewings page filed each visit under "needs action", "upcoming" or
 * "history" and let a Filter sheet pick one. A host opens it to know where they
 * have to be next, what they must answer, and how the week is filling up. So
 * each viewing resolves to one lane, the step that is the host's when there is
 * one, and a place on the calendar.
 *
 * What the host may do is the server's answer (`actions`, `check_in`,
 * `attendance`); this module only reads it.
 */

import type { Viewing } from "@/viewings";

export type ViewingLane = "yours" | "scheduled" | "waiting" | "past";

export function laneOf(viewing: Viewing): ViewingLane {
  if (
    viewing.status === "requested"
    || viewing.status === "checked_in"
    || (viewing.status === "confirmed" && viewing.check_in.can_validate)
    || (viewing.status === "attendance_pending" && viewing.attendance.can_respond)
  ) return "yours";
  if (viewing.status === "offered") return "waiting";
  if (viewing.status === "confirmed" || viewing.status === "attendance_pending") return "scheduled";
  return "past";
}

/** The host's step, and where it happens. */
export type ViewingAct = { label: string; icon: "time-outline" | "qr-code-outline" | "checkmark-done-outline" | "chatbubble-ellipses-outline"; to: "record" | "check-in" };

export function actOf(viewing: Viewing): ViewingAct | null {
  if (viewing.status === "requested") return { label: "Offer times", icon: "time-outline", to: "record" };
  if (viewing.status === "confirmed" && viewing.check_in.can_validate) return { label: "Check in", icon: "qr-code-outline", to: "check-in" };
  if (viewing.status === "checked_in") return { label: "Mark completed", icon: "checkmark-done-outline", to: "record" };
  if (viewing.status === "attendance_pending" && viewing.attendance.can_respond) return { label: "Respond", icon: "chatbubble-ellipses-outline", to: "record" };
  return null;
}

/** Where it stands, in the words a host would use. */
export function lineOf(viewing: Viewing): string {
  switch (viewing.status) {
    case "requested":
      return "Asked to see it — offer some times";
    case "offered": {
      const options = viewing.slots.filter((slot) => !slot.is_past).length;
      return options ? `${options} ${options === 1 ? "time" : "times"} offered — tenant to pick` : "Offered times have passed";
    }
    case "confirmed":
      return viewing.check_in.can_validate ? "Ready to check in" : "Confirmed";
    case "checked_in":
      return "Checked in — mark completed when they leave";
    case "attendance_pending":
      return viewing.attendance.can_respond ? "Attendance reported — your response" : "Attendance being confirmed";
    case "completed":
      return "Viewed";
    case "declined":
      return "You declined";
    case "withdrawn":
      return "They withdrew";
    case "cancelled":
      return viewing.cancelled_by === "host" ? "You cancelled" : "They cancelled";
    case "tenant_no_show":
      return "They did not come";
    default:
      return viewing.status_display;
  }
}

export function startsAt(viewing: Viewing): Date | null {
  if (!viewing.confirmed_starts_at) return null;
  const at = new Date(viewing.confirmed_starts_at);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function dayKey(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/** The visit to be at next: the first confirmed one that has not long since begun. */
export function upNext(viewings: readonly Viewing[], now = Date.now()): Viewing | null {
  return viewings
    .filter((viewing) => (viewing.status === "confirmed" || viewing.status === "checked_in") && startsAt(viewing))
    .filter((viewing) => (startsAt(viewing) as Date).getTime() >= now - 60 * 60 * 1000)
    .sort((a, b) => (a.confirmed_starts_at ?? "").localeCompare(b.confirmed_starts_at ?? ""))[0] ?? null;
}

/** "in 2h 15m", "in 3 days", "now": how long until it starts. */
export function countdown(at: Date, now = Date.now()): string {
  const minutes = Math.round((at.getTime() - now) / 60_000);
  if (minutes <= 5) return minutes < -5 ? "started" : "now";
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/** The next seven days from today, each with how many visits are booked on it. */
export function week(viewings: readonly Viewing[], today = new Date()): { key: string; date: Date; count: number }[] {
  const booked = new Map<string, number>();
  for (const viewing of viewings) {
    const at = startsAt(viewing);
    if (!at || laneOf(viewing) === "past" || viewing.status === "offered") continue;
    booked.set(dayKey(at), (booked.get(dayKey(at)) ?? 0) + 1);
  }
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    return { key: dayKey(date), date, count: booked.get(dayKey(date)) ?? 0 };
  });
}

export type ViewingWork = {
  yours: Viewing[];
  /** Booked visits, soonest first, the ones without a time last. */
  scheduled: Viewing[];
  waiting: Viewing[];
  past: Viewing[];
};

export function viewingWork(viewings: readonly Viewing[]): ViewingWork {
  const lanes: ViewingWork = { yours: [], scheduled: [], waiting: [], past: [] };
  for (const viewing of viewings) lanes[laneOf(viewing)].push(viewing);
  const soonest = (a: Viewing, b: Viewing) => {
    const left = a.confirmed_starts_at ?? a.created_at;
    const right = b.confirmed_starts_at ?? b.created_at;
    return left.localeCompare(right);
  };
  lanes.yours.sort(soonest);
  lanes.scheduled.sort(soonest);
  lanes.waiting.sort((a, b) => a.created_at.localeCompare(b.created_at));
  lanes.past.sort((a, b) => (b.confirmed_starts_at ?? b.created_at).localeCompare(a.confirmed_starts_at ?? a.created_at));
  return lanes;
}
