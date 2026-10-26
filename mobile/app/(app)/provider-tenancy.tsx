import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import { EntityHeader, StatusLine, type StatusTone } from "@/components/property/WorkspacePatterns";
import {
  EDGE,
  Fact,
  GroupLabel,
  Lead,
  LinkRow,
  RecordPanel,
  type RecordTone,
} from "@/components/record/RecordSurfaces";
import { TenantLeaseActions } from "@/components/tenant/LeaseActions";
import { Notice, space } from "@/components/ui";
import { formatMinor } from "@/listings";
import { getPortfolioSummary, listOrganizationProperties, type ManagedProperty, type PortfolioSummary } from "@/organizations";
import { useSafeBottom } from "@/platform";

type Tenant = PortfolioSummary["tenants"][number];

/**
 * One tenancy, from the provider's side.
 *
 * The tenant's own record asks "what does my home cost me"; this asks "where
 * does this arrangement stand, and what does it need from me". So the rent
 * position leads, the agreement carries the one act its status allows, and the
 * Property, the Unit and the money each keep a row out to their own record.
 *
 * Refined on review (2026-09-21) onto the record surfaces, replacing a column
 * of bare label/value rows and a "Related records" card of text chevrons.
 */
export default function ProviderTenancyScreen() {
  const router = useRouter();
  const { tenancyId, organizationId } = useLocalSearchParams<{ tenancyId: string; organizationId: string }>();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [property, setProperty] = useState<ManagedProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageBottom = useSafeBottom(space[8]);

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

  if (loading && !tenant) return <TenancySkeleton />;
  if (error && !tenant) return <View style={{ padding: space[5] }}><Notice tone="error" title={error} /></View>;
  if (!tenant) return <View style={{ padding: space[5] }}><Notice tone="info" title="Tenancy not found" body="It may have ended, or the link may be wrong." /></View>;

  const status = tenancyLabel(tenant);
  const currency = tenant.lease_rent_currency ?? "GHS";
  const overdue = tenant.rent.overdue_minor > 0;
  const outstanding = tenant.rent.outstanding_minor;
  const tone: RecordTone = overdue ? "alert" : outstanding > 0 ? "waiting" : "good";
  const home = `${tenant.unit_label}${tenant.bed_label ? ` · ${tenant.bed_label}` : ""}`;

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}>
      <EntityHeader
        eyebrow="Tenancy"
        title={tenant.name}
        subtitle={`${tenant.property_title} · ${home}`}
        status={<StatusLine label={status} tone={statusTone(tenant)} />}
      />

      {error ? <Notice tone="error" title={error} /> : null}

      <RecordPanel>
        <Lead
          label="Outstanding"
          value={formatMinor(outstanding, currency)}
          note={
            overdue
              ? `${formatMinor(tenant.rent.overdue_minor, currency)} of it is overdue`
              : outstanding > 0
                ? tenant.rent.next_due_on ? `Next due ${formatDate(tenant.rent.next_due_on)}` : "Nothing overdue"
                : "Paid up"
          }
          tone={tone}
        />
        <View style={styles.rule} />
        <Fact first label="Rent" value={tenant.lease_rent_minor === null ? "Not recorded" : `${formatMinor(tenant.lease_rent_minor, currency)} per ${tenant.lease_rent_period === "yearly" ? "year" : "month"}`} />
        <Fact label="Starts" value={tenant.lease_starts_on ? formatDate(tenant.lease_starts_on) : "Not recorded"} />
        <Fact label="Ends" value={tenant.lease_ends_on ? formatDate(tenant.lease_ends_on) : "Open-ended"} />
      </RecordPanel>

      <View style={styles.section}>
        <GroupLabel>Agreement and rent</GroupLabel>
        <RecordPanel style={styles.actionPanel}>
          <Fact
            first
            label="Agreement"
            value={tenant.lease_status ? humanize(tenant.lease_status) : "Not prepared"}
            tone={tenant.lease_status === "active" ? "good" : tenant.lease_status ? "waiting" : "alert"}
          />
          {/* The agreement itself, from the section that talks about it — its
              terms, rent schedule and signatures live on its own record. */}
          {tenant.lease_id ? (
            <LinkRow
              icon="document-text-outline"
              label="Open agreement"
              detail="Terms, rent schedule and signatures"
              onPress={() => router.push({ pathname: "/(app)/provider-lease", params: { leaseId: tenant.lease_id } } as never)}
            />
          ) : null}
          <View style={styles.actions}>
            <TenantLeaseActions
              unitId={tenant.unit_id}
              bedId={tenant.bed_id}
              tenantId={tenant.user_id}
              tenantName={tenant.name}
              leaseId={tenant.lease_id}
              leaseStatus={tenant.lease_status as Parameters<typeof TenantLeaseActions>[0]["leaseStatus"]}
              allowed={property?.capabilities?.leases?.allowed ?? false}
              onChanged={load}
            />
          </View>
        </RecordPanel>
      </View>

      <View style={styles.section}>
        <GroupLabel>Related records</GroupLabel>
        <RecordPanel>
          <LinkRow
            first
            icon="business-outline"
            label={tenant.property_title}
            detail="The Property this home belongs to"
            onPress={() => router.push({ pathname: "/(app)/provider-property", params: { propertyId: tenant.property_id } } as never)}
          />
          <LinkRow
            icon="cube-outline"
            label={home}
            detail="The Unit itself"
            onPress={() => router.push({ pathname: "/(app)/space", params: { unitId: tenant.unit_id } } as never)}
          />
          <LinkRow
            icon="cash-outline"
            label="Payments"
            detail="Rent and payment records across the Portfolio"
            onPress={() => router.push("/(app)/(provider-tabs)/payments" as never)}
          />
        </RecordPanel>
      </View>
    </ScrollView>
  );
}

/** Shaped like the record it becomes, so nothing jumps when the tenancy arrives. */
function TenancySkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading this tenancy" style={styles.page}>
      <Bone width="38%" height={13} />
      <Bone width="64%" height={22} />
      <RecordPanel style={styles.skeletonPanel}>
        <Bone width="34%" height={12} />
        <Bone width="50%" height={30} />
        <Bone height={44} />
      </RecordPanel>
    </View>
  );
}

function tenancyLabel(tenant: Tenant) {
  if (tenant.tenancy_status === "pending_lease" || !tenant.lease_id) return "Agreement needed";
  if (tenant.tenancy_status === "upcoming") return "Upcoming tenancy";
  return tenant.tenancy_status === "active" ? "Active tenancy" : "Tenancy";
}

function statusTone(tenant: Tenant): StatusTone {
  if (tenant.tenancy_status === "pending_lease" || !tenant.lease_id) return "attention";
  if (tenant.tenancy_status === "upcoming") return "waiting";
  return tenant.tenancy_status === "active" ? "good" : "neutral";
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  page: {
    padding: space[4],
    gap: space[4],
  },
  section: {
    gap: space[2],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: space[4],
    backgroundColor: EDGE,
  },
  actionPanel: {
    paddingBottom: space[4],
  },
  actions: {
    paddingHorizontal: 14,
    paddingTop: space[3],
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
});
