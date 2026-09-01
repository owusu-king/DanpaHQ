/**
 * Time as a tenant reads it.
 *
 * "3 days ago" is what someone answers when asked when they applied. The exact
 * timestamp matters only for records, so it is not what a row shows.
 *
 * The twin of `timeAgo` in `mobile/src/notifications.ts`; keep the two in step.
 */

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

/** A calendar date, for the things that are dates rather than moments. */
export function onDate(value: string | null | undefined): string {
  if (!value) return "";
  const iso = value.length === 10 ? `${value}T12:00:00` : value;
  return new Date(iso).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
