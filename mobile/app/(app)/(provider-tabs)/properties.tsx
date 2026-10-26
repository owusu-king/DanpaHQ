import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { useHomeDensity } from "@/components/home/plinth";
import { Cell, CellRule, RING_EMPTY, StatCells, dash } from "@/components/home/DashboardParts";
import { AddButton, FilterChips } from "@/components/portfolio/FilterChips";
import {
  EmptyState,
  HARMATTAN,
  KOLA,
  LATERITE,
  ListRow,
  MUTED,
  PRESSED,
  PrimaryAction,
  RowSeparator,
  SearchField,
  Thumb,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { Notice, Type, space } from "@/components/ui";
import { propertyStatus } from "@/components/property/WorkspacePatterns";
import {
  listOrganizationProperties,
  listOrganizations,
  type ManagedProperty,
  type Organization,
} from "@/organizations";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { useBlankOnPortfolioSwitch } from "@/portfolioScope";
import { theme } from "@/theme";
import { ProviderTabFrame } from "@/components/nav/NativeTabFrame";

/**
 * Every Property in the Portfolio.
 *
 * Redesigned (owner, 2026-10-06). The figures above the list are a picture of
 * the Portfolio rather than the Home's rings again: one bar split by where
 * each Property stands in verification, its legend the way to narrow the list,
 * and every Property as a row of windows — one per Unit, let or empty — so the
 * building with the vacancies is seen before it is read. A straight line of
 * counts sits under it, each opening what it counts. The filters are out where they can be seen, as chips
 * with their colours and counts, instead of behind a Filter button, a sheet
 * and a token saying what the sheet had done.
 *
 * The rows are unchanged — one Property to a row, the photograph, where it
 * is, where it stands and how much of it is let.
 */

type PropertyFilter = "all" | "verified" | "review" | "attention" | "setup";

const FILTERS: readonly PropertyFilter[] = ["all", "verified", "review", "attention", "setup"];

const FILTER_LABEL: Record<PropertyFilter, string> = {
  all: "All Properties",
  verified: "Verified",
  review: "In review",
  attention: "Needs attention",
  setup: "Setup incomplete",
};

const FILTER_ICON: Record<PropertyFilter, IconName> = {
  all: "business-outline",
  verified: "shield-checkmark-outline",
  review: "hourglass-outline",
  attention: "alert-circle-outline",
  setup: "construct-outline",
};

/** Each stage in the colour the product already gives it. */
const FILTER_TONE: Record<Exclude<PropertyFilter, "all">, string> = {
  verified: KOLA,
  review: HARMATTAN,
  attention: LATERITE,
  setup: MUTED,
};

/** One Property's stage, read from the combined verification the server serves. */
function stageOf(property: ManagedProperty): Exclude<PropertyFilter, "all"> {
  const { tone } = propertyStatus(property.verification);
  return tone === "good" ? "verified" : tone === "waiting" ? "review" : tone === "attention" ? "attention" : "setup";
}

function ProviderPropertiesScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { state, activeContext } = useAuth();
  const me = state.status === "signed_in" ? state.me : null;
  const provider = me?.capabilities.provider ?? null;
  // Two ways to be allowed: an approved provider adding to anything of theirs,
  // or a Portfolio administrator adding to the Portfolio that invited them —
  // which its standing and their identity check decide, on the backend.
  const portfolioAccess = me?.contexts.find(
    (row) => row.type === "organization" && row.id === activeContext,
  )?.access ?? me?.contexts.find((row) => row.type === "organization")?.access ?? null;
  const canCreateProperty =
    (provider?.can_create_property ?? false) || Boolean(portfolioAccess?.can.create_properties);
  // A role whose reach is decided by assignment has a different empty state
  // from an owner's: there is nothing for them to add, and somebody else
  // decides which Properties they see.
  const assignedOnly = portfolioAccess ? portfolioAccess.scope !== "portfolio_wide" : false;

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [filter, setFilter] = useState<PropertyFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // A switch takes the Portfolio being left off the screen with it, name and
  // count included. Returning to this tab is not a switch, so what is already
  // here stays while it refreshes.
  useBlankOnPortfolioSwitch(activeContext, () => {
    setProperties([]);
    setOrganizationId("");
    setLoading(true);
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const orgs = await listOrganizations();
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const selected = orgs.find((organization) => organization.id === preferred)?.id ?? orgs[0]?.id ?? "";
      setOrganizations(orgs);
      setOrganizationId(selected);
      setProperties(selected ? await listOrganizationProperties(selected) : []);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load Properties.");
    } finally {
      setLoading(false);
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const currentPortfolio = organizations.find((organization) => organization.id === organizationId);

  const counts = useMemo(() => {
    const tally: Record<PropertyFilter, number> = { all: properties.length, verified: 0, review: 0, attention: 0, setup: 0 };
    for (const property of properties) tally[stageOf(property)] += 1;
    return tally;
  }, [properties]);

  const units = properties.reduce((total, property) => total + property.unit_count, 0);
  const occupied = properties.reduce((total, property) => total + property.occupied_unit_count, 0);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return properties
      .filter((property) => filter === "all" || stageOf(property) === filter)
      .filter((property) => !needle || `${property.title} ${property.address.locality_name} ${property.address.district_name}`
        .toLocaleLowerCase("en-GH").includes(needle));
  }, [properties, filter, query]);

  const add = () => router.push({ pathname: "/(app)/private-property", params: { organizationId } });

  return (
    <IndexGround>
      <FlatList
        data={loading && properties.length === 0 ? [] : visible}
        keyExtractor={(property) => property.id}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={
          <View style={{ gap: density.sectionGap + space[2], marginBottom: space[4] }}>
            {error ? <Notice tone="error" title={error} body="Pull down to try again." /> : null}
            {provider && !canCreateProperty ? (
              <Notice tone="info" title="Property creation is not available yet" body="You can review this Portfolio while your provider verification is in progress." />
            ) : null}

            {properties.length ? (
              <View style={dash.card}>
                <StageBar counts={counts} total={properties.length} onPick={setFilter} />
                <View style={[dash.rule, { marginLeft: 0, marginVertical: space[4] }]} />
                <UnitWindows
                  properties={properties}
                  onOpen={(id) => router.push({ pathname: "/(app)/provider-property", params: { propertyId: id } })}
                />
                <StatCells>
                  <Cell label="Properties" value={properties.length} onPress={() => setFilter("all")} />
                  <CellRule />
                  <Cell label="Units" value={units} onPress={() => router.push("/(app)/units" as never)} />
                  <CellRule />
                  <Cell label="Vacant" value={units - occupied} alert={units - occupied > 0} onPress={() => router.push({ pathname: "/(app)/units", params: { view: "available" } } as never)} />
                  <CellRule />
                  <Cell label="Attention" value={counts.attention} alert={counts.attention > 0} onPress={() => setFilter("attention")} />
                </StatCells>
              </View>
            ) : null}

            {properties.length ? (
              <View style={{ gap: space[3] }}>
                <View style={styles.head}>
                  <Type variant="title2" accessibilityRole="header" style={styles.headTitle}>{FILTER_LABEL[filter]}</Type>
                  <Type variant="caption" style={{ color: MUTED }}>{visible.length}</Type>
                  <View style={{ flex: 1 }} />
                  {canCreateProperty ? <AddButton label="Add Property" onPress={add} /> : null}
                </View>
                <FilterChips
                  label="Show Properties"
                  value={filter}
                  onChange={setFilter}
                  options={FILTERS.map((value) => ({
                    value,
                    label: value === "all" ? "All" : FILTER_LABEL[value],
                    count: counts[value],
                    tone: value === "all" ? undefined : FILTER_TONE[value],
                  }))}
                />
                <SearchField label="Search Properties" placeholder="Property, town or district" value={query} onChangeText={setQuery} />
              </View>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item, index }) => (
          <ListRow first={index === 0} last={index === visible.length - 1}>
            <PropertyRow
              property={item}
              onOpen={() => router.push({ pathname: "/(app)/provider-property", params: { propertyId: item.id } })}
            />
          </ListRow>
        )}
        ListEmptyComponent={
          loading && properties.length === 0 ? <PropertiesSkeleton /> : error ? null : properties.length ? (
            <EmptyState
              icon={FILTER_ICON[filter]}
              title={query.trim() ? "Nothing matches that" : `No Property is ${FILTER_LABEL[filter].toLocaleLowerCase("en-GH")}`}
              hint={query.trim() ? "Try a shorter search, or clear the filter." : "Clear the filter to see the rest."}
            />
          ) : (
            <EmptyState
              icon="business-outline"
              hero
              title={assignedOnly ? "No Property is assigned to you" : "No Properties yet"}
              hint={assignedOnly
                ? `An owner or administrator of ${currentPortfolio?.name ?? "this Portfolio"} decides which Properties you operate.`
                : "Add the first Property in this Portfolio."}
              action={canCreateProperty ? (
                <View style={styles.add}><PrimaryAction icon="add" label="Add Property" onPress={add} /></View>
              ) : undefined}
            />
          )
        }
      />

    </IndexGround>
  );
}

