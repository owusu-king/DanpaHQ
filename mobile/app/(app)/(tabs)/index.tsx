import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { listMyApplications, type RentalApplication } from "@/applications";
import { useAuth } from "@/auth";
import { listNotifications, type Notification } from "@/notifications";
import { HomeGround } from "@/components/home/HomeGround";
import { PublicHome } from "@/components/home/PublicHome";
import { TenantHome } from "@/components/home/TenantHome";
import { useHomeDensity } from "@/components/home/plinth";
import { Notice, space } from "@/components/ui";
import { listMyLeases, type Lease } from "@/leases";
import { resolveEntryRoute } from "@/navigation";
import { listMyJoinRequests, listMyTenancies, type MyJoinRequest, type Tenancy } from "@/tenancy";
import { listMyViewings, type Viewing } from "@/viewings";
import { chooseWorkspace } from "@/workspace";

/**
 * Home: the tenant's dashboard signed in, and what Rooomly is signed out.
 *
 * Both stand on the soft green ground now. It used to stop painting for the
 * signed-out screen, on the reasoning that a wall of listing cards on the
 * ground would read as a dashboard — true, but the listings are gone, and what
 * was left was the one screen in the product that stood on bare ivory while
 * every tab around it carried the green. Painting always is also one less thing
 * that changes at the moment somebody signs in.
 */
export default function DiscoveryHomeScreen() {
  return (
    <HomeGround>
      <DiscoveryHome />
    </HomeGround>
  );
}

