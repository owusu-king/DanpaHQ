import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { useAuth } from "@/auth";
import { Button, Notice, Type, space } from "@/components/ui";
import {
  ph,
  PlinthCard,
  plinthRow,
  plural,
  primarySurface,
  shortDate,
  surface,
  Ticks,
  tile,
  useHomeDensity,
} from "@/components/home/plinth";
import { HomeGround } from "@/components/home/HomeGround";
import { formatMinor } from "@/listings";
import { listReceivedApplications } from "@/applications";
import { listGrantedLeases, type Lease } from "@/leases";
import { listReceivedViewings, type Viewing } from "@/viewings";
import {
  getPortfolioSummary,
  listOrganizations,
  listOrganizationProperties,
  type ManagedProperty,
  type PortfolioSummary,
} from "@/organizations";
import { hapticsPolicy, pressableFeedback } from "@/platform";
import { useBlankOnPortfolioSwitch } from "@/portfolioScope";
import { theme } from "@/theme";

type AttentionSignal = {
  label: string;
  to: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: "warning" | "danger";
};

/**
 * The provider's control center, composed for a phone.
 *
 * The web dashboard's design language — paper surfaces, registration ticks on
 * the two that carry the screen, one gauge and one chart — recomposed for a
 * device that scrolls in one column and cannot hover, and set on the soft green
 * ground both phone Homes share.
 *
 * What that costs and what it buys: the leasing pipeline is gone, as it is on
 * web, because Home answers *what needs me* and a pipeline of everything in
 * flight is the Leases screen's job. Upcoming viewings stays, unlike web —
 * there is no persistent rail here, and "what is happening today" is the thing
 * a provider opens a phone for.
 *
 * Where the web hovers, this presses: holding the gauge reveals the count
 * behind the percentage, and tapping a column reads that period.
 */
export default function ProviderHomeScreen() {
  // Behind every state — a first Property, the skeleton and the Portfolio
  // itself — so Home never changes colour as its figures arrive.
  return (
    <HomeGround>
      <ProviderHome />
    </HomeGround>
  );
}