const STAGES: Exclude<PropertyFilter, "all">[] = ["verified", "review", "attention", "setup"];
const STAGE_SHORT: Record<Exclude<PropertyFilter, "all">, string> = {
  verified: "Verified",
  review: "In review",
  attention: "To fix",
  setup: "Setting up",
};

/**
 * Where the Portfolio stands in verification, as one bar split by stage in
 * each stage's colour, with a legend under it whose every entry narrows the
 * list to that stage.
 */
function StageBar({
  counts,
  total,
  onPick,
}: {
  counts: Record<PropertyFilter, number>;
  total: number;
  onPick: (filter: PropertyFilter) => void;
}) {
  const shown = STAGES.filter((stage) => counts[stage] > 0);
  return (
    <View style={{ gap: space[3] }}>
      <View style={styles.pictureHead}>
        <Type variant="bodyStrong" style={styles.pictureTitle}>Verification</Type>
        <Type variant="caption" style={{ color: MUTED }}>
          {counts.verified} of {total} verified
        </Type>
      </View>
      <View style={styles.stageBar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {shown.map((stage) => (
          <View key={stage} style={{ flex: counts[stage], backgroundColor: FILTER_TONE[stage], borderRadius: 6 }} />
        ))}
      </View>
      <View style={styles.legend}>
        {STAGES.map((stage) => (
          <Pressable
            key={stage}
            accessibilityRole="button"
            accessibilityLabel={`${counts[stage]} ${STAGE_SHORT[stage]}. Show them.`}
            onPress={() => onPick(stage)}
            disabled={!counts[stage]}
            {...pressableFeedback(PRESSED)}
            style={({ pressed }) => [styles.legendItem, !counts[stage] ? { opacity: 0.45 } : null, pressed ? { backgroundColor: PRESSED } : null]}
          >
            <View style={[styles.legendDot, { backgroundColor: FILTER_TONE[stage] }]} />
            <Type variant="caption" numberOfLines={1} style={styles.legendLabel}>{STAGE_SHORT[stage]}</Type>
            <Type variant="captionStrong" style={styles.legendCount}>{counts[stage]}</Type>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** More Units than this and a Property's windows become one bar, or the row would wrap past reading. */
const MAX_WINDOWS = 24;

/**
 * Every Property as a row of windows, one per Unit: kola where somebody lives,
 * soft laterite where nobody does. The building with the vacancies is seen
 * before it is read. Largest first, four at most; the list below has the rest.
 */
function UnitWindows({ properties, onOpen }: { properties: ManagedProperty[]; onOpen: (id: string) => void }) {
  const letting = [...properties]
    .filter((property) => property.purpose !== "sale" && property.unit_count > 0)
    .sort((a, b) => b.unit_count - a.unit_count || a.title.localeCompare(b.title, "en-GH"))
    .slice(0, 4);
  if (!letting.length) return null;
  return (
    <View style={{ gap: space[3] }}>
      <View style={styles.pictureHead}>
        <Type variant="bodyStrong" style={styles.pictureTitle}>Where the Units are</Type>
        <View style={styles.key}>
          <View style={[styles.keyDot, { backgroundColor: KOLA }]} />
          <Type variant="caption" style={styles.keyText}>Let</Type>
          <View style={[styles.keyDot, { backgroundColor: RING_EMPTY }]} />
          <Type variant="caption" style={styles.keyText}>Empty</Type>
        </View>
      </View>
      {letting.map((property) => {
        const vacant = property.unit_count - property.occupied_unit_count;
        return (
          <Pressable
            key={property.id}
            accessibilityRole="link"
            accessibilityLabel={`${property.title}. ${property.occupied_unit_count} of ${property.unit_count} Units let${vacant ? `, ${vacant} empty` : ""}.`}
            onPress={() => onOpen(property.id)}
            {...pressableFeedback(PRESSED)}
            style={({ pressed }) => [styles.windowRow, pressed ? { backgroundColor: PRESSED } : null]}
          >
            <View style={styles.windowHead}>
              <Type variant="body" numberOfLines={1} style={styles.windowTitle}>{property.title || "Untitled Property"}</Type>
              <Type variant="caption" style={[styles.windowCount, vacant ? { color: LATERITE } : null]}>
                {vacant ? `${vacant} empty` : "Full"}
              </Type>
            </View>
            {property.unit_count <= MAX_WINDOWS ? (
              <View style={styles.windows}>
                {Array.from({ length: property.unit_count }, (_, index) => (
                  <View key={index} style={[styles.window, { backgroundColor: index < property.occupied_unit_count ? KOLA : RING_EMPTY }]} />
                ))}
              </View>
            ) : (
              <View style={styles.windowBar}>
                <View style={{ flex: property.occupied_unit_count, backgroundColor: KOLA }} />
                <View style={{ flex: vacant, backgroundColor: RING_EMPTY }} />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One Property: what it looks like, where it is, where it stands, and how much
 * of it is let. The right-hand column is the occupancy, because that is the
 * number an eye runs down a Portfolio looking for.
 */
function PropertyRow({ property, onOpen }: { property: ManagedProperty; onOpen: () => void }) {
  const { width } = useWindowDimensions();
  const status = propertyStatus(property.verification);
  const where = [property.address.locality_name, property.address.district_name].filter(Boolean).join(", ");
  const tone = FILTER_TONE[stageOf(property)];
  // A property for sale has no Units to count; its price is what a seller scans for.
  const sale = property.purpose === "sale" ? property.sale : null;
  const let_ = sale
    ? (sale.price_formatted ?? "For sale")
    : property.unit_count
      ? `${property.occupied_unit_count}/${property.unit_count} let`
      : "No Units yet";
  // A column of "6/8 let" is worth scanning down, but at 320 it leaves the
  // body about ninety points, which cut the Property's own name. On the
  // narrowest handsets the occupancy joins the line below instead.
  const narrow = width < 360;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${property.title || "Untitled Property"}. ${where}. ${status.label}. ${let_}.`}
      onPress={onOpen}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Thumb uri={property.cover_url} size={56} />
      <View style={rowStyles.rowBody}>
        <Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>
          {property.title || "Untitled Property"}
        </Type>
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{where || "Ghana"}</Type>
        <View style={styles.standing}>
          <View style={[styles.dot, { backgroundColor: tone }]} />
          <Type variant="captionStrong" numberOfLines={2} style={[styles.standingText, { color: tone }]}>
            {narrow ? `${status.label} · ${let_}` : status.label}
          </Type>
        </View>
      </View>
      {narrow ? null : (
        <View style={styles.occupancy}>
          <Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowAmount}>{let_}</Type>
          {sale ? (
            <Type variant="caption" numberOfLines={1} style={rowStyles.rowMeta}>{sale.status === "active" ? (sale.is_public ? "Public" : "Not public yet") : sale.status_label}</Type>
          ) : property.vacant_unit_count ? (
            <Type variant="caption" numberOfLines={1} style={rowStyles.rowMeta}>{property.vacant_unit_count} vacant</Type>
          ) : null}
        </View>
      )}
      <Ionicons name="chevron-forward" size={16} color={theme.color.ink["300"]} style={styles.chevron} />
    </Pressable>
  );
}

/** Shaped like the figures and the first rows, so nothing jumps when they land. */
function PropertiesSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your Properties" style={{ gap: space[4] }}>
      <Bone width="42%" height={12} />
      <Bone height={92} />
      <Bone width="34%" height={12} />
      <Bone height={72} />
      <Bone height={72} />
    </View>
  );
}

const styles = StyleSheet.create({
  pictureHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space[2],
  },
  pictureTitle: {
    fontSize: 15.5,
    lineHeight: 21,
    color: theme.color.ink["900"],
  },
  stageBar: {
    height: 14,
    flexDirection: "row",
    gap: 3,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -6,
  },
  legendItem: {
    width: "50%",
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 3,
  },
  legendLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  legendCount: {
    marginRight: space[2],
    fontSize: 13.5,
    lineHeight: 18,
    color: theme.color.ink["900"],
  },
  key: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  keyDot: {
    width: 9,
    height: 9,
    marginLeft: 4,
    borderRadius: 2.5,
  },
  keyText: {
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
  windowRow: {
    gap: 7,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
  },
  windowHead: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[2],
  },
  windowTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14.5,
    lineHeight: 19,
    color: theme.color.ink["900"],
  },
  windowCount: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  windows: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  window: {
    width: 22,
    height: 16,
    borderRadius: 4,
  },
  windowBar: {
    height: 12,
    flexDirection: "row",
    gap: 3,
    overflow: "hidden",
    borderRadius: 6,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingLeft: space[1],
  },
  headTitle: {
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
    color: theme.color.ink["900"],
  },
  add: {
    flexDirection: "row",
  },
  standing: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
    paddingTop: 2,
  },
  dot: {
    width: 7,
    height: 7,
    marginTop: 5,
    borderRadius: 3.5,
  },
  standingText: {
    flexShrink: 1,
    fontSize: 12.5,
    lineHeight: 17,
  },
  occupancy: {
    flexShrink: 0,
    alignItems: "flex-end",
    gap: 2,
  },
  chevron: {
    marginTop: 2,
  },
});

/** On iOS the tab sits in the native bar, which draws no header; see `ProviderTabFrame`. */
export default function PropertiesTab() {
  return (
    <ProviderTabFrame tab="properties">
      <ProviderPropertiesScreen />
    </ProviderTabFrame>
  );
}
