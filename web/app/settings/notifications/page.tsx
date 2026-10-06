import { redirect } from "next/navigation";

/** Notifications became Preferences: channels, numbers and alerts in one place. */
export default function NotificationSettingsRedirect() {
  redirect("/settings/preferences" as never);
}
