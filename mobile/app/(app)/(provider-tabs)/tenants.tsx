import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { UnitAccessCodeManagement } from "@/components/property/UnitAccessCodeManagement";
import { Button, Choice, Field, Notice, Surface, Type, space } from "@/components/ui";
import { formatMinor } from "@/listings";
import { getPortfolioSummary, listOrganizations, type PortfolioSummary } from "@/organizations";
import { theme } from "@/theme";

type Tenant = PortfolioSummary["tenants"][number];
type Access = PortfolioSummary["tenant_access"][number];

/** How many share-ready Units this tab shows before handing over to Units. */
const ACCESS_PREVIEW = 3;
type ViewName = "tenants" | "access";
type TenantFilter = "all" | "attention" | "overdue" | "current";
type ListItem = { kind: "tenant"; value: Tenant } | { kind: "access"; value: Access };

export default function ProviderTenantsScreen() {
  const router = useRouter();
  const { view: requestedView } = useLocalSearchParams<{ view?: ViewName | "requests" }>();
  const { activeContext } = useAuth();
  const [organizationId, setOrganizationId] = useState("");
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [view, setView] = useState<ViewName>(requestedView === "access" ? "access" : "tenants");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TenantFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (requestedView === "requests") router.replace("/(app)/provider-applications" as never);
    else if (requestedView === "access" || requestedView === "tenants") setView(requestedView);
  }, [requestedView, router]);

  const load = useCallback(async () => {
    try {
      const organizations = await listOrganizations();
      const preferredId = activeContext?.startsWith("organization:") ? activeContext.slice("organization:".length) : "";
      const organization = organizations.find((row) => row.id === preferredId) ?? organizations[0];
      setOrganizationId(organization?.id ?? "");
      setSummary(organization ? await getPortfolioSummary(organization.id) : null);
      setError("");
    } catch (cause) {
      setSummary(null);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load tenants.");
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const items = useMemo<ListItem[]>(() => {
    if (!summary) return [];
    if (view === "access") {
      return summary.tenant_access
        .filter((value) => value.condition_state === "approved" && value.availability.state === "available")
        .slice(0, ACCESS_PREVIEW)
        .map((value) => ({ kind: "access", value }));
    }
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return summary.tenants
      .filter((tenant) => {
        if (filter === "attention") return tenantNeedsAttention(tenant);
        if (filter === "overdue") return tenant.rent.status === "overdue";
        if (filter === "current") return tenant.rent.status === "current" && tenant.tenancy_status === "active";
        return true;
      })
      .filter((tenant) => !needle || [tenant.name, tenant.property_title, tenant.unit_label, tenant.bed_label]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("en-GH").includes(needle)))
      .sort((a, b) => Number(tenantNeedsAttention(b)) - Number(tenantNeedsAttention(a)) || a.name.localeCompare(b.name))
      .map((value) => ({ kind: "tenant", value }));
  }, [filter, query, summary, view]);

  const readyCount = summary?.tenant_access.filter(
    (value) => value.condition_state === "approved" && value.availability.state === "available",
  ).length ?? 0;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.kind === "tenant" ? item.value.occupancy_id : item.value.unit_id}
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[3] }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.kola["600"]} />}
      ListHeaderComponent={
        <View style={{ gap: space[4], marginBottom: space[2] }}>
          <View style={{ gap: space[2] }}>
            <Type variant="display2" accessibilityRole="header">Tenants</Type>
            <Type variant="body">Current rental relationships and private Unit access.</Type>
          </View>
          {error ? <Notice tone="error" title={error} /> : null}
          {summary ? (
            <Type variant="caption" accessibilityLabel="Portfolio tenancy summary">
              {summary.tenants.length} active relationship{summary.tenants.length === 1 ? "" : "s"} · {formatMinor(summary.money.overdue_minor)} overdue
            </Type>
          ) : null}
          <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            <TenantTab label="Tenants" selected={view === "tenants"} onPress={() => setView("tenants")} />
            <TenantTab label="Private access" selected={view === "access"} onPress={() => setView("access")} />
          </View>
          {view === "tenants" && summary?.tenants.length ? (
            <View style={{ gap: space[3] }}>
              <Field label="Search tenants" value={query} onChangeText={setQuery} placeholder="Name, Property, Unit or bed" returnKeyType="search" />
              <Choice
                label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "attention", label: "Needs attention" },
                  { value: "overdue", label: "Overdue" },
                  { value: "current", label: "Paid up" },
                ]}
              />
            </View>
          ) : null}
          {view === "access" ? <View><Type variant="title2" accessibilityRole="header">Private Unit access</Type><Type variant="caption">Create a code only when you are ready to share a verified, available Unit privately.</Type></View> : null}
        </View>
      }
      renderItem={({ item }) => {
        if (item.kind === "tenant") {
          const tenant = item.value;
          return (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${tenant.name}, ${tenancyLabel(tenant)}, ${tenant.property_title}, ${tenant.unit_label}, ${rentLabel(tenant)}`}
              onPress={() => router.push({ pathname: "/(app)/provider-tenancy", params: { tenancyId: tenant.tenancy_id ?? tenant.occupancy_id, organizationId } } as never)}
              style={({ pressed }) => ({ minHeight: 84, paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"], opacity: pressed ? 0.72 : 1 })}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
                <View style={{ flex: 1, gap: space[1] }}>
                  <Type variant="bodyStrong">{tenant.name}</Type>
                  <Type variant="caption">{tenant.property_title} · {tenant.unit_label}{tenant.bed_label ? ` · ${tenant.bed_label}` : ""}</Type>
                  <Type variant="caption">{tenancyLabel(tenant)} · {rentLabel(tenant)}</Type>
                </View>
                <Type variant="title2" style={{ color: theme.color.kola["600"], alignSelf: "center" }}>›</Type>
              </View>
            </Pressable>
          );
        }
        const access = item.value;
        return (
          <Surface style={{ gap: space[3] }}>
            <View style={{ gap: space[1] }}><Type variant="label">{access.property_title.toUpperCase()}</Type><Type variant="title2">{access.unit_label}</Type></View>
            <UnitAccessCodeManagement
              unitId={access.unit_id}
              accessCode={access.access_code}
              verified={access.condition_state === "approved"}
              occupied={access.availability.state === "occupied"}
              onChanged={load}
            />
            <Button label="View Unit" variant="quiet" onPress={() => router.push({ pathname: "/(app)/space", params: { propertyId: access.property_id, unitId: access.unit_id } } as never)} />
          </Surface>
        );
      }}
      ListFooterComponent={view === "access" && items.length ? <AccessFooter shown={items.length} ready={readyCount} unavailable={(summary?.tenant_access.length ?? 0) - readyCount} onUnits={() => router.push("/(app)/units" as never)} /> : null}
      ListEmptyComponent={summary === null && !error ? <Type variant="caption">Loading…</Type> : <EmptyState view={view} hasTenants={Boolean(summary?.tenants.length)} unavailableAccess={(summary?.tenant_access.length ?? 0) - items.length} onProperties={() => router.push("/(app)/(provider-tabs)/properties" as never)} />}
    />
  );
}

/**
 * What is not on screen, and the one way through to all of it.
 *
 * Mirrors the web tab: this is somewhere to create a code, not the inventory.
 * Units carries the same section on every Unit, so it is a complete answer.
 */
function AccessFooter({ shown, ready, unavailable, onUnits }: { shown: number; ready: number; unavailable: number; onUnits: () => void }) {
  const capped = ready > shown;
  if (!capped && unavailable <= 0) return null;
  return (
    <View style={{ gap: space[2], paddingTop: space[2] }}>
      <Type variant="caption">
        {capped ? `Showing ${shown} of ${ready} ready to share. ` : ""}
        {unavailable > 0 ? `${unavailable} other Unit${unavailable === 1 ? " is" : "s are"} not ready yet.` : ""}
      </Type>
      <Button label="See all Units" variant="quiet" onPress={onUnits} />
    </View>
  );
}

function TenantTab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => ({ minHeight: 48, minWidth: 96, paddingHorizontal: space[3], paddingVertical: space[2], justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: selected ? theme.color.kola["600"] : theme.color.field["300"], borderRadius: 8, backgroundColor: selected ? theme.color.kola["50"] : theme.color.field["0"], opacity: pressed ? 0.72 : 1 })}>
      <Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["700"], textAlign: "center" }}>{label}</Type>
    </Pressable>
  );
}

function EmptyState({ view, hasTenants, unavailableAccess, onProperties }: { view: ViewName; hasTenants: boolean; unavailableAccess: number; onProperties: () => void }) {
  if (view === "tenants") return <Notice tone="info" title={hasTenants ? "No matching tenants" : "No active tenancies"} body={hasTenants ? "Change the search or filter to see other relationships." : "Approved requests appear here after an agreement is accepted and activated."} />;
  return <View style={{ gap: space[3] }}><Notice tone="info" title="No Units ready to share privately" body={unavailableAccess > 0 ? `${unavailableAccess} Unit${unavailableAccess === 1 ? " is" : "s are"} not verified or available.` : "A Unit must be verified and available before it can issue an access code."} /><Button label="Review Properties" variant="secondary" onPress={onProperties} /></View>;
}

function tenantNeedsAttention(tenant: Tenant) {
  return tenant.tenancy_status === "pending_lease" || !tenant.lease_id || tenant.rent.status !== "current";
}

function tenancyLabel(tenant: Tenant) {
  if (tenant.tenancy_status === "pending_lease" || !tenant.lease_id) return "Agreement needed";
  if (tenant.tenancy_status === "upcoming") return "Upcoming tenancy";
  return tenant.tenancy_status === "active" ? "Active tenancy" : "Tenancy";
}

function rentLabel(tenant: Tenant) {
  if (tenant.rent.status === "current") return "Paid up";
  const amount = tenant.rent.status === "overdue" ? tenant.rent.overdue_minor : tenant.rent.outstanding_minor;
  return `${formatMinor(amount, tenant.lease_rent_currency ?? "GHS")} ${tenant.rent.status}`;
}
