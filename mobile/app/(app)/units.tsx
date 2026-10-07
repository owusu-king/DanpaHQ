import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import {
  Cell,
  CellRule,
  RING_EMPTY,
  RING_OWED,
  Ring,
  Rings,
  StatCells,
  dash,
} from "@/components/home/DashboardParts";
import { AddButton, FilterChips, ToolButton } from "@/components/portfolio/FilterChips";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { useHomeDensity } from "@/components/home/plinth";
import {
  EmptyState,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  MUTED,
  PrimaryAction,
  QuietAction,
  SearchField,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { UNIT_COLUMNS, UNIT_TILE_GAP, UnitTile } from "@/components/property/UnitTile";
import { useAddUnit } from "@/components/property/AddUnitSheet";
import { Notice, Type, space } from "@/components/ui";
import { listOrganizations } from "@/organizations";
import { listPortfolioUnits, type Unit } from "@/provider";
import { useSafeBottom } from "@/platform";
import { theme } from "@/theme";

type UnitView = "all" | "available" | "public" | "occupied" | "attention";
type Sort = "property" | "label";

const VIEWS: readonly UnitView[] = ["all", "available", "public", "occupied", "attention"];

const VIEW_LABEL: Record<UnitView, string> = {
  all: "All Units",
  available: "Available",
  public: "On Explore",
  occupied: "Occupied",
  attention: "Needs attention",
};

const VIEW_ICON: Record<UnitView, IconName> = {
  all: "grid-outline",
  available: "checkmark-circle-outline",
  public: "earth-outline",
  occupied: "person-outline",
  attention: "alert-circle-outline",
};

/** Each view in the colour the product already gives that state. */
const VIEW_TONE: Record<Exclude<UnitView, "all">, string> = {
  available: KOLA,
  public: KOLA_DEEP,
  occupied: MUTED,
  attention: LATERITE,
};

const SORT_LABEL: Record<Sort, string> = {
  property: "By Property",
  label: "By Unit name",
};

/**
 * On Explore right now — not merely offered to it.
 *
 * `publication.state` says the provider is offering this space publicly, but
 * that is true of a listing waiting in the review queue, one a reviewer has
 * flagged, and one Management has suspended. Public search shows none of them:
 * it filters on `status == "active"`. Reading both fields is what makes the
 * count on this tab the same set a tenant can actually find.
 */
const isPublic = (unit: Unit) =>
  unit.publication.state === "published" && unit.publication.listing_status === "active";

/** Anything a provider has to go and do something about. */
const needsAttention = (unit: Unit) =>
  ["changes_requested", "rejected", "suspended", "expired", "draft"].includes(unit.verification.state);

/**
 * Every Unit in the Portfolio.
 *
 * Property → Units answers "what is inside this building". This answers "where
 * is Room 4", which is the question a provider with eleven Properties has. Both
 * open the same Unit.
 *
 * Redesigned (owner, 2026-10-06) on the dashboards' parts. It stays a grid —
 * Units are told apart by sight before they are told apart by name — under the
 * Homes' card: two rings, how much is let and how much of what is vacant is on
 * Explore, over a straight line of counts. The filters are out where they can
 * be seen: a row of chips for where a Unit stands, a row for which Property,
 * and a toggle beside the search for the order. Each says what is on by being
 * on, so there is no sheet and no token to clear.
 */
export default function UnitsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { activeContext } = useAuth();
  const params = useLocalSearchParams<{ view?: string }>();
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<UnitView>(() => (VIEWS as readonly string[]).includes(params.view ?? "") ? params.view as UnitView : "all");
  const [propertyId, setPropertyId] = useState("");
  const [sort, setSort] = useState<Sort>("property");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const organizations = await listOrganizations();
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const organization = organizations.find((row) => row.id === preferred) ?? organizations[0];
      setUnits(organization ? await listPortfolioUnits(organization.id) : []);
      setError("");
    } catch (cause) {
      setUnits([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your Units.");
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const all = useMemo(() => units ?? [], [units]);

  const properties = useMemo(() => {
    const seen = new Map<string, string>();
    for (const unit of all) seen.set(unit.property_id, unit.property_title);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1], "en-GH"));
  }, [all]);

  const counts = useMemo(() => ({
    all: all.length,
    available: all.filter((unit) => unit.availability.state === "available").length,
    public: all.filter(isPublic).length,
    occupied: all.filter((unit) => unit.availability.state === "occupied").length,
    attention: all.filter(needsAttention).length,
  }), [all]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return all
      .filter((unit) => !propertyId || unit.property_id === propertyId)
      .filter((unit) => view === "all"
        || (view === "attention" ? needsAttention(unit)
          : view === "public" ? isPublic(unit)
          : unit.availability.state === view))
      .filter((unit) => !needle
        || `${unit.label} ${unit.property_title} ${unit.space_type_label}`.toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => sort === "label"
        ? a.label.localeCompare(b.label, "en-GH")
        : a.property_title.localeCompare(b.property_title, "en-GH") || a.label.localeCompare(b.label, "en-GH"));
  }, [all, propertyId, view, query, sort]);

  // Of what is vacant, how much a tenant can find on Explore.
  const listedVacant = all.filter((unit) => unit.availability.state === "available" && isPublic(unit)).length;

  const clearAll = () => { setView("all"); setPropertyId(""); setSort("property"); setQuery(""); };
  // A sheet to choose the Property, not a screen (owner, 2026-10-05).
  const { start: startAddUnit, sheet: addUnitSheet } = useAddUnit();
  const addUnit = () => void startAddUnit();

  return (
    <IndexGround>
      <FlatList
        data={units === null ? [] : visible}
        keyExtractor={(unit) => unit.id}
        numColumns={UNIT_COLUMNS}
        columnWrapperStyle={{ gap: UNIT_TILE_GAP }}
        contentContainerStyle={{
          paddingHorizontal: density.pagePadding,
          paddingTop: density.compact ? space[4] : space[5],
          paddingBottom: pageBottom,
          gap: UNIT_TILE_GAP,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={KOLA}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: density.sectionGap + space[2], marginBottom: space[2] }}>
            {error ? <Notice tone="error" title={error} /> : null}

            {counts.all ? (
              <View style={dash.card}>
                <Rings>
                  <Ring
                    share={counts.occupied / counts.all}
                    rest={RING_EMPTY}
                    figure={`${Math.round((counts.occupied / counts.all) * 100)}%`}
                    unit="let"
                    heldFigure={`${counts.occupied}/${counts.all}`}
                    heldUnit="Units let"
                    title="Occupancy"
                    line={`${counts.available} vacant of ${counts.all}`}
                  />
                  {counts.available ? (
                    <Ring
                      share={listedVacant / counts.available}
                      rest={RING_OWED}
                      figure={`${Math.round((listedVacant / counts.available) * 100)}%`}
                      unit="listed"
                      heldFigure={`${listedVacant}/${counts.available}`}
                      heldUnit="vacant listed"
                      title="On Explore"
                      line={listedVacant === counts.available ? "Every vacancy is listed" : `${counts.available - listedVacant} vacant not listed`}
                    />
                  ) : (
                    <Ring share={null} rest={RING_OWED} figure="None" unit="vacant" title="On Explore" line="Nothing to list" />
                  )}
                </Rings>
                <StatCells>
                  <Cell label="Units" value={counts.all} onPress={() => setView("all")} />
                  <CellRule />
                  <Cell label="Vacant" value={counts.available} onPress={() => setView("available")} />
                  <CellRule />
                  <Cell label="On Explore" value={counts.public} onPress={() => setView("public")} />
                  <CellRule />
                  <Cell label="Attention" value={counts.attention} alert={counts.attention > 0} onPress={() => setView("attention")} />
                </StatCells>
              </View>
            ) : null}

            {counts.all ? (
              <View style={{ gap: space[3] }}>
                <View style={styles.head}>
                  <Type variant="title2" accessibilityRole="header" style={styles.headTitle}>{VIEW_LABEL[view]}</Type>
                  <Type variant="caption" style={{ color: MUTED }}>{visible.length}</Type>
                  <View style={{ flex: 1 }} />
                  <AddButton label="Add Unit" onPress={addUnit} />
                </View>
                <FilterChips
                  label="Show Units"
                  value={view}
                  onChange={setView}
                  options={VIEWS.map((value) => ({
                    value,
                    label: value === "all" ? "All" : VIEW_LABEL[value],
                    count: counts[value],
                    tone: value === "all" ? undefined : VIEW_TONE[value],
                  }))}
                />
                {properties.length > 1 ? (
                  <FilterChips
                    label="Units in"
                    quiet
                    value={propertyId || "every"}
                    onChange={(value) => setPropertyId(value === "every" ? "" : value)}
                    options={[
                      { value: "every", label: "Every Property", count: counts.all, icon: "business-outline" as const },
                      ...properties.map(([id, title]) => ({
                        value: id,
                        label: title,
                        count: all.filter((unit) => unit.property_id === id).length,
                        icon: "business-outline" as const,
                      })),
                    ]}
                  />
                ) : null}
                <View style={styles.searchRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <SearchField
                      label="Search Units"
                      placeholder="Unit, Property or type"
                      value={query}
                      onChangeText={setQuery}
                    />
                  </View>
                  <ToolButton
                    icon="swap-vertical-outline"
                    label={`Ordered ${SORT_LABEL[sort].toLocaleLowerCase("en-GH")}. Order ${SORT_LABEL[sort === "label" ? "property" : "label"].toLocaleLowerCase("en-GH")}`}
                    active={sort === "label"}
                    onPress={() => setSort(sort === "label" ? "property" : "label")}
                  />
                </View>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <UnitTile
            unit={item}
            surface="glass"
            meta={sort === "label" ? item.property_title : item.space_type_label}
            onOpen={() => router.push({ pathname: "/(app)/space", params: { unitId: item.id } } as never)}
          />
        )}
        ListEmptyComponent={
          units === null ? <UnitsSkeleton /> : error ? null : counts.all ? (
            <EmptyState
              icon={VIEW_ICON[view]}
              title={query.trim() ? "Nothing matches that" : `No Unit is ${VIEW_LABEL[view].toLocaleLowerCase("en-GH")}`}
              hint="Clear what is on to see the rest."
              action={<View style={styles.add}><QuietAction icon="close-circle-outline" label="Clear filters" onPress={clearAll} /></View>}
            />
          ) : (
            <EmptyState
              icon="grid-outline"
              hero
              title="No Units yet"
              hint="A Unit is the space you let: a flat, a room, a shop."
              action={<View style={styles.add}><PrimaryAction icon="add" label="Add Unit" onPress={addUnit} /></View>}
            />
          )
        }
      />

      {addUnitSheet}
    </IndexGround>
  );
}

/** Shaped like the figures and the first row of tiles, so nothing jumps. */
function UnitsSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your Units" style={{ gap: space[4] }}>
      <Bone width="38%" height={12} />
      <Bone height={92} />
      <Bone width="30%" height={12} />
      <View style={{ flexDirection: "row", gap: UNIT_TILE_GAP }}>
        <Bone height={190} />
        <Bone height={190} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  add: {
    flexDirection: "row",
  },
});
