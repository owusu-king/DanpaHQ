import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";

import { useAuth } from "@/auth";
import {
  Group,
  IndexActions,
  IndexPage,
  Row,
  SignOutButton,
  SwitchExperienceButton,
} from "@/components/account/IndexRows";
import { resolveEntryRoute } from "@/navigation";
import { listNotifications } from "@/notifications";
import { listMyPortfolioInvitations } from "@/organizations";
import { chooseWorkspace } from "@/workspace";

/**
 * Everything that is not a tab.
 *
 * A navigation surface, not an information page. A row that says Leases and
 * leads to Leases needs no sentence under it, so none of them has one — the
 * label, the glyph and the chevron are the whole design. Each group is one glass
 * panel rather than a card per row; `IndexRows` says why it looks the way it does.
 *
 * Nor does it title itself: the header says "More", which this page used to
 * repeat as its own eyebrow and heading.
 *
 * Account destinations are listed here rather than behind a Settings row.
 * Making someone tap More → Settings → Security is one level more than the task
 * deserves. The tenant's equivalent is their own More; the two list different
 * things and are built from the same rows.
 */
export default function ProviderMoreScreen() {
  const router = useRouter();
  const { activeContext, state, refreshMe, signOut } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [leaving, setLeaving] = useState(false);
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
  // Rows that would refuse are not listed: an accountant offered Units and
  // Listings gets a menu of dead ends, which reads as the app being broken
  // rather than as a role doing its job.
  const context = me?.contexts.find((row) => row.type === "organization" && row.id === activeContext)
    ?? me?.contexts.find((row) => row.type === "organization");
  const can = context?.access?.can;
  const operates = can?.operate_properties ?? true;
  const finances = can?.view_finances ?? true;
  const billing = can?.view_billing ?? true;

  /**
   * Move to the tenant experience.
   *
   * The switch has to be the backend call: setting a client-side context left
   * `active_workspace` on provider, so the entry route kept pointing back here
   * and the gate bounced the person straight round.
   */
  async function switchToTenant() {
    setSwitching(true);
    try {
      const me = await chooseWorkspace("tenant");
      await refreshMe();
      router.replace(resolveEntryRoute(me) as never);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <IndexPage>
      {invitations ? (
        <Group title="Waiting for you" tone="harmattan">
          <Row
            icon="people-circle-outline"
            label="Portfolio invitations"
            count={invitations}
            onPress={() => router.push("/(app)/portfolio-invitations" as never)}
          />
        </Group>
      ) : null}

      <Group title="Management" tone="lagoon">
        {operates ? <Row icon="grid-outline" label="Units" onPress={() => router.push("/(app)/units" as never)} /> : null}
        {operates ? <Row icon="calendar-outline" label="Viewings" onPress={() => router.push("/(app)/provider-viewings" as never)} /> : null}
        {operates ? <Row icon="document-text-outline" label="Tenancy requests" onPress={() => router.push("/(app)/provider-applications" as never)} /> : null}
        {/* Buyers asking about what this Portfolio is selling (owner, 2026-09-29). */}
        {operates ? <Row icon="chatbubbles-outline" label="Buyer enquiries" onPress={() => router.push("/(app)/enquiries" as never)} /> : null}
        {operates || finances ? <Row icon="reader-outline" label="Leases" onPress={() => router.push("/(app)/leases" as never)} /> : null}
        <Row icon="notifications-outline" label="Updates" count={unread} onPress={() => router.push("/(app)/notifications" as never)} />
      </Group>

      {/* Harmattan, not laterite: a shield in laterite beside "Verification"
          reads as a check that failed. */}
      <Group title="Growth and trust" tone="harmattan">
        {operates ? <Row icon="megaphone-outline" label="Listings" onPress={() => router.push("/(app)/(provider-tabs)/properties" as never)} /> : null}
        <Row icon="shield-checkmark-outline" label="Verification" onPress={() => router.push("/(app)/trust" as never)} />
      </Group>

      <Group title="Account and settings" tone="kola">
        <Row icon="person-outline" label="Profile" onPress={() => router.push("/(app)/profile-edit" as never)} />
        {billing ? <Row icon="card-outline" label="Settlement account" onPress={() => router.push("/(app)/payout-account" as never)} /> : null}
        <Row icon="lock-closed-outline" label="Security" onPress={() => router.push("/(app)/security" as never)} />
        <Row icon="options-outline" label="Notifications" onPress={() => router.push("/(app)/notification-settings" as never)} />
        <Row icon="people-circle-outline" label="Team" onPress={() => router.push("/(app)/team" as never)} />
        {billing ? <Row icon="pricetag-outline" label="Plan & billing" onPress={() => router.push("/(app)/billing" as never)} /> : null}
        {operates ? <Row icon="archive-outline" label="Archive" onPress={() => router.push("/(app)/archive" as never)} /> : null}
      </Group>

      <IndexActions>
        {/* A change of view, not of account. Switching back is one tap from
            the tenant's More. */}
        <SwitchExperienceButton
          label="Switch to renting"
          busyLabel="Switching…"
          busy={switching}
          onPress={() => void switchToTenant()}
        />
        <SignOutButton
          label="Sign out"
          busyLabel="Signing out…"
          busy={leaving}
          onPress={async () => {
            setLeaving(true);
            try {
              await signOut();
              router.replace("/(auth)/start");
            } finally {
              setLeaving(false);
            }
          }}
        />
      </IndexActions>
    </IndexPage>
  );
}