function ProviderHome() {
  const router = useRouter();
  const density = useHomeDensity();
  const { activeContext, state } = useAuth();
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [applications, setApplications] = useState(0);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [openedAt] = useState(() => Date.now());

  // Home is every figure about one Portfolio at once, so it is the screen where
  // the previous Portfolio's occupancy, money and attention list would sit
  // longest under the new one's name. Switching empties it back to its skeleton.
  useBlankOnPortfolioSwitch(activeContext, () => {
    setSummary(null);
    setProperties([]);
    setViewings([]);
    setApplications(0);
    setLeases([]);
    setLoading(true);
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const organizations = await listOrganizations();
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const organization = organizations.find((row) => row.id === preferred) ?? organizations[0];
      if (!organization) {
        setSummary(null);
        setProperties([]);
        setViewings([]);
        setApplications(0);
        setLeases([]);
        setError("");
        return;
      }
      // Every figure here is about one Portfolio, so the Portfolio is resolved
      // first and each list is asked for it. Fetching the enquiries first meant
      // Home counted viewings, tenancy requests and agreements from every
      // Portfolio the account belonged to against one Portfolio's Properties.
      const scope = { organization: organization.id };
      const [enquiries, next, propertyRows] = await Promise.all([
        Promise.allSettled([
          listReceivedViewings(true, scope),
          listReceivedApplications(true, scope),
          listGrantedLeases(scope),
        ]),
        getPortfolioSummary(organization.id),
        listOrganizationProperties(organization.id),
      ]);
      setViewings(enquiries[0].status === "fulfilled" ? enquiries[0].value : []);
      setApplications(enquiries[1].status === "fulfilled" ? enquiries[1].value.length : 0);
      setLeases(enquiries[2].status === "fulfilled" ? enquiries[2].value : []);
      setSummary(next);
      setProperties(propertyRows);
      setError("");
    } catch {
      setError("Could not refresh your Portfolio.");
    } finally {
      setLoading(false);
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const name = state.status === "signed_in"
    ? state.me.preferred_name || state.me.first_name || "there"
    : "there";
  const counts = summary?.counts;
  const money = summary?.money;
  const unitCount = counts?.units ?? 0;
  const occupied = counts?.occupied_units ?? 0;
  const available = counts?.vacant_units ?? 0;
  const occupancy = unitCount ? Math.round((occupied / unitCount) * 100) : 0;

  const needsUpdate = properties.filter((row) =>
    ["changes_required", "rejected", "suspended", "expired"].includes(row.verification.review_state),
  ).length;
  const drafts = leases.filter((lease) => lease.status === "draft").length;
  const awaitingYou = money?.payment_records_awaiting_you ?? 0;
  const requests = applications + (counts?.pending_join_requests ?? 0);

  const attention = [
    requests ? { label: `${requests} tenancy ${plural(requests, "request", "requests")}`, to: "/(app)/provider-applications", icon: "document-text-outline", tone: "warning" } : null,
    viewings.length ? { label: `${viewings.length} viewing ${plural(viewings.length, "request", "requests")}`, to: "/(app)/provider-viewings", icon: "calendar-outline", tone: "warning" } : null,
    drafts ? { label: `${drafts} ${plural(drafts, "agreement", "agreements")} to send`, to: "/(app)/leases", icon: "create-outline", tone: "warning" } : null,
    awaitingYou ? { label: `${awaitingYou} payment ${plural(awaitingYou, "record", "records")} to confirm`, to: "/(app)/(provider-tabs)/payments", icon: "wallet-outline", tone: "warning" } : null,
    money?.overdue_minor ? { label: `${formatMinor(money.overdue_minor)} overdue`, to: "/(app)/(provider-tabs)/payments", icon: "alert-circle-outline", tone: "danger" } : null,
    money?.settlement_attention_minor ? { label: `${formatMinor(money.settlement_attention_minor)} needs payout review`, to: "/(app)/(provider-tabs)/payments", icon: "alert-circle-outline", tone: "danger" } : null,
    needsUpdate ? { label: `${needsUpdate} ${plural(needsUpdate, "Property needs", "Properties need")} an update`, to: "/(app)/(provider-tabs)/properties", icon: "shield-checkmark-outline", tone: "danger" } : null,
  ].filter((item): item is AttentionSignal => item !== null);

  const upcoming = viewings
    .filter((row) => row.confirmed_starts_at && row.is_upcoming)
    .sort((a, b) => (a.confirmed_starts_at ?? "").localeCompare(b.confirmed_starts_at ?? ""))
    .slice(0, 3);

  const activity = [
    ...(summary?.recent_payments ?? []).map((row) => ({
      id: `payment-${row.id}`,
      at: row.paid_on,
      text: `${row.status === "confirmed" ? "Payment confirmed" : "Payment recorded"} — ${row.tenant_name}, ${row.unit_label}`,
      icon: "wallet-outline" as const,
    })),
    ...(summary?.recent_activity ?? []).map((row) => ({
      id: `a-${row.id}`,
      at: row.at,
      text: row.title,
      icon: (row.kind === "property_added" ? "business-outline" : "people-outline") as keyof typeof Ionicons.glyphMap,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3);

  // The web and mobile Homes highlight the same Property. Size leads because
  // this is a Portfolio summary; occupancy only breaks a tie.
  const featuredProperty = [...properties].sort((left, right) =>
    right.unit_count - left.unit_count
    || right.occupied_unit_count - left.occupied_unit_count
    || left.title.localeCompare(right.title)
  )[0] ?? null;

  // A Portfolio with nothing in it gets a beginning, not a screen of zeroes.
  if (!loading && !summary && !error) {
    return (
      <ScrollView contentContainerStyle={{ padding: density.pagePadding, gap: density.sectionGap }}>
        <View style={{ gap: space[1] }}>
          {/* The type's muted default is set for ivory; on the green it is darker. */}
          <Type variant="label" style={{ color: ph.ink70 }}>YOUR PORTFOLIO</Type>
          <Type variant="display2" accessibilityRole="header" style={{ fontSize: density.headingSize, lineHeight: density.headingLine }}>Good day, {name}</Type>
        </View>
        <View style={{ gap: space[3], paddingLeft: space[4], borderLeftWidth: 3, borderLeftColor: theme.color.kola["600"] }}>
          <Type variant="title2" accessibilityRole="header">Your Portfolio starts here</Type>
          <Type variant="caption" style={{ color: ph.ink70 }}>
            Add your first Property and Rooomly will help you organize its Units, tenants,
            agreements and rent.
          </Type>
          <Button label="Add first Property" onPress={() => router.push("/(app)/private-property" as never)} />
        </View>
      </ScrollView>
    );
  }

  if (loading && !summary) {
    return (
      <ScrollView contentContainerStyle={{ padding: density.pagePadding, paddingBottom: space[12], gap: density.sectionGap }}>
        <View style={{ gap: space[1] }}>
          <Type variant="label" style={{ color: ph.ink70 }}>YOUR PORTFOLIO</Type>
          <Type variant="display2" accessibilityRole="header" style={{ fontSize: density.headingSize, lineHeight: density.headingLine }}>Good day, {name}</Type>
        </View>
        <ProviderDashboardSkeleton />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: density.pagePadding, paddingBottom: space[12], gap: density.sectionGap }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          tintColor={ph.brand}
        />
      }
    >
      <View style={{ gap: space[1], paddingBottom: density.compact ? space[1] : space[2] }}>
        <Type variant="label" style={{ fontSize: density.labelSize, lineHeight: 14, color: ph.ink70 }}>
          {summary?.organization.name.toUpperCase() ?? "YOUR PORTFOLIO"}
        </Type>
        <Type variant="display2" accessibilityRole="header" style={{ fontSize: density.headingSize, lineHeight: density.headingLine, color: ph.ink }}>
          Good day, {name}
        </Type>
        <View pointerEvents="none" style={{ flexDirection: "row", alignItems: "center", gap: space[2], marginTop: density.compact ? 2 : space[1] }}>
          <View style={{ width: density.compact ? 24 : 30, height: 2, backgroundColor: ph.gold }} />
          <View style={{ flex: 1, height: 1, backgroundColor: ph.line }} />
        </View>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}

      {featuredProperty ? (
        <PortfolioHighlight
          property={featuredProperty}
          onPress={() => router.push({ pathname: "/(app)/provider-property", params: { propertyId: featuredProperty.id } })}
        />
      ) : null}

      <PortfolioOverview
        occupancy={occupancy}
        occupied={occupied}
        units={unitCount}
        available={available}
        properties={counts?.properties ?? properties.length}
        tenants={counts?.active_tenants ?? 0}
        attention={attention.length}
        onProperties={() => router.push("/(app)/(provider-tabs)/properties" as never)}
        onUnits={() => router.push("/(app)/units" as never)}
        onTenants={() => router.push("/(app)/(provider-tabs)/tenants" as never)}
      />

      <AttentionPanel signals={attention} onOpen={(to) => router.push(to as never)} />

      <RentCollection
        collection={summary?.rent_collection ?? null}
        onPress={() => router.push("/(app)/(provider-tabs)/payments" as never)}
      />

      <PlinthCard
        title="Upcoming viewings"
        meta={upcoming.length ? `${upcoming.length} booked` : undefined}
        action={{ label: "All viewings", onPress: () => router.push("/(app)/provider-viewings" as never) }}
      >
        {upcoming.length ? (
          upcoming.map((row, index) => (
            <View key={row.id} style={plinthRow(index === 0, density.compact)}>
              <View style={{ width: density.compact ? 62 : 72 }}>
                <Type variant="bodyStrong" style={{ fontSize: density.compact ? 12.25 : 13, lineHeight: 17, color: ph.ink }}>
                  {whenLabel(row.confirmed_starts_at as string, openedAt)}
                </Type>
                <Type variant="caption" style={{ fontSize: density.compact ? 10.5 : 11, lineHeight: 15, color: ph.ink38 }}>
                  {shortDate(row.confirmed_starts_at as string)}
                </Type>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Type variant="bodyStrong" style={{ fontSize: density.compact ? 12.5 : 13.5, lineHeight: 18, color: ph.ink }}>{row.listing_headline}</Type>
                <Type variant="caption" style={{ fontSize: density.compact ? 11 : 12, lineHeight: 16, color: ph.ink55 }}>{row.tenant_name}</Type>
              </View>
            </View>
          ))
        ) : (
          <Type variant="caption" style={{ color: ph.ink38, paddingVertical: space[3] }}>
            {viewings.length ? `${viewings.length} waiting for times` : "Nothing booked"}
          </Type>
        )}
      </PlinthCard>

      {activity.length ? (
        <PlinthCard
          title="Recent activity"
          action={{ label: "Updates", onPress: () => router.push("/(app)/notifications" as never) }}
        >
          {activity.map((event, index) => (
            <View key={event.id} style={plinthRow(index === 0, density.compact)}>
              <View style={tile(event.icon === "wallet-outline", density.compact)}>
                <Ionicons
                  name={event.icon}
                  size={density.compact ? 13.5 : 15}
                  color={event.icon === "wallet-outline" ? ph.sage : ph.graphite}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Type variant="bodyStrong" style={{ fontSize: density.compact ? 12.25 : 13, lineHeight: 17, color: ph.ink }}>{event.text}</Type>
                <Type variant="caption" style={{ fontSize: density.compact ? 10.5 : 11.5, lineHeight: 15, color: ph.ink38 }}>{shortDate(event.at)}</Type>
              </View>
            </View>
          ))}
        </PlinthCard>
      ) : null}
    </ScrollView>
  );
}

/**
 * One Property worth recognizing, before the Portfolio is reduced to figures.
 * It stays deliberately shorter than the overview card: this is a way into the
 * Portfolio, not a second dashboard instrument.
 */
function PortfolioHighlight({
  property,
  onPress,
}: {
  property: ManagedProperty;
  onPress: () => void;
}) {
  const density = useHomeDensity();
  const occupied = property.occupied_unit_count;
  const total = property.unit_count;
  const occupancy = total ? Math.round((occupied / total) * 100) : 0;
  const where = [property.address.locality_name, property.address.district_name]
    .filter(Boolean)
    .join(", ");
  const imageWidth = density.veryCompact ? 88 : density.compact ? 96 : 108;
  const cardHeight = density.veryCompact ? 96 : density.compact ? 102 : 110;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${property.title}. Portfolio highlight. ${occupancy}% occupied.`}
      accessibilityHint="Open Property details"
      {...pressableFeedback(ph.paperDim)}
      style={({ pressed }) => ({
        width: "100%",
        height: cardHeight,
        flexDirection: "row",
        overflow: "hidden",
        backgroundColor: ph.paper,
        borderWidth: 1,
        borderColor: ph.edge,
        borderRadius: density.compact ? 14 : 16,
        opacity: pressed ? 0.88 : 1,
        transform: [{ scale: pressed ? 0.992 : 1 }],
      })}
    >
      <View
        style={{
          width: imageWidth,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          backgroundColor: ph.navy,
          borderRightWidth: 1,
          borderRightColor: ph.line,
        }}
      >
        {property.cover_url ? (
          <Image
            source={{ uri: property.cover_url }}
            accessible={false}
            resizeMode="cover"
            style={{ position: "absolute", inset: 0 }}
          />
        ) : (
          <Ionicons name="image-outline" size={density.compact ? 22 : 24} color="rgba(255,255,255,0.62)" />
        )}
      </View>

      <View style={{ flex: 1, minWidth: 0, justifyContent: "center", paddingHorizontal: density.compact ? 11 : 14, paddingVertical: density.compact ? 9 : 11 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 5, height: 5, transform: [{ rotate: "45deg" }], backgroundColor: ph.gold }} />
          <Type variant="label" style={{ flex: 1, fontSize: density.compact ? 8.5 : 9.5, lineHeight: 12, letterSpacing: 0.55, color: ph.ink38 }} numberOfLines={1}>
            PORTFOLIO HIGHLIGHT
          </Type>
          <Ionicons name="arrow-forward" size={density.compact ? 11 : 12} color={ph.graphite} />
        </View>

        <Type variant="bodyStrong" numberOfLines={1} style={{ marginTop: 3, fontSize: density.compact ? 13.5 : 14.5, lineHeight: 19, color: ph.ink }}>
          {property.title}
        </Type>
        <Type variant="caption" numberOfLines={1} style={{ fontSize: density.compact ? 10.5 : 11.5, lineHeight: 16, color: ph.ink55 }}>
          {where || "Location not added"} · {total} {plural(total, "Unit", "Units")}
        </Type>

        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], marginTop: density.compact ? 6 : 8 }}>
          <View style={{ flex: 1, height: 4, overflow: "hidden", borderRadius: 3, backgroundColor: ph.lineStrong }}>
            <View style={{ width: `${occupancy}%`, height: "100%", borderRadius: 3, backgroundColor: ph.sage }} />
          </View>
          <Type variant="caption" style={{ fontSize: density.compact ? 9.5 : 10.5, lineHeight: 13, fontWeight: "600", color: ph.sage }}>
            {occupancy}%
          </Type>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The Portfolio, at a glance.
 *
 * The gauge is the screen's one instrument. A phone has no hover, so the
 * gesture that reveals the count behind the percentage is a press — the same
 * trade the web dashboard makes, in the input this device actually has.
 */
function PortfolioOverview({
  occupancy,
  occupied,
  units,
  available,
  properties,
  tenants,
  attention,
  onProperties,
  onUnits,
  onTenants,
}: {
  occupancy: number;
  occupied: number;
  units: number;
  available: number;
  properties: number;
  tenants: number;
  attention: number;
  onProperties: () => void;
  onUnits: () => void;
  onTenants: () => void;
}) {
  const density = useHomeDensity();
  const [showCount, setShowCount] = useState(false);
  const clamped = Math.max(0, Math.min(occupancy, 100));
  const size = density.ringSize;
  const radius = size * 0.402;
  const strokeWidth = density.compact ? 7.5 : 9;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  const markAngle = (clamped * 3.6 - 90) * (Math.PI / 180);

  return (
    <View style={[primarySurface, { padding: density.cardPadding, borderRadius: density.compact ? 14 : 16 }]}>
      <Ticks />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], marginBottom: density.compact ? space[3] : space[4] }}>
        <Type variant="bodyStrong" style={{ fontSize: density.compact ? 13 : 14, lineHeight: 19, color: ph.ink }}>Portfolio overview</Type>
        <View style={{ flexShrink: 1, paddingHorizontal: density.compact ? 7 : 9, paddingVertical: density.compact ? 2 : 3, borderRadius: 20, backgroundColor: attention ? ph.amberSoft : ph.greenSoft }}>
          <Type variant="caption" numberOfLines={1} style={{ fontSize: density.compact ? 10.25 : 11.5, lineHeight: 15, fontWeight: "500", color: attention ? ph.amber : ph.sage }}>
            {attention ? `${attention} ${plural(attention, "item needs", "items need")} you` : "All systems normal"}
          </Type>
        </View>
      </View>

      {/* Side by side. Stacked, the dial pushed the figures most of a screen
          down and the card was most of a phone tall for six numbers. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: density.compact ? space[3] : space[4] }}>
        <Pressable
          onPressIn={() => setShowCount(true)}
          onPressOut={() => setShowCount(false)}
          accessibilityRole="summary"
          accessibilityLabel={`${clamped}% occupancy, ${occupied} of ${units} Units occupied`}
          style={{ width: size, height: size }}
        >
          <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <Circle cx={centre} cy={centre} r={radius} fill="none" stroke={ph.lineStrong} strokeWidth={strokeWidth} />
            <Circle
              cx={centre}
              cy={centre}
              r={radius}
              fill="none"
              stroke={ph.brand}
              strokeWidth={showCount ? strokeWidth + 1.5 : strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={circumference * (1 - clamped / 100)}
              transform={`rotate(-90 ${centre} ${centre})`}
            />
            {/* The gold register, and a caliper mark at the reading. */}
            <Circle
              cx={centre}
              cy={centre}
              r={radius}
              fill="none"
              stroke={ph.gold}
              strokeWidth={1}
              strokeDasharray="1 7.6"
              opacity={showCount ? 0.9 : 0.45}
            />
            {showCount ? (
              <Line
                x1={centre + Math.cos(markAngle) * (radius + (density.compact ? 6 : 8))}
                y1={centre + Math.sin(markAngle) * (radius + (density.compact ? 6 : 8))}
                x2={centre + Math.cos(markAngle) * (radius + (density.compact ? 13 : 17))}
                y2={centre + Math.sin(markAngle) * (radius + (density.compact ? 13 : 17))}
                stroke={ph.gold}
                strokeWidth={2}
                strokeLinecap="round"
              />
            ) : null}
          </Svg>
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
            <Type variant="display2" style={{ fontSize: density.compact ? 22 : 26, lineHeight: density.compact ? 25 : 30, color: ph.ink }}>{clamped}%</Type>
            <Type variant="label" style={{ fontSize: density.compact ? 8 : 9, lineHeight: 11, color: ph.ink38 }}>OCCUPIED</Type>
            <Type variant="caption" style={{ fontSize: density.compact ? 9 : 10.5, lineHeight: 12, color: showCount ? ph.graphite : "transparent", marginTop: 1 }}>
              {occupied} of {units}
            </Type>
          </View>
        </Pressable>

        <PortfolioLedger
          height={size}
          compact={density.compact}
          properties={properties}
          units={units}
          tenants={tenants}
          available={available}
          onProperties={onProperties}
          onUnits={onUnits}
          onTenants={onTenants}
        />
      </View>
    </View>
  );
}

/**
 * The numbers form a ledger, not four equal KPIs. Inventory is the governing
 * figure; Properties and tenancies explain its structure; vacancy is the
 * current operational condition. The gold register joins this reading to the
 * calibrated ring beside it.
 */
function PortfolioLedger({
  height,
  compact,
  properties,
  units,
  tenants,
  available,
  onProperties,
  onUnits,
  onTenants,
}: {
  height: number;
  compact: boolean;
  properties: number;
  units: number;
  tenants: number;
  available: number;
  onProperties: () => void;
  onUnits: () => void;
  onTenants: () => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        height,
        paddingLeft: compact ? space[2] : space[3],
        borderLeftWidth: 1,
        borderLeftColor: ph.lineStrong,
      }}
    >
      <Pressable
        onPress={onUnits}
        accessibilityRole="button"
        accessibilityLabel={`${units} Units`}
        accessibilityHint="Open Units"
        hitSlop={compact ? 3 : 2}
        style={{ flex: 1, minHeight: compact ? 35 : 42, justifyContent: "center" }}
        {...pressableFeedback(ph.paperDim)}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Type variant="display2" style={{ fontSize: compact ? 23 : 27, lineHeight: compact ? 26 : 30, letterSpacing: -0.4, color: ph.ink }}>
            {units}
          </Type>
          <View style={{ minWidth: 0, marginLeft: compact ? 7 : 9 }}>
            <Type variant="label" style={{ fontSize: compact ? 8.5 : 9, lineHeight: 11, letterSpacing: 0.55, color: ph.ink38 }}>
              RENTABLE
            </Type>
            <Type variant="bodyStrong" style={{ fontSize: compact ? 11.5 : 12.5, lineHeight: 15, fontWeight: "600", color: ph.ink70 }}>
              Units
            </Type>
          </View>
          <Ionicons name="arrow-forward" size={compact ? 10 : 11} color={ph.ink38} style={{ marginLeft: "auto" }} />
        </View>
      </Pressable>

      {/* A measured rule rather than another container: gold establishes the
          register, graphite carries it to the edge. */}
      <View pointerEvents="none" style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ width: compact ? 18 : 22, height: 1.5, backgroundColor: ph.gold }} />
        <View style={{ flex: 1, height: 1, backgroundColor: ph.line }} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "stretch", minHeight: compact ? 29 : 34 }}>
        <LedgerRelation label="Properties" value={properties} onPress={onProperties} compact={compact} />
        <View pointerEvents="none" style={{ width: 1, marginVertical: compact ? 6 : 7, backgroundColor: ph.line }} />
        <LedgerRelation label="Tenancies" value={tenants} onPress={onTenants} compact={compact} />
      </View>

      <Pressable
        onPress={onUnits}
        accessibilityRole="button"
        accessibilityLabel={`${available} Vacant Units`}
        accessibilityHint="Open vacant Units"
        hitSlop={compact ? 4 : 3}
        style={{ minHeight: compact ? 22 : 25, flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderTopColor: ph.line }}
        {...pressableFeedback(ph.paperDim)}
      >
        <View style={{ width: 9, height: 9, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: ph.greenSoft }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: ph.sage }} />
        </View>
        <Type variant="caption" style={{ flex: 1, fontSize: compact ? 9.5 : 10.5, lineHeight: 13, color: ph.ink55 }} numberOfLines={1}>
          <Type variant="caption" style={{ fontSize: compact ? 10.5 : 11.5, lineHeight: 13, fontWeight: "700", color: ph.sage }}>{available}</Type>
          {"  "}{available ? "vacant · ready to let" : "vacant · fully occupied"}
        </Type>
      </Pressable>
    </View>
  );
}

function LedgerRelation({ label, value, onPress, compact }: { label: "Properties" | "Tenancies"; value: number; onPress: () => void; compact: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      accessibilityHint={`Open ${label.toLowerCase()}`}
      hitSlop={compact ? 3 : 2}
      style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: compact ? 4 : 5, paddingHorizontal: compact ? 4 : 6 }}
      {...pressableFeedback(ph.paperDim)}
    >
      <Type variant="display2" style={{ fontSize: compact ? 14.5 : 16, lineHeight: compact ? 18 : 20, color: ph.ink }}>
        {value}
      </Type>
      <Type variant="caption" style={{ flex: 1, fontSize: compact ? 9.5 : 10.5, lineHeight: 13, color: ph.ink55 }} numberOfLines={1}>
        {label}
      </Type>
    </Pressable>
  );
}

/** Severity is a dot with a halo, and the action sits on the right. */
function AttentionPanel({ signals, onOpen }: { signals: AttentionSignal[]; onOpen: (to: string) => void }) {
  const density = useHomeDensity();
  return (
    <View style={[surface, { padding: density.cardPadding, borderRadius: density.compact ? 14 : 16 }]}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: space[2] }}>
        <Type variant="bodyStrong" style={{ fontSize: density.compact ? 13 : 14, lineHeight: 19, color: ph.ink }}>Needs attention</Type>
        <Type variant="caption" style={{ fontSize: density.compact ? 11.5 : 12.5, lineHeight: 17, color: ph.ink38 }}>
          {signals.length ? `${signals.length} ${plural(signals.length, "item", "items")}` : "All clear"}
        </Type>
      </View>

      {signals.length ? (
        signals.slice(0, 5).map((signal, index) => (
          <Pressable
            key={signal.label}
            onPress={() => onOpen(signal.to)}
            style={plinthRow(index === 0, density.compact)}
            accessibilityRole="button"
            {...pressableFeedback(ph.paperDim)}
          >
            <View
              style={{
                width: density.compact ? 6 : 7,
                height: density.compact ? 6 : 7,
                borderRadius: 4,
                backgroundColor: signal.tone === "danger" ? ph.brick : ph.amber,
                borderWidth: 3,
                borderColor: signal.tone === "danger" ? ph.brickSoft : ph.amberSoft,
              }}
            />
            <Type variant="bodyStrong" style={{ flex: 1, fontSize: density.compact ? 12.25 : 13.2, lineHeight: 17, color: ph.ink }}>{signal.label}</Type>
            <Type variant="caption" style={{ fontSize: density.compact ? 10.25 : 11, lineHeight: 15, color: ph.ink38 }}>
              {signal.tone === "danger" ? "Act now" : "Soon"}
            </Type>
            <Ionicons name="chevron-forward" size={density.compact ? 12 : 14} color={ph.ink38} />
          </Pressable>
        ))
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: density.compact ? space[2] : space[3], paddingVertical: space[2] }}>
          <View style={{ width: density.compact ? 24 : 26, height: density.compact ? 24 : 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: ph.greenSoft }}>
            <Ionicons name="checkmark" size={density.compact ? 13 : 14} color={ph.sage} />
          </View>
          <View style={{ flex: 1 }}>
            <Type variant="bodyStrong" style={{ fontSize: density.compact ? 12.25 : 13.2, lineHeight: 17, color: ph.ink }}>Nothing is waiting on you.</Type>
            <Type variant="caption" style={{ fontSize: density.compact ? 11 : 12, lineHeight: 16, color: ph.ink55 }}>Rent, agreements and Property checks are up to date.</Type>
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * Rent collection, on a phone.
 *
 * Collected is a line because it is a trend; outstanding is a column because it
 * is a quantity standing at a moment. They are never netted — money that
 * arrived and money that has not are different questions.
 *
 * A phone cannot hover, so a period is read by tapping its column. Six months
 * rather than twelve: twelve labels on a 360px screen is a smear, and the
 * yearly view is one tap away.
 */
function RentCollection({
  collection,
  onPress,
}: {
  collection: PortfolioSummary["rent_collection"] | null;
  onPress: () => void;
}) {
  const density = useHomeDensity();
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [active, setActive] = useState<number | null>(null);

  const all = collection ? collection[period] : [];
  const points = period === "monthly" ? all.slice(-6) : all;
  const hasYearly = (collection?.yearly.length ?? 0) > 1;
  const totals = points.reduce(
    (sum, row) => ({
      collected: sum.collected + row.collected_minor,
      outstanding: sum.outstanding + row.outstanding_minor,
    }),
    { collected: 0, outstanding: 0 },
  );

  const width = 300;
  const height = density.chartHeight;
  const left = 8;
  const right = 8;
  const top = 10;
  const bottom = 24;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const peak = Math.max(1, ...points.map((row) => Math.max(row.collected_minor, row.outstanding_minor)));
  const ceiling = Math.ceil((peak * 1.12) / 10 ** Math.max(Math.floor(Math.log10(peak * 1.12)) - 1, 0))
    * 10 ** Math.max(Math.floor(Math.log10(peak * 1.12)) - 1, 0);
  const step = points.length > 1 ? plotWidth / (points.length - 1) : 0;
  const x = (index: number) => (points.length > 1 ? left + step * index : left + plotWidth / 2);
  const y = (value: number) => top + plotHeight * (1 - value / ceiling);

  const line = points.map((row, index) => `${index ? "L" : "M"} ${x(index)} ${y(row.collected_minor)}`).join(" ");
  const area = points.length
    ? `${line} L ${x(points.length - 1)} ${top + plotHeight} L ${x(0)} ${top + plotHeight} Z`
    : "";
  const barWidth = Math.min(18, Math.max(8, step * 0.34));
  const reading = active !== null ? points[active] : null;
  const percent = (value: number) => `${value}%` as `${number}%`;
  const selectPoint = (index: number) => {
    setActive((current) => current === index ? null : index);
    if (hapticsPolicy.onSelection) {
      void import("expo-haptics")
        .then((haptics) => haptics.selectionAsync())
        .catch(() => null);
    }
  };

  return (
    <View style={[primarySurface, { padding: density.cardPadding, borderRadius: density.compact ? 14 : 16 }]}>
      <Ticks />
      <View style={{ flexDirection: density.veryCompact ? "column" : "row", alignItems: "flex-start", justifyContent: "space-between", gap: density.compact ? space[2] : space[3] }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Type variant="label" style={{ fontSize: density.compact ? 9.5 : 10.5, lineHeight: 13, color: ph.ink38 }}>RENT COLLECTION</Type>
          <Type variant="bodyStrong" style={{ fontSize: density.compact ? 13 : 14, lineHeight: 19, color: ph.ink }}>Received and outstanding</Type>
        </View>
        {hasYearly ? (
          <View style={{ flexDirection: "row", alignSelf: density.veryCompact ? "flex-start" : "auto", padding: density.compact ? 2 : 3, borderRadius: 9, backgroundColor: ph.paperDim, borderWidth: 1, borderColor: ph.line }}>
            {(["monthly", "yearly"] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => { setPeriod(option); setActive(null); }}
                hitSlop={density.compact ? 7 : 6}
                accessibilityRole="button"
                accessibilityState={{ selected: period === option }}
                style={{
                  minHeight: density.compact ? 30 : 32,
                  justifyContent: "center",
                  paddingHorizontal: density.compact ? 8 : 11,
                  paddingVertical: density.compact ? 3 : 5,
                  borderRadius: 6,
                  backgroundColor: period === option ? ph.navy : "transparent",
                }}
              >
                <Type variant="caption" style={{ fontSize: density.compact ? 10.5 : 11.5, lineHeight: 15, fontWeight: "500", color: period === option ? "#fff" : ph.ink55 }}>
                  {option === "monthly" ? "Monthly" : "Yearly"}
                </Type>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: density.compact ? space[3] : space[6], marginTop: density.compact ? space[3] : space[4], marginBottom: density.compact ? space[2] : space[3] }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: density.compact ? 7 : 8, height: density.compact ? 7 : 8, borderRadius: 2, backgroundColor: ph.navy }} />
            <Type variant="caption" style={{ fontSize: density.compact ? 10.5 : 11.5, lineHeight: 15, color: ph.ink55 }}>Collected</Type>
          </View>
          <Type variant="display2" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={{ fontSize: density.compact ? 17 : 19, lineHeight: density.compact ? 21 : 24, color: ph.ink }}>
            {formatMinor(reading ? reading.collected_minor : totals.collected)}
          </Type>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: density.compact ? 7 : 8, height: density.compact ? 7 : 8, borderRadius: 2, backgroundColor: ph.goldStrong }} />
            <Type variant="caption" style={{ fontSize: density.compact ? 10.5 : 11.5, lineHeight: 15, color: ph.ink55 }}>Outstanding</Type>
          </View>
          <Type variant="display2" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={{ fontSize: density.compact ? 17 : 19, lineHeight: density.compact ? 21 : 24, color: ph.ink }}>
            {formatMinor(reading ? reading.outstanding_minor : totals.outstanding)}
          </Type>
        </View>
      </View>

      {points.length ? (
        <>
          <View style={{ minHeight: 18, flexDirection: "row", alignItems: "center", gap: 6, marginBottom: density.compact ? 2 : 4 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: reading ? ph.gold : ph.lineStrong }} />
            <Type variant="caption" style={{ flex: 1, fontSize: density.compact ? 9.5 : 10.5, lineHeight: 14, color: reading ? ph.ink70 : ph.ink38 }} numberOfLines={1}>
              {reading ? `${periodLabel(reading.period, period)} selected` : "Touch a period to inspect it"}
            </Type>
            {reading ? (
              <Type variant="caption" style={{ fontSize: density.compact ? 9 : 10, lineHeight: 14, color: ph.ink38 }}>Tap again to reset</Type>
            ) : null}
          </View>

          <View style={{ position: "relative", height }}>
            <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
              {[0, 0.5, 1].map((ratio) => (
                <Line
                  key={ratio}
                  x1={left}
                  y1={top + plotHeight * ratio}
                  x2={left + plotWidth}
                  y2={top + plotHeight * ratio}
                  stroke="rgba(24,22,17,0.08)"
                  strokeWidth={1}
                />
              ))}
              {points.map((row, index) => {
                const barY = y(row.outstanding_minor);
                const barHeight = Math.max(0, top + plotHeight - barY);
                return (
                  <Rect
                    key={`bar-${row.period}`}
                    x={x(index) - barWidth / 2}
                    y={barY}
                    width={barWidth}
                    height={barHeight}
                    rx={Math.min(barWidth / 2, barHeight / 2)}
                    fill={active === index ? "#B5822E" : index === points.length - 1 ? ph.goldStrong : ph.goldSoft}
                  />
                );
              })}
              {area ? <Path d={area} fill="rgba(27,36,48,0.10)" /> : null}
              {line ? <Path d={line} fill="none" stroke="#12181F" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /> : null}
              {points.map((row, index) =>
                active === index || index === points.length - 1 ? (
                  <Circle
                    key={`dot-${row.period}`}
                    cx={x(index)}
                    cy={y(row.collected_minor)}
                    r={active === index ? 5 : 4}
                    fill="#0F1620"
                    stroke={ph.paper}
                    strokeWidth={2}
                  />
                ) : null,
              )}
              {active !== null ? (
                <Line x1={x(active)} y1={top} x2={x(active)} y2={top + plotHeight} stroke={ph.ink55} strokeWidth={1} strokeDasharray="2 3" />
              ) : null}
            </Svg>

            {/* The plotted marks are the controls. Each period owns the space
                halfway to its neighbours, so bars, line points and the quiet
                area between them all respond to the same intended touch. */}
            {points.map((row, index) => {
              const start = points.length === 1 || index === 0 ? 0 : ((x(index) - step / 2) / width) * 100;
              const end = points.length === 1 || index === points.length - 1 ? 100 : ((x(index) + step / 2) / width) * 100;
              return (
                <Pressable
                  key={`chart-touch-${row.period}`}
                  onPress={() => selectPoint(index)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active === index }}
                  accessibilityLabel={`${periodLabel(row.period, period)}: ${formatMinor(row.collected_minor)} collected, ${formatMinor(row.outstanding_minor)} outstanding`}
                  style={({ pressed }) => ({
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: percent(start),
                    width: percent(end - start),
                    backgroundColor: pressed
                      ? "rgba(156,122,56,0.11)"
                      : active === index
                        ? "rgba(156,122,56,0.055)"
                        : "transparent",
                    borderRadius: 5,
                  })}
                />
              );
            })}
          </View>

          {/* Tap targets and their labels, laid out in the same rhythm as the
              chart above so a column and its month stay together. */}
          <View style={{ flexDirection: "row" }}>
            {points.map((row, index) => (
              <Pressable
                key={`hit-${row.period}`}
                onPress={() => selectPoint(index)}
                hitSlop={density.compact ? 6 : 4}
                accessibilityRole="button"
                accessibilityState={{ selected: active === index }}
                accessibilityLabel={`${periodLabel(row.period, period)}: ${formatMinor(row.collected_minor)} collected, ${formatMinor(row.outstanding_minor)} outstanding`}
                style={{ flex: 1, minHeight: density.compact ? 32 : 36, alignItems: "center", justifyContent: "center", paddingVertical: space[1] }}
              >
                <Type
                  variant="caption"
                  style={{
                    fontSize: density.compact ? 9.5 : 10.5,
                    fontWeight: active === index || index === points.length - 1 ? "600" : "400",
                    color: active === index || index === points.length - 1 ? ph.ink : ph.ink55,
                  }}
                >
                  {periodLabel(row.period, period)}
                </Type>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <View style={{ paddingVertical: space[6], alignItems: "center", borderWidth: 1, borderStyle: "dashed", borderColor: ph.lineStrong, borderRadius: 12 }}>
          <Type variant="bodyStrong" style={{ fontSize: density.compact ? 12.25 : 13, lineHeight: 17, color: ph.ink }}>No rent scheduled yet.</Type>
          <Type variant="caption" style={{ fontSize: density.compact ? 11 : 12, lineHeight: 16, color: ph.ink55 }}>Collection appears once a lease is active.</Type>
        </View>
      )}

      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={{
          marginTop: density.compact ? space[2] : space[3],
          paddingTop: density.compact ? space[2] : space[3],
          borderTopWidth: 1,
          borderTopColor: ph.line,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
        {...pressableFeedback(ph.paperDim)}
      >
        <Type variant="caption" numberOfLines={density.veryCompact ? 1 : undefined} style={{ flex: 1, fontSize: density.compact ? 10.5 : 12, lineHeight: 16, color: ph.ink55 }}>
          {reading ? "Tap the column again to clear" : "Every confirmed payment and open charge"}
        </Type>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Type variant="caption" style={{ fontSize: density.compact ? 11.5 : 12.5, lineHeight: 17, fontWeight: "500", color: ph.graphite }}>Payments</Type>
          <Ionicons name="chevron-forward" size={density.compact ? 11 : 12} color={ph.graphite} />
        </View>
      </Pressable>
    </View>
  );
}

/** The shape of the screen, before it arrives. */
function ProviderDashboardSkeleton() {
  const density = useHomeDensity();
  const block = (height: number) => ({
    height,
    borderRadius: density.compact ? 14 : 16,
    backgroundColor: ph.paper,
    borderWidth: 1,
    borderColor: ph.edge,
    opacity: 0.7,
  });
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading your Portfolio" style={{ gap: density.sectionGap }}>
      <View style={block(density.compact ? 218 : 260)} />
      <View style={block(density.compact ? 128 : 150)} />
      <View style={block(density.compact ? 192 : 230)} />
    </View>
  );
}

function periodLabel(value: string, period: "monthly" | "yearly"): string {
  if (period === "yearly") return value;
  const month = Number(value.slice(5, 7));
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1] ?? value;
}

/** Today keeps its clock; tomorrow says so; anything further keeps its date. */
function whenLabel(value: string, openedAt: number) {
  const at = new Date(value);
  const time = at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" });
  const day = at.toDateString();
  if (day === new Date(openedAt).toDateString()) return time;
  if (day === new Date(openedAt + 86_400_000).toDateString()) return `Tmrw ${time}`;
  return at.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}
