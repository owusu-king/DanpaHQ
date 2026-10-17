import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { Fragment, useCallback, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { useAuth } from "@/auth";
import { Button, Notice, Type, radius, space } from "@/components/ui";
import { ph, useHomeDensity } from "@/components/home/plinth";
import { HomeGround } from "@/components/home/HomeGround";
import { HomeHeroScroll, type HeroChip } from "@/components/home/HomeHero";
import { Empty } from "@/components/work/WorkParts";
import {
  ActivityItem,
  Cell,
  CellRule,
  DayTile,
  Highlights,
  INK,
  KOLA_DEEP,
  MUTED,
  NextMoves,
  PRESSED,
  RING_EMPTY,
  RING_OWED,
  RULE,
  Section,
  Ring,
  Rings,
  StatCells,
  WHITE,
  dash,
  type ActivityRow,
} from "@/components/home/DashboardParts";
import { ago, insights, monthName, nextMoves, type Href } from "@/dashboardWork";
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
import { listEnquiries } from "@/sales";
import { alpha } from "@/shell";
import { theme } from "@/theme";
import { ProviderTabFrame } from "@/components/nav/NativeTabFrame";

/**
 * The provider's Home: what to do next, then how the Portfolio stands
 * (owner, 2026-10-06).
 *
 * It used to give every figure the same weight — a gauge, a ledger, a highlight
 * card and a list of counts each marked "Soon" — on drafting marks of its own,
 * so it read as an admin template beside the rest of the app. Now it is built
 * from the work pages' parts, on the same white cards, and in this order:
 *
 * 1. **Your next move.** The costliest thing waiting leads, with the verb for
 *    it as a button; everything else waiting is a row under it.
 * 2. **Overview.** One strong figure, occupancy, over the four counts behind it.
 * 3. **Highlights.** Readings with a consequence and a way to act, not stat tiles.
 * 4. **Rent collection.** The chart, still read by tapping a month, now with a
 *    tooltip and the product's colours.
 * 5. **Coming up** and **Recent activity**, each a short list that scans.
 *
 * What to do and in what order is decided in `dashboardWork.ts`.
 */
function ProviderHomeScreen() {
  // Behind every state — a first Property, the skeleton and the Portfolio
  // itself — so Home never changes colour as its figures arrive.
  return (
    <HomeGround>
      <ProviderHome />
    </HomeGround>
  );
}

/** The rent chart's colours: money in is the brand's green, money owed is harmattan. */
const COLLECTED = theme.color.kola["600"];
const OWED = theme.color.harmattan["500"];
const OWED_PAST = alpha(theme.color.harmattan["500"], 0.32);
const OWED_ACTIVE = theme.color.harmattan["600"];
function ProviderHome() {
  const router = useRouter();
  const density = useHomeDensity();
  const { activeContext, state } = useAuth();
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [applications, setApplications] = useState(0);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [unreadEnquiries, setUnreadEnquiries] = useState(0);
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
        setUnreadEnquiries(0);
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
          // Buyers asking about what this account is selling (owner, 2026-09-29).
          listEnquiries("seller"),
        ]),
        getPortfolioSummary(organization.id),
        listOrganizationProperties(organization.id),
      ]);
      setViewings(enquiries[0].status === "fulfilled" ? enquiries[0].value : []);
      setApplications(enquiries[1].status === "fulfilled" ? enquiries[1].value.length : 0);
      setLeases(enquiries[2].status === "fulfilled" ? enquiries[2].value : []);
      setUnreadEnquiries(enquiries[3].status === "fulfilled" ? enquiries[3].value.filter((row) => row.unread).length : 0);
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

  const needsUpdate = properties.filter((row) =>
    ["changes_required", "rejected", "suspended", "expired"].includes(row.verification?.review_state ?? ""),
  ).length;
  const drafts = leases.filter((lease) => lease.status === "draft").length;

  const moves = nextMoves({
    overdueMinor: money?.overdue_minor ?? 0,
    settlementAttentionMinor: money?.settlement_attention_minor ?? 0,
    // Only the records the provider still owes an answer on.
    recordsToConfirm: money?.payment_records_awaiting_you ?? 0,
    maintenanceAlerts: counts?.maintenance_alerts ?? 0,
    requests: applications + (counts?.pending_join_requests ?? 0),
    viewingRequests: viewings.filter((row) => !row.confirmed_starts_at).length,
    draftAgreements: drafts,
    propertiesToUpdate: needsUpdate,
    unreadEnquiries,
    money: (minor) => formatMinor(minor),
  });

  const upcoming = viewings
    .filter((row) => row.confirmed_starts_at && row.is_upcoming)
    .sort((a, b) => (a.confirmed_starts_at ?? "").localeCompare(b.confirmed_starts_at ?? ""))
    .slice(0, 3);

  // The web and mobile Homes highlight the same Property. Size leads because
  // this is a Portfolio summary; occupancy only breaks a tie.
  const largest = [...properties].sort((left, right) =>
    right.unit_count - left.unit_count
    || right.occupied_unit_count - left.occupied_unit_count
    || left.title.localeCompare(right.title)
  )[0] ?? null;

  const readings = insights({
    units: unitCount,
    occupied,
    vacant: available,
    largest: largest ? { id: largest.id, title: largest.title, units: largest.unit_count, occupied: largest.occupied_unit_count } : null,
  });

  const activity: (ActivityRow & { at: string })[] = [
    ...(summary?.recent_payments ?? []).map((row): ActivityRow & { at: string } => ({
      id: `payment-${row.id}`,
      at: row.paid_on,
      title: row.tenant_name,
      line: `${formatMinor(row.amount_minor)} · ${row.unit_label}`,
      icon: "wallet-outline",
      tone: row.awaiting_you ? "warning" : "calm",
      status: row.awaiting_you ? "To confirm" : row.status === "confirmed" ? "Paid" : "Recorded",
      when: ago(row.paid_on, openedAt),
    })),
    ...(summary?.recent_activity ?? []).map((row): ActivityRow & { at: string } => ({
      id: `a-${row.id}`,
      at: row.at,
      title: row.title,
      line: row.kind === "property_added" ? "Property added" : "Tenant joined",
      icon: row.kind === "property_added" ? "business-outline" : "person-add-outline",
      tone: row.kind === "property_added" ? "ink" : "lagoon",
      status: null,
      when: ago(row.at, openedAt),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4);

  const go = (to: Href) => router.push(to as never);

  // A Portfolio with nothing in it gets a beginning, not a screen of zeroes.
  if (!loading && !summary && !error) {
    return (
      <HomeHeroScroll title={`Good day, ${name}`} padding={density.pagePadding} gap={density.sectionGap}>
        <View style={[dash.card, { gap: space[3] }]}>
          <Type variant="title2" accessibilityRole="header" style={{ color: INK }}>Your Portfolio starts here</Type>
          <Type variant="caption" style={{ color: MUTED }}>
            Add your first Property and Danpa HQ will help you organize its Units, tenants,
            agreements and rent.
          </Type>
          <Button label="Add first Property" onPress={() => router.push("/(app)/private-property" as never)} />
        </View>
      </HomeHeroScroll>
    );
  }

  if (loading && !summary) {
    return (
      <HomeHeroScroll title={`Good day, ${name}`} padding={density.pagePadding} gap={density.sectionGap}>
        <ProviderDashboardSkeleton />
      </HomeHeroScroll>
    );
  }

  // Two ways into the Portfolio's people and places, under the greeting.
  const chips: HeroChip[] = [
    {
      id: "properties",
      icon: "business-outline",
      label: `${counts?.properties ?? properties.length} ${(counts?.properties ?? properties.length) === 1 ? "Property" : "Properties"}`,
      onPress: () => router.push("/(app)/(provider-tabs)/properties" as never),
    },
    {
      id: "tenants",
      icon: "people-outline",
      label: `${counts?.active_tenants ?? 0} ${(counts?.active_tenants ?? 0) === 1 ? "tenant" : "tenants"}`,
      onPress: () => router.push("/(app)/(provider-tabs)/tenants" as never),
    },
  ];

  return (
    <HomeHeroScroll
      title={`Good day, ${name}`}
      chips={chips}
      padding={density.pagePadding}
      gap={space[6]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          // White, on the hero's green.
          tintColor={theme.color.field["0"]}
        />
      }
    >
      {error ? <Notice tone="error" title={error} /> : null}

      <Section title="Your next move" meta={moves.length ? `${moves.length} waiting` : undefined}>
        <NextMoves
          moves={moves.map((move) => ({ ...move, onPress: () => go(move.to) }))}
          calm={{ title: "Nothing is waiting on you", hint: "Rent, requests and agreements are up to date." }}
        />
      </Section>

      <Section title="Overview">
        <PortfolioOverview
          occupied={occupied}
          units={unitCount}
          available={available}
          properties={counts?.properties ?? properties.length}
          tenants={counts?.active_tenants ?? 0}
          month={summary?.rent_collection.monthly.at(-1) ?? null}
          onProperties={() => go("/(app)/(provider-tabs)/properties")}
          onUnits={() => go("/(app)/units")}
          onTenants={() => go("/(app)/(provider-tabs)/tenants")}
        />
      </Section>

      {readings.length ? (
        <Section title="Highlights">
          <Highlights items={readings.map((reading) => ({ ...reading, onPress: () => go(reading.to) }))} />
        </Section>
      ) : null}

      <Section title="Rent collection" link={{ label: "Payments", onPress: () => go("/(app)/(provider-tabs)/payments") }}>
        <RentCollection collection={summary?.rent_collection ?? null} />
      </Section>

      {upcoming.length ? (
        <Section title="Coming up" link={{ label: "All viewings", onPress: () => go("/(app)/provider-viewings") }}>
          <View style={dash.card}>
            {upcoming.map((row, index) => (
              <Fragment key={row.id}>
                {index ? <View style={dash.rule} /> : null}
                <VisitRow viewing={row} openedAt={openedAt} onPress={() => go({ pathname: "/(app)/provider-viewing", params: { viewingId: row.id } })} />
              </Fragment>
            ))}
          </View>
        </Section>
      ) : null}

      {activity.length ? (
        <Section title="Recent activity" link={{ label: "Updates", onPress: () => go("/(app)/notifications") }}>
          <View style={dash.card}>
            {activity.map((row, index) => (
              <Fragment key={row.id}>
                {index ? <View style={dash.rule} /> : null}
                <ActivityItem row={row} />
              </Fragment>
            ))}
          </View>
        </Section>
      ) : null}
    </HomeHeroScroll>
  );
}

/**
 * The Portfolio at a glance: two rings side by side, then the four counts on
 * one straight line under them (owner, 2026-10-06).
 *
 * The rings are the two things a landlord tracks: how much of the Portfolio
 * is let, and how much of this month's rent is in. Each is the brand's green
 * for what is done, with the rest as its own softer arc in the colour it has
 * elsewhere — an empty Unit in laterite, rent still owed in harmattan, as on
 * the chart — so the gap is seen and not just implied. Holding a ring shows
 * the figures behind its percentage; a phone has no hover, so the press is the
 * gesture. Each count on the line opens its list.
 */
function PortfolioOverview({
  occupied,
  units,
  available,
  properties,
  tenants,
  month,
  onProperties,
  onUnits,
  onTenants,
}: {
  occupied: number;
  units: number;
  available: number;
  properties: number;
  tenants: number;
  /** This month's rent: the last monthly point of the chart. */
  month: { period: string; collected_minor: number; outstanding_minor: number } | null;
  onProperties: () => void;
  onUnits: () => void;
  onTenants: () => void;
}) {
  const due = month ? month.collected_minor + month.outstanding_minor : 0;
  return (
    <View style={dash.card}>
      {units ? (
        <Rings>
          <Ring
            share={occupied / units}
            rest={RING_EMPTY}
            figure={`${Math.round((occupied / units) * 100)}%`}
            unit="let"
            heldFigure={`${occupied}/${units}`}
            heldUnit="Units let"
            title="Occupancy"
            line={`${occupied} of ${units} Units let`}
          />
          {month && due ? (
            <Ring
              share={month.collected_minor / due}
              rest={RING_OWED}
              figure={`${Math.round((month.collected_minor / due) * 100)}%`}
              unit="in"
              heldFigure={shortMoney(month.collected_minor)}
              heldUnit={`of ${shortMoney(due)}`}
              title={`${monthName(month.period)} rent`}
              line={`${shortMoney(month.outstanding_minor)} still owed`}
            />
          ) : (
            // Nothing due this month still gets its ring, drawn as nothing:
            // a faint dashed outline, and the words to match.
            <Ring
              share={null}
              rest={RING_OWED}
              figure="None"
              unit="due"
              title={month ? `${monthName(month.period)} rent` : "This month's rent"}
              line="No rent due yet"
            />
          )}
        </Rings>
      ) : (
        // No Units, no ring: 0% of nothing is a figure about nothing.
        <Pressable accessibilityRole="link" onPress={onUnits} style={styles.noUnits}>
          <Type variant="caption" style={{ color: MUTED }}>Occupancy</Type>
          <Type variant="bodyStrong" style={dash.leadTitle}>No Units yet</Type>
          <View style={styles.insightAct}>
            <Type variant="captionStrong" style={{ color: KOLA_DEEP }}>Add Units to start letting</Type>
            <Ionicons name="arrow-forward" size={13} color={KOLA_DEEP} />
          </View>
        </Pressable>
      )}
      <StatCells>
        <Cell label="Units" value={units} onPress={onUnits} />
        <CellRule />
        <Cell label="Vacant" value={available} onPress={onUnits} alert={available > 0} />
        <CellRule />
        <Cell label="Properties" value={properties} onPress={onProperties} />
        <CellRule />
        <Cell label="Tenancies" value={tenants} onPress={onTenants} />
      </StatCells>
    </View>
  );
}

/** "GH₵14.2k" — short enough for the middle of a ring. */
function shortMoney(minor: number): string {
  const cedis = minor / 100;
  if (cedis >= 1_000_000) return `GH₵${(cedis / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (cedis >= 1_000) return `GH₵${(cedis / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `GH₵${Math.round(cedis)}`;
}

/**
 * Rent collection, on a phone.
 *
 * Collected is a line because it is a trend; outstanding is a column because it
 * is a quantity standing at a moment. They are never netted — money that
 * arrived and money that has not are different questions.
 *
 * A phone cannot hover, so a period is read by tapping it: a tooltip rises over
 * its column with both figures, and tapping again puts it away. Six months
 * rather than twelve: twelve labels on a 360px screen is a smear, and the
 * yearly view is one tap away.
 */
function RentCollection({ collection }: { collection: PortfolioSummary["rent_collection"] | null }) {
  const density = useHomeDensity();
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [active, setActive] = useState<number | null>(null);
  const [plotWidth, setPlotWidth] = useState(0);

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

  // Drawn in the plot's own pixels once it is measured, so the line and its dots keep their shape.
  const width = Math.max(plotWidth, 240);
  const height = density.chartHeight;
  const left = 10;
  const right = 10;
  const top = 12;
  const bottom = 6;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const peak = Math.max(1, ...points.map((row) => Math.max(row.collected_minor, row.outstanding_minor)));
  const magnitude = 10 ** Math.max(Math.floor(Math.log10(peak * 1.12)) - 1, 0);
  const ceiling = Math.ceil((peak * 1.12) / magnitude) * magnitude;
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;
  const x = (index: number) => (points.length > 1 ? left + step * index : left + innerWidth / 2);
  const y = (value: number) => top + innerHeight * (1 - value / ceiling);

  const line = points.map((row, index) => `${index ? "L" : "M"} ${x(index)} ${y(row.collected_minor)}`).join(" ");
  const area = points.length
    ? `${line} L ${x(points.length - 1)} ${top + innerHeight} L ${x(0)} ${top + innerHeight} Z`
    : "";
  const barWidth = Math.min(16, Math.max(8, step * 0.3));
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

  // The tooltip stands beside its column, on the side with room, so it never
  // covers the reading it describes.
  const TIP = 184;
  const tipX = active !== null ? x(active) : 0;
  const tipLeft = tipX > width / 2 ? Math.max(0, tipX - TIP - 12) : Math.min(width - TIP, tipX + 12);

  return (
    <View style={dash.card}>
      <View style={styles.chartHead}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: "row", gap: space[5] }}>
          <Figure dot={COLLECTED} label="Collected" value={formatMinor(totals.collected)} />
          <Figure dot={OWED} label="Outstanding" value={formatMinor(totals.outstanding)} />
        </View>
        {hasYearly ? (
          <View style={styles.toggle}>
            {(["monthly", "yearly"] as const).map((option) => (
              <Pressable
                key={option}
                onPress={() => { setPeriod(option); setActive(null); }}
                hitSlop={6}
                accessibilityRole="button"
                aria-selected={period === option}
                style={[styles.toggleOption, period === option ? styles.toggleOn : null]}
              >
                <Type variant="caption" style={{ fontSize: 12, lineHeight: 16, color: period === option ? INK : MUTED }}>
                  {option === "monthly" ? "6 months" : "Years"}
                </Type>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {points.length ? (
        <>
          <View style={{ position: "relative", height, marginTop: space[4] }} onLayout={(event) => setPlotWidth(event.nativeEvent.layout.width)}>
            <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
              <Defs>
                <LinearGradient id="collected" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={COLLECTED} stopOpacity={0.16} />
                  <Stop offset="1" stopColor={COLLECTED} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {[0, 0.5, 1].map((ratio) => (
                <Line
                  key={ratio}
                  x1={left}
                  y1={top + innerHeight * ratio}
                  x2={left + innerWidth}
                  y2={top + innerHeight * ratio}
                  stroke={RULE}
                  strokeWidth={1}
                  strokeDasharray={ratio === 1 ? undefined : "3 4"}
                />
              ))}
              {active !== null ? (
                <Line x1={x(active)} y1={top} x2={x(active)} y2={top + innerHeight} stroke={alpha(theme.color.kola["900"], 0.22)} strokeWidth={1} />
              ) : null}
              {points.map((row, index) => {
                const barY = y(row.outstanding_minor);
                const barHeight = Math.max(0, top + innerHeight - barY);
                return (
                  <Rect
                    key={`bar-${row.period}`}
                    x={x(index) - barWidth / 2}
                    y={barY}
                    width={barWidth}
                    height={barHeight}
                    rx={Math.min(4, barWidth / 2, barHeight / 2)}
                    fill={active === index ? OWED_ACTIVE : index === points.length - 1 ? OWED : OWED_PAST}
                  />
                );
              })}
              {area ? <Path d={area} fill="url(#collected)" /> : null}
              {line ? <Path d={line} fill="none" stroke={COLLECTED} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /> : null}
              {points.map((row, index) =>
                active === index || index === points.length - 1 ? (
                  <Circle
                    key={`dot-${row.period}`}
                    cx={x(index)}
                    cy={y(row.collected_minor)}
                    r={active === index ? 5 : 4}
                    fill={KOLA_DEEP}
                    stroke={WHITE}
                    strokeWidth={2}
                  />
                ) : null,
              )}
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
                  aria-selected={active === index}
                  accessibilityLabel={`${periodLabel(row.period, period)}: ${formatMinor(row.collected_minor)} collected, ${formatMinor(row.outstanding_minor)} outstanding`}
                  style={{ position: "absolute", top: 0, bottom: 0, left: percent(start), width: percent(end - start) }}
                />
              );
            })}

            {reading ? (
              <View pointerEvents="none" style={[styles.tip, { left: tipLeft, width: TIP }]}>
                <Type variant="captionStrong" style={styles.tipTitle}>{periodName(reading.period, period)}</Type>
                <TipLine dot={COLLECTED} label="Collected" value={formatMinor(reading.collected_minor)} />
                <TipLine dot={OWED} label="Owed" value={formatMinor(reading.outstanding_minor)} />
              </View>
            ) : null}
          </View>

          {/* The months under their columns, in the same rhythm, and each one a
              second way to read its period. */}
          <View style={{ flexDirection: "row", marginTop: space[1] }}>
            {points.map((row, index) => (
              <Pressable
                key={`hit-${row.period}`}
                onPress={() => selectPoint(index)}
                hitSlop={4}
                accessibilityRole="button"
                aria-selected={active === index}
                accessibilityLabel={`${periodLabel(row.period, period)}: ${formatMinor(row.collected_minor)} collected, ${formatMinor(row.outstanding_minor)} outstanding`}
                style={{ flex: 1, minHeight: 32, alignItems: "center", justifyContent: "center" }}
              >
                <Type
                  variant="caption"
                  style={{
                    fontSize: 12,
                    lineHeight: 16,
                    fontWeight: active === index ? "500" : "400",
                    color: active === index ? INK : MUTED,
                  }}
                >
                  {periodLabel(row.period, period)}
                </Type>
              </Pressable>
            ))}
          </View>
          <Type variant="caption" style={styles.chartHint}>
            {reading ? "Tap it again to close" : "Tap a month for its figures"}
          </Type>
        </>
      ) : (
        <View style={{ marginTop: space[3] }}>
          <Empty icon="bar-chart-outline" title="No rent scheduled yet" hint="Collection appears once a lease is active." compact ground={WHITE} />
        </View>
      )}
    </View>
  );
}

function Figure({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <View style={{ minWidth: 0, flexShrink: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={[styles.key, { backgroundColor: dot }]} />
        <Type variant="caption" style={{ fontSize: 12.5, lineHeight: 17, color: MUTED }}>{label}</Type>
      </View>
      <Type variant="amount" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.figureSmall}>{value}</Type>
    </View>
  );
}

function TipLine({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={[styles.key, { backgroundColor: dot }]} />
      <Type variant="caption" style={styles.tipLabel}>{label}</Type>
      <Type variant="captionStrong" style={styles.tipValue}>{value}</Type>
    </View>
  );
}

/** A visit with a time: the day on a tile, the place and who is coming beside it. */
function VisitRow({ viewing, openedAt, onPress }: { viewing: Viewing; openedAt: number; onPress: () => void }) {
  const at = new Date(viewing.confirmed_starts_at as string);
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [dash.listRow, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <DayTile at={at} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Type variant="body" numberOfLines={1} style={dash.rowTitle}>{viewing.listing_headline}</Type>
        <Type variant="caption" numberOfLines={1} style={dash.rowLine}>{viewing.tenant_name} · {whenLabel(viewing.confirmed_starts_at as string, openedAt)}</Type>
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.color.ink["300"]} />
    </Pressable>
  );
}

/** The shape of the screen, before it arrives. */
function ProviderDashboardSkeleton() {
  const block = (height: number) => ({
    height,
    borderRadius: 20,
    backgroundColor: ph.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ph.edge,
    opacity: 0.7,
  });
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading your Portfolio" style={{ gap: space[6] }}>
      <View style={block(196)} />
      <View style={block(150)} />
      <View style={block(240)} />
    </View>
  );
}

function periodLabel(value: string, period: "monthly" | "yearly"): string {
  if (period === "yearly") return value;
  return monthName(value).slice(0, 3);
}

function periodName(value: string, period: "monthly" | "yearly"): string {
  return period === "yearly" ? value : `${monthName(value)} ${value.slice(0, 4)}`;
}

/** Today keeps its clock; tomorrow says so; anything further keeps its weekday. */
function whenLabel(value: string, openedAt: number) {
  const at = new Date(value);
  const time = at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" });
  const day = at.toDateString();
  if (day === new Date(openedAt).toDateString()) return `Today ${time}`;
  if (day === new Date(openedAt + 86_400_000).toDateString()) return `Tomorrow ${time}`;
  return `${at.toLocaleDateString("en-GH", { weekday: "short" })} ${time}`;
}

const styles = StyleSheet.create({
  noUnits: {
    gap: 4,
    marginTop: 4,
  },
  insightAct: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  chartHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
  },
  key: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  figureSmall: {
    fontSize: 19,
    lineHeight: 25,
    color: INK,
  },
  toggle: {
    flexDirection: "row",
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: theme.color.field["100"],
  },
  toggleOption: {
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  toggleOn: {
    backgroundColor: WHITE,
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  // The reading, as the app's dark tooltip: deep kola, white words, the keys in their colours.
  tip: {
    position: "absolute",
    top: 4,
    gap: 3,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: theme.color.kola["900"],
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  tipTitle: {
    fontSize: 12.5,
    lineHeight: 17,
    color: WHITE,
  },
  tipLabel: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: alpha(WHITE, 0.72),
  },
  tipValue: {
    fontSize: 12.5,
    lineHeight: 16,
    color: WHITE,
  },
  chartHint: {
    textAlign: "center",
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
});

/** On iOS the tab sits in the native bar, which draws no header; see `ProviderTabFrame`. */
export default function ProviderHomeTab() {
  return (
    <ProviderTabFrame tab="home">
      <ProviderHomeScreen />
    </ProviderTabFrame>
  );
}
