import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Identity, YouPage, type YouItem, type YouSection } from "@/components/account/YouParts";
import { useProfilePhoto } from "@/components/nav/TabHeaderControls";
import { Notice } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import { listNotifications } from "@/notifications";
import { listMyPortfolioInvitations } from "@/organizations";
import { chooseWorkspace } from "@/workspace";

/**
 * Everything that is not a tab, laid out like WhatsApp's "You" tab (owner,
 * 2026-10-06): the person first, then untitled white cards.
 *
 * The cards are, in order: the work (what a Portfolio runs on), the business
 * (who works in it and how it is paid), the account, and leaving. The photo,
 * name and pencil open the profile, so there is no Profile row; the pill's plus
 * is the same create sheet as the header's elsewhere.
 *
 * Rows that this person's role would refuse are not listed: an accountant
 * offered Units and Listings gets a menu of dead ends, which reads as the app
 * being broken rather than as a role doing its job.
 */
export default function ProviderMoreScreen() {
  const router = useRouter();
  const { activeContext, state, refreshMe, signOut } = useAuth();
  const photoUri = useProfilePhoto();
  const [switching, setSwitching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(0);
  const [invitations, setInvitations] = useState(0);

  useFocusEffect(
    useCallback(() => {
      // A failed badge must never break the screen behind it.
      void listNotifications().then((page) => setUnread(page.unread_count)).catch(() => undefined);
      // One account can be invited into a second Portfolio, so the way in
      // belongs on this index too — and only while one is waiting.
      void listMyPortfolioInvitations()
        .then((rows) => setInvitations(rows.filter((row) => row.status === "pending").length))
        .catch(() => undefined);
    }, []),
  );

  const me = state.status === "signed_in" ? state.me : null;
  // The Portfolio being operated, and what this person's role reaches in it.
  const context = me?.contexts.find((row) => row.type === "organization" && row.id === activeContext)
    ?? me?.contexts.find((row) => row.type === "organization");
  const can = context?.access?.can;
  const operates = can?.operate_properties ?? true;
  const finances = can?.view_finances ?? true;
  const billing = can?.view_billing ?? true;
  const go = (path: string) => () => router.push(path as never);
  const only = (when: boolean, item: YouItem): YouItem[] => (when ? [item] : []);

  /**
   * Move to the tenant experience.
   *
   * The switch has to be the backend call: setting a client-side context left
   * `active_workspace` on provider, so the entry route kept pointing back here
   * and the gate bounced the person straight round.
   */
  async function switchToTenant() {
    setSwitching(true);
    setError("");
    try {
      const next = await chooseWorkspace("tenant");
      await refreshMe();
      router.replace(resolveEntryRoute(next) as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not switch.");
    } finally {
      setSwitching(false);
    }
  }

  async function leave() {
    setLeaving(true);
    try {
      await signOut();
      router.replace("/(auth)/start");
    } finally {
      setLeaving(false);
    }
  }

  const sections: YouSection[] = [
    {
      key: "waiting",
      items: only(invitations > 0, { key: "invitations", icon: "people-circle-outline", label: "Portfolio invitations", count: invitations, onPress: go("/(app)/portfolio-invitations") }),
    },
    {
      key: "work",
      items: [
        ...only(operates, { key: "units", icon: "grid-outline", label: "Units", onPress: go("/(app)/units") }),
        ...only(operates, { key: "listings", icon: "megaphone-outline", label: "Listings", onPress: go("/(app)/(provider-tabs)/properties") }),
        ...only(operates, { key: "viewings", icon: "calendar-outline", label: "Viewings", onPress: go("/(app)/provider-viewings") }),
        ...only(operates, { key: "requests", icon: "document-text-outline", label: "Tenancy requests", onPress: go("/(app)/provider-applications") }),
        ...only(operates || finances, { key: "leases", icon: "reader-outline", label: "Leases", onPress: go("/(app)/leases") }),
        ...only(operates, { key: "maintenance", icon: "construct-outline", label: "Maintenance", onPress: go("/(app)/maintenance") }),
        // Buyers asking about what this Portfolio is selling (owner, 2026-09-29).
        ...only(operates, { key: "enquiries", icon: "chatbubbles-outline", label: "Buyer enquiries", onPress: go("/(app)/enquiries") }),
        { key: "updates", icon: "notifications-outline", label: "Updates", count: unread, onPress: go("/(app)/notifications") },
      ],
    },
    {
      key: "business",
      items: [
        { key: "team", icon: "people-outline", label: "Team", onPress: go("/(app)/team") },
        ...only(billing, { key: "settlement", icon: "card-outline", label: "Settlement account", onPress: go("/(app)/payout-account") }),
        ...only(billing, { key: "billing", icon: "pricetag-outline", label: "Plan & billing", onPress: go("/(app)/billing") }),
        ...only(operates, { key: "archive", icon: "archive-outline", label: "Archive", onPress: go("/(app)/archive") }),
      ],
    },
    {
      key: "account",
      items: [
        { key: "security", icon: "key-outline", label: "Security", onPress: go("/(app)/security") },
        { key: "verification", icon: "shield-checkmark-outline", label: "Verification", onPress: go("/(app)/trust") },
        { key: "notifications", icon: "options-outline", label: "Notifications", onPress: go("/(app)/notification-settings") },
      ],
    },
    {
      key: "leave",
      items: [
        // A change of view, not of account. Switching back is one tap from the tenant's More.
        { key: "switch", icon: "swap-horizontal-outline", label: "Switch to renting", busy: switching, busyLabel: "Switching…", onPress: () => void switchToTenant() },
        { key: "sign-out", icon: "log-out-outline", label: "Sign out", danger: true, busy: leaving, busyLabel: "Signing out…", onPress: () => void leave() },
      ],
    },
  ];

  return (
    <YouPage
      tools={[
        { key: "create", icon: "add", label: "Add or create", onPress: go("/(app)/provider-actions") },
        { key: "edit", icon: "pencil", label: "Edit your profile", onPress: go("/(app)/profile-edit") },
      ]}
      identity={me ? (
        <Identity
          name={me.display_name}
          photoUri={photoUri}
          note={(me.profile?.completeness ?? 0) < 100 ? "Finish your profile" : context?.label}
          verified={me.is_phone_verified}
          onPress={go("/(app)/profile-edit")}
        />
      ) : null}
      sections={sections}
      notice={error ? <Notice tone="error" title={error} /> : null}
    />
  );
}
