import { Stack } from "expo-router";

import { backHeaderLeft, closeHeaderLeft } from "@/components/nav/BackControl";
import { StackHeader } from "@/components/nav/StackHeader";
import { gestureBackEnabled, stackAnimation } from "@/platform";
import { shell } from "@/shell";

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        // Pushed screens use the same measured edge-to-edge boundary as tabs.
        header: (props) => <StackHeader {...props} />,
        headerShadowVisible: false,
        // One way out, drawn the same on every screen and present even when the
        // stack has no history to offer — see `BackControl`. It replaces the
        // platform button rather than joining it, so `headerBackVisible` goes.
        headerLeft: backHeaderLeft,
        headerBackVisible: false,
        contentStyle: { backgroundColor: shell.canvas },
        animation: stackAnimation,
        gestureEnabled: gestureBackEnabled,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(provider-tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="search" options={{ title: "Find a place" }} />
      <Stack.Screen name="saved" options={{ title: "Your shortlist" }} />
      <Stack.Screen name="notifications" options={{ title: "Updates" }} />
      <Stack.Screen name="viewings" options={{ title: "Your viewings" }} />
      <Stack.Screen name="viewing/[id]" options={{ title: "Viewing" }} />
      <Stack.Screen name="viewing-check-in" options={{ title: "Viewing check-in" }} />
      <Stack.Screen name="applications" options={{ title: "Your applications" }} />
      {/* A pushed screen, not a modal. An application record is the tenant's
          own history of a decision that is still being made — it carries a
          timeline, what they submitted, and the agreement it may become. A
          sheet that dismisses on a downward swipe is for a glance, and it
          also loses its place in the back stack. Viewing records follow the
          same rule now that scheduling, attendance, directions and follow-up
          can all coexist there. Agreements follow the same rule: the full
          legal and financial record is resumable work, not a quick sheet. */}
      <Stack.Screen name="application/[id]" options={{ title: "Application" }} />
      <Stack.Screen name="provider-viewings" options={{ title: "Viewings" }} />
      <Stack.Screen name="provider-viewing" options={{ title: "Viewing" }} />
      <Stack.Screen name="provider-viewing-check-in" options={{ title: "Check in tenant" }} />
      <Stack.Screen name="provider-applications" options={{ title: "Tenancy requests" }} />
      <Stack.Screen name="provider-application" options={{ title: "Tenancy request" }} />
      <Stack.Screen name="leases" options={{ title: "Agreements" }} />
      <Stack.Screen name="agreement/[id]" options={{ title: "Agreement" }} />
      <Stack.Screen name="provider-lease" options={{ title: "Agreement" }} />
      <Stack.Screen name="lease-builder" options={{ title: "Prepare agreement" }} />
      <Stack.Screen name="rent-account" options={{ title: "Rent account" }} />
      <Stack.Screen name="service" options={{ title: "Service" }} />
      <Stack.Screen name="tenant-payments" options={{ title: "Payments" }} />
      <Stack.Screen name="provider-payment-record" options={{ title: "Record payment" }} />
      <Stack.Screen name="payment-checkout" options={{ title: "Review payment" }} />
      <Stack.Screen name="payment-status" options={{ title: "Payment status" }} />
      <Stack.Screen name="payment-receipt" options={{ title: "Payment receipt" }} />
      <Stack.Screen name="payout-account" options={{ title: "Settlement account" }} />
      <Stack.Screen name="apply/[id]" options={{ title: "Apply" }} />
      {/* The title comes from the listing itself once it loads. */}
      <Stack.Screen name="listing/[id]" options={{ title: "" }} />
      <Stack.Screen name="trust" options={{ title: "Verification" }} />
      <Stack.Screen name="identity-verification" options={{ title: "Identity verification" }} />
      <Stack.Screen name="provider" options={{ title: "Provider verification" }} />
      <Stack.Screen name="provider-property" options={{ title: "Property" }} />
      {/* Creating a property is its own journey, not a panel on the workspace —
          the same split the space flow already makes. `private-property` is its
          first step and this is steps two to six, so they share a title: from
          the provider's side it is one thing. */}
      <Stack.Screen name="property-setup" options={{ title: "Create property" }} />
      {/* Asking for verification is a separate journey again, made afterwards
          from the property. */}
      <Stack.Screen name="property-verify" options={{ title: "Submit for verification" }} />
      {/* The space is its own screen, not a card on the property. Its check,
          its photos, its amenities and its publication decision are a
          workspace of their own. */}
      <Stack.Screen name="space" options={{ title: "Unit" }} />
      <Stack.Screen name="units" options={{ title: "Units" }} />
      <Stack.Screen name="unit-new" options={{ title: "Add Unit" }} />
      <Stack.Screen name="space-new" options={{ title: "Add Unit" }} />
      <Stack.Screen name="provider-tenancy" options={{ title: "Tenancy" }} />
      <Stack.Screen name="team" options={{ title: "Team" }} />
      {/* Changing plan is a journey of focused screens — choose, review, pay
          and see the result — so the back gesture always means one step. */}
      <Stack.Screen name="billing" options={{ title: "Plan & billing" }} />
      <Stack.Screen name="billing-plans" options={{ title: "Change plan" }} />
      <Stack.Screen name="billing-review" options={{ title: "Review" }} />
      <Stack.Screen name="billing-payment" options={{ title: "Payment" }} />
      <Stack.Screen name="team-member" options={{ title: "Team member" }} />
      <Stack.Screen name="notification-settings" options={{ title: "Notifications" }} />
      <Stack.Screen name="portfolio-invitations" options={{ title: "Portfolio invitations" }} />
      <Stack.Screen name="private-property" options={{ title: "Create property" }} />
      <Stack.Screen name="tenant-setup" options={{ title: "Join another tenancy" }} />
      <Stack.Screen name="provider-actions" options={{ title: "Quick actions", presentation: "modal", headerLeft: closeHeaderLeft }} />
      <Stack.Screen name="security" options={{ title: "Security" }} />
      {/* Not "profile": a group folder contributes nothing to the path, so
          that name collides with the tenant profile tab and one screen wins. */}
      <Stack.Screen name="profile-edit" options={{ title: "Your profile" }} />
      <Stack.Screen name="archive" options={{ title: "Archive" }} />
      <Stack.Screen name="tenancy" options={{ title: "Tenancy" }} />
      {/* No way out, because there is nowhere to go. Access is limited, and the
          entry route this would fall back to is the surface being withheld —
          a back control here would put someone in a loop. */}
      <Stack.Screen
        name="restricted"
        options={{ title: "Account", headerLeft: () => null, headerBackVisible: false }}
      />
    </Stack>
  );
}
