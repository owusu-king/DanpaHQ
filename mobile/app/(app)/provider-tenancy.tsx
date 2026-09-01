import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { TenantLeaseActions } from "@/components/tenant/LeaseActions";
import { Button, Notice, Surface, Type, space } from "@/components/ui";
import { formatMinor } from "@/listings";
import { getPortfolioSummary, listOrganizationProperties, type ManagedProperty, type PortfolioSummary } from "@/organizations";
import { theme } from "@/theme";

type Tenant = PortfolioSummary["tenants"][number];

export default function ProviderTenancyScreen() {
  const router = useRouter();
  const { tenancyId, organizationId } = useLocalSearchParams<{ tenancyId: string; organizationId: string }>();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [property, setProperty] = useState<ManagedProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!organizationId || !tenancyId) return;
    setLoading(true);
    try {
      const [summary, properties] = await Promise.all([
        getPortfolioSummary(organizationId),
        listOrganizationProperties(organizationId),
      ]);
      const match = summary.tenants.find((row) => row.tenancy_id === tenancyId || row.occupancy_id === tenancyId) ?? null;
      setTenant(match);
      setProperty(properties.find((row) => row.id === match?.property_id) ?? null);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this tenancy.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, tenancyId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) return <View style={{ padding: space[5] }}><Type variant="caption">Loading tenancy…</Type></View>;
  if (error) return <View style={{ padding: space[5] }}><Notice tone="error" title={error} /></View>;
  if (!tenant) return <View style={{ padding: space[5], gap: space[3] }}><Notice tone="info" title="Tenancy not found" /><Button label="Back to Tenants" variant="secondary" onPress={() => router.back()} /></View>;

  const status = tenancyLabel(tenant);
  const currency = tenant.lease_rent_currency ?? "GHS";

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[6] }}>
      <View style={{ gap: space[2] }}>
        <Type variant="display2" accessibilityRole="header">{tenant.name}</Type>
        <Type variant="body">{status} · {tenant.property_title}</Type>
      </View>

      {status === "Agreement needed" ? <Notice tone="warning" title="This occupancy needs a Rooomly agreement" body="Prepare the agreement before treating this as an active platform tenancy." /> : null}
      {tenant.rent.status === "overdue" ? <Notice tone="warning" title={`${formatMinor(tenant.rent.overdue_minor, currency)} is overdue`} body={tenant.rent.next_due_on ? `Next due date recorded: ${formatDate(tenant.rent.next_due_on)}.` : "Open Payments to review the rent record."} /> : null}

      <Section title="Tenancy">
        <Fact label="Status" value={status} />
        <Fact label="Home" value={`${tenant.unit_label}${tenant.bed_label ? ` · ${tenant.bed_label}` : ""}`} />
        <Fact label="Starts" value={tenant.lease_starts_on ? formatDate(tenant.lease_starts_on) : "Not recorded"} />
        <Fact label="Ends" value={tenant.lease_ends_on ? formatDate(tenant.lease_ends_on) : "Open-ended / not recorded"} />
      </Section>

      <Section title="Agreement and rent">
        <Fact label="Agreement" value={tenant.lease_status ? humanize(tenant.lease_status) : "Not prepared"} />
        <Fact label="Rent" value={tenant.lease_rent_minor === null ? "Not recorded" : `${formatMinor(tenant.lease_rent_minor, currency)} per ${tenant.lease_rent_period === "yearly" ? "year" : "month"}`} />
        <Fact label="Rent position" value={tenant.rent.status === "current" ? "Paid up" : humanize(tenant.rent.status)} />
        <Fact label="Outstanding" value={formatMinor(tenant.rent.outstanding_minor, currency)} />
        <View style={{ marginTop: space[3] }}>
          <TenantLeaseActions
            unitId={tenant.unit_id}
            bedId={tenant.bed_id}
            tenantId={tenant.user_id}
            tenantName={tenant.name}
            leaseId={tenant.lease_id}
            leaseStatus={tenant.lease_status as Parameters<typeof TenantLeaseActions>[0]["leaseStatus"]}
            allowed={property?.capabilities.leases.allowed ?? false}
            onChanged={load}
          />
        </View>
      </Section>

      <Surface style={{ gap: space[2] }}>
        <Type variant="title2" accessibilityRole="header">Related records</Type>
        <RelatedAction label={tenant.property_title} detail="Property" onPress={() => router.push({ pathname: "/(app)/provider-property", params: { propertyId: tenant.property_id } } as never)} />
        <RelatedAction label={`${tenant.unit_label}${tenant.bed_label ? ` · ${tenant.bed_label}` : ""}`} detail="Unit" onPress={() => router.push({ pathname: "/(app)/space", params: { unitId: tenant.unit_id } } as never)} />
        <RelatedAction label="Payments" detail="Rent and payment records" onPress={() => router.push("/(app)/(provider-tabs)/payments" as never)} />
      </Surface>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={{ gap: space[1] }}><Type variant="title2" accessibilityRole="header" style={{ marginBottom: space[2] }}>{title}</Type>{children}</View>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={{ paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"], gap: space[1] }}><Type variant="caption">{label}</Type><Type variant="bodyStrong">{value}</Type></View>;
}

function RelatedAction({ label, detail, onPress }: { label: string; detail: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}, ${detail}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingVertical: space[2],
        borderBottomWidth: 1,
        borderBottomColor: theme.color.field["200"],
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <Type variant="bodyStrong">{label}</Type>
        <Type variant="caption">{detail}</Type>
      </View>
      <Type variant="title2" style={{ color: theme.color.kola["600"] }}>›</Type>
    </Pressable>
  );
}

function tenancyLabel(tenant: Tenant) {
  if (tenant.tenancy_status === "pending_lease" || !tenant.lease_id) return "Agreement needed";
  if (tenant.tenancy_status === "upcoming") return "Upcoming tenancy";
  return tenant.tenancy_status === "active" ? "Active tenancy" : "Tenancy";
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}