function DiscoveryHome() {
  const router = useRouter();
  const density = useHomeDensity();
  const { providerError } = useLocalSearchParams<{ providerError?: string }>();
  const { state, refreshMe } = useAuth();
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState(providerError ?? "");
  const [providerRequested, setProviderRequested] = useState(false);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [applications, setApplications] = useState<RentalApplication[]>([]);
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [joinRequests, setJoinRequests] = useState<MyJoinRequest[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [recentActivity, setRecentActivity] = useState<Notification[]>([]);
  const [homeError, setHomeError] = useState("");
  const [homeLoading, setHomeLoading] = useState(true);

  const me = state.status === "signed_in" ? state.me : null;
  const displayName = me?.preferred_name || me?.first_name || "";
  /**
   * Anyone signed in gets the tenant control center on this tab.
   *
   * This used to require `active_workspace === "tenant"` or an occupancy
   * context, so a provider looking at the tenant side fell through to the
   * signed-out browsing screen — which is where the missing Join-a-home
   * control went. Whose home this is does not depend on which workspace is
   * active; the tab itself is the tenant side.
   */
  const tenantMode = Boolean(me);

  const loadTenantHome = useCallback(async () => {
    if (!tenantMode) {
      setTenancies([]);
      setLeases([]);
      setUnreadNotifications(0);
      setRecentActivity([]);
      setHomeLoading(false);
      return;
    }
    setHomeLoading(true);
    try {
      // Every tenancy, whole. This used to fetch occupancies and leases
      // separately and then keep whichever occupancy came first, which is how a
      // tenant renting two places lost sight of one of them.
      //
      // The rest is what Home needs to answer "does anything need me" without
      // the tenant opening four screens to find out.
      const [homes, agreements, apps, views, requests, updates] = await Promise.all([
        listMyTenancies(),
        listMyLeases().catch(() => [] as Lease[]),
        listMyApplications().catch(() => [] as RentalApplication[]),
        listMyViewings().catch(() => [] as Viewing[]),
        listMyJoinRequests().catch(() => [] as MyJoinRequest[]),
        // One read, two jobs: the unread count on the Updates shortcut and
        // the recent-activity feed. Tolerant like the rest — neither is worth
        // failing somebody's rent summary over.
        listNotifications().catch(() => ({ unread_count: 0, results: [] })),
      ]);
      setTenancies(homes);
      setLeases(agreements);
      setApplications(apps);
      setViewings(views);
      setJoinRequests(requests);
      setUnreadNotifications(updates.unread_count);
      setRecentActivity(updates.results);
      setHomeError("");
    } catch {
      setHomeError("Could not refresh your homes and rent details.");
    } finally {
      setHomeLoading(false);
    }
  }, [tenantMode]);

  useFocusEffect(useCallback(() => { void loadTenantHome(); }, [loadTenantHome]));

  const openListingWorkspace = useCallback(async () => {
    if (state.status === "loading") {
      setProviderRequested(true);
      return;
    }
    setProviderRequested(false);
    if (state.status === "signed_out") {
      // Sign in, not sign up. Most people tapping this already have an account,
      // and the sign-in screen is the one place that offers both.
      router.push({ pathname: "/(auth)/sign-in", params: { workspace: "provider" } });
      return;
    }
    if (state.status !== "signed_in") return;

    // A signed-in tenant cannot become a provider by pressing this. Say so here
    // rather than sending a request the backend will refuse — but ask the
    // backend's question, not a narrower one: somebody invited into a Portfolio
    // has no provider journey of their own and still belongs in the workspace.
    if (!state.me.capabilities.available_workspaces.includes("provider")) {
      setWorkspaceError(
        "This account is registered as a tenant. Provider accounts are created at sign-up, and "
        + "a Portfolio owner can invite you into their Team.",
      );
      return;
    }

    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      // Ask for the provider experience and go where the backend says that
      // lands. It is the verification screen until standing is approved, and
      // jumping straight to the provider tabs was a promise the API would then
      // refuse.
      const me = await chooseWorkspace("provider");
      await refreshMe();
      router.replace(resolveEntryRoute(me) as never);
    } catch (cause) {
      setWorkspaceError(
        cause instanceof ApiFailure ? cause.error.message : "Could not open property tools.",
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }, [refreshMe, router, state]);

  useEffect(() => {
    if (providerRequested && state.status !== "loading") {
      void openListingWorkspace();
    }
  }, [openListingWorkspace, providerRequested, state.status]);

  return (
    <ScrollView
      // The soft green ground behind this (`HomeGround`) is what sets the white
      // cards apart, so the scroller paints nothing of its own. It was a
      // `FlatList` while Home showed listings; with those gone there is no list
      // left to virtualise, and a list that can never have a row is machinery
      // pretending to be a feature.
      contentContainerStyle={{
        padding: tenantMode ? density.pagePadding : space[5],
        paddingBottom: space[12],
        gap: space[4],
      }}
    >
      <View style={{ gap: space[4] }}>
        {tenantMode ? (
            <TenantHome
              name={displayName}
              tenancies={tenancies}
              applications={applications}
              viewings={viewings}
              leases={leases}
              joinRequests={joinRequests}
              error={homeError}
              loading={homeLoading}
              unreadNotifications={unreadNotifications}
              recentActivity={recentActivity}
              onNotifications={() => router.push("/(app)/notifications" as never)}
              onRentAccount={(tenancy) =>
                router.push({
                  pathname: "/(app)/rent-account",
                  params: {
                    leaseId: tenancy.lease?.id ?? "",
                    tenantName: displayName,
                    propertyTitle: tenancy.property.title,
                    unitLabel: tenancy.space.unit_label,
                    bedLabel: tenancy.space.bed_label ?? "",
                    tenancyId: tenancy.id,
                    mode: "tenant",
                  },
                } as never)
              }
              onJoin={() => router.push("/(app)/tenant-setup" as never)}
              onExplore={() => router.push("/(app)/(tabs)/explore" as never)}
              onTenancy={(tenancy) =>
                router.push({
                  pathname: "/(app)/tenancy",
                  params: { tenancyId: tenancy.id },
                } as never)
              }
              onAgreements={() => router.push("/(app)/leases" as never)}
              onViewings={() => router.push("/(app)/viewings" as never)}
              onApplications={() => router.push("/(app)/applications" as never)}
            />
        ) : (
          <>
            <PublicHome
              onExplore={() => router.push("/(app)/(tabs)/explore")}
              onProvider={() => void openListingWorkspace()}
              providerLabel={
                me?.capabilities.provider.workspace_access
                  ? "Open property tools"
                  : "I own or manage property"
              }
              providerBusy={workspaceBusy || providerRequested}
              providerBusyLabel={
                state.status === "loading" ? "Checking your session…" : "Opening…"
              }
              showProvider={!me || me.capabilities.available_workspaces.includes("provider")}
            />
            {workspaceError ? <Notice tone="error" title={workspaceError} /> : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}
