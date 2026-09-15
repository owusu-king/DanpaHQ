import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, View } from "react-native";

import { ApiFailure } from "@/api";
import { listMyApplications, type RentalApplication } from "@/applications";
import { useAuth } from "@/auth";
import { listNotifications, type Notification } from "@/notifications";
import { HomeGround } from "@/components/home/HomeGround";
import { TenantHome } from "@/components/home/TenantHome";
import { useHomeDensity } from "@/components/home/plinth";
import { ListingCard } from "@/components/listings/ListingCard";
import { Button, Notice, Type, space } from "@/components/ui";
import { listMyLeases, type Lease } from "@/leases";
import { type Listing, searchListings } from "@/listings";
import { resolveEntryRoute } from "@/navigation";
import { listMyJoinRequests, listMyTenancies, type MyJoinRequest, type Tenancy } from "@/tenancy";
import { listMyViewings, type Viewing } from "@/viewings";
import { chooseWorkspace } from "@/workspace";

/**
 * Signed in, Home is the tenant's dashboard and stands on the soft green
 * ground; signed out it is the public browsing page on the ordinary ivory. The
 * ground only stops painting, so signing in never remounts the screen under it.
 */
export default function DiscoveryHomeScreen() {
  const { state } = useAuth();
  return (
    <HomeGround active={state.status === "signed_in"}>
      <DiscoveryHome />
    </HomeGround>
  );
}

function DiscoveryHome() {
  const router = useRouter();
  const density = useHomeDensity();
  const { providerError } = useLocalSearchParams<{ providerError?: string }>();
  const { state, refreshMe } = useAuth();
  const [listings, setListings] = useState<Listing[]>([]);
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
  // Only an account that actually holds provider capability, and only while it
  // is on the tenant side. A tenant-only account has nowhere to switch to.
  const canSwitchToProvider = Boolean(
    me
    && me.capabilities.active_workspace === "tenant"
    && me.capabilities.available_workspaces.includes("provider"),
  );
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

  /**
   * Whether this screen is the public browsing home.
   *
   * Signed out only. Gating on `tenantMode` was too narrow: a provider looking
   * at the tenant side has `active_workspace === "provider"`, so they fell
   * through to the browsing home and got the wall of listings this was meant to
   * remove — as did anybody signed in without a tenancy yet.
   *
   * Once somebody is signed in, this screen is theirs: the places they live in,
   * or the way to find and join one. Listings live in Explore, which is a tab.
   */
  const browsing = state.status === "signed_out";

  useEffect(() => {
    // Only for the browsing experience. A tenant's home is about the places
    // they already live in, so the request is not made rather than made and
    // discarded — it is their data.
    if (!browsing) {
      setListings([]);
      return;
    }
    void searchListings().then((page) => setListings(page.results)).catch(() => setListings([]));
  }, [browsing]);

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

  /** Back to the provider workspace, decided by the backend as always. */
  const switchToProvider = useCallback(async () => {
    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      const next = await chooseWorkspace("provider");
      await refreshMe();
      router.replace(resolveEntryRoute(next) as never);
    } catch (cause) {
      setWorkspaceError(
        cause instanceof ApiFailure ? cause.error.message : "Could not switch.",
      );
    } finally {
      setWorkspaceBusy(false);
    }
  }, [refreshMe, router]);

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
    <FlatList
      data={browsing ? listings.slice(0, 6) : []}
      keyExtractor={(item) => item.id}
      // Signed in, the soft green ground behind this list (`HomeGround`) is what
      // sets the dashboard's white cards apart, so the list paints nothing of its
      // own. Browsing keeps the ordinary ivory page: a wall of listing cards on
      // the ground would read as a dashboard.
      contentContainerStyle={{
        padding: tenantMode ? density.pagePadding : space[5],
        paddingBottom: tenantMode ? space[12] : space[5],
        gap: space[4],
      }}
      ListHeaderComponent={
        <View style={{ gap: space[4], marginBottom: tenantMode ? 0 : space[3] }}>
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
              canSwitchToProvider={canSwitchToProvider}
              switching={workspaceBusy}
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
              onSwitchToProvider={() => void switchToProvider()}
            />
          ) : (
            <>
              <View style={{ gap: space[2] }}>
                <Type variant="label">VERIFIED RENTALS IN GHANA</Type>
                <Type variant="display2">Find a place you can trust.</Type>
                {/* The signed-out line is about giving a phone number, which is
                    already answered for anybody signed in. */}
                <Type variant="body">
                  {browsing
                    ? "Browse first. Continue with phone only when you save, contact or apply."
                    : "Search in Explore, or use a verified Unit access code from your provider."}
                </Type>
              </View>
              <Button label="Search rentals" onPress={() => router.push("/(app)/(tabs)/explore")} />
              {!me || me.capabilities.available_workspaces.includes("provider") ? (
                <Button
                  label={me?.capabilities.provider.workspace_access ? "Open property tools" : "I own/manage property"}
                  variant="secondary"
                  onPress={() => void openListingWorkspace()}
                  busy={workspaceBusy || providerRequested}
                  busyLabel={state.status === "loading" ? "Checking your session…" : "Opening…"}
                />
              ) : null}
              {workspaceError ? <Notice tone="error" title={workspaceError} /> : null}
              {state.status === "signed_out" ? (
                <Notice tone="info" title="No account needed to browse" body="Your phone becomes useful when you want us to remember or send something." />
              ) : null}
            </>
          )}
          {browsing ? <Type variant="title2">New verified listings</Type> : null}
        </View>
      }
      renderItem={({ item }) => (
        <ListingCard
          listing={item}
          onPress={() => router.push({ pathname: "/(app)/listing/[id]", params: { id: item.id } })}
        />
      )}
      ListEmptyComponent={
        // A tenant with no listings shown is not an empty search result, and
        // telling them "no active rentals yet" on their own home would be
        // answering a question they did not ask. Explore is the tab for that.
        browsing ? (
          <Notice
            tone="info"
            title="No active rentals yet"
            body="Approved listings will appear here as soon as providers publish them."
          />
        ) : null
      }
    />
  );
}
