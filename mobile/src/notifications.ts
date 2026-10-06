/**
 * What the app has to tell you.
 *
 * In-app is the channel that always works: no provider, no credentials, no
 * delivery contract with anyone. A text may or may not have gone out alongside
 * it, and the app never claims one did.
 */

import { apiFetch } from "@/api";

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  target_type: string;
  target_id: string;
  read_at: string | null;
  is_read: boolean;
  /** A reminder ("informational") is deleted once read; "activity" is kept,
   *  the ten most recent. The server decides; the app only reads it. */
  record: "informational" | "activity";
  created_at: string;
};

export type NotificationPage = {
  unread_count: number;
  results: Notification[];
};

export function listNotifications(unreadOnly = false) {
  return apiFetch<NotificationPage>(
    `/me/notifications/${unreadOnly ? "?unread=true" : ""}`,
  );
}

export function markRead(ids?: string[]) {
  return apiFetch<{ marked: number; unread_count: number }>("/me/notifications/read/", {
    method: "POST",
    body: ids ? { ids } : {},
  });
}

/** "2 hours ago" beats a timestamp for something that just happened. */
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

export type NotificationPreferences = {
  sms_enabled: boolean;
  push_enabled: boolean;
  sms_important_only: boolean;
};

export function getNotificationPreferences() {
  return apiFetch<NotificationPreferences>("/me/notification-preferences/");
}

export function updateNotificationPreferences(input: Partial<NotificationPreferences>) {
  return apiFetch<NotificationPreferences>("/me/notification-preferences/", {
    method: "PATCH",
    // The mobile API client owns JSON encoding. Passing an encoded string here
    // makes it encode a second time, so DRF receives a string instead of the
    // preference fields and rejects every switch change.
    body: input,
  });
}
