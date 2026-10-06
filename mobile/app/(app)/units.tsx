import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { useHomeDensity } from "@/components/home/plinth";
import {
  ActiveFilter,
  ChoiceRow,
  EmptyState,
  FilterGroup,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  ListHead,
  MUTED,
  PrimaryAction,
  QuietAction,
  SearchField,
  SheetFooter,
  SummaryPanel,
  type IconName,
  type SummaryNote,
} from "@/components/portfolio/PortfolioList";
import { UNIT_COLUMNS, UNIT_TILE_GAP, UnitTile } from "@/components/property/UnitTile";
import { useAddUnit } from "@/components/property/AddUnitSheet";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, space } from "@/components/ui";
import { listOrganizations } from "@/organizations";
import { listPortfolioUnits, type Unit } from "@/provider";
import { useSafeBottom } from "@/platform";

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
 * Refined on review (2026-09-21). It stays a grid — Units are told apart by
 * sight before they are told apart by name — standing now on the green its
 * sibling tabs stand on, over figures that say what the Portfolio holds. It had
 * been filtered two ways at once: a row of chips for availability and a
 * separate sheet for Property and sort, so neither control could say what was
 * on. There is one Filter now, it holds all three questions, and whatever is on
 * is a token under the heading that clears with a tap.
 */
export default function UnitsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { activeContext } = useAuth();
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<UnitView>("all");
  const [propertyId, setPropertyId] = useState("");
  const [sort, setSort] = useState<Sort>("property");
  const [filtering, setFiltering] = useState(false);
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

  const propertyName = properties.find(([id]) => id === propertyId)?.[1] ?? "";
  const narrowed = (view === "all" ? 0 : 1) + (propertyId ? 1 : 0) + (sort === "property" ? 0 : 1);

  // The figure's line says the one thing outstanding, or that nothing is.
  const note: SummaryNote = counts.attention
    ? { text: `${counts.attention} needs attention`, tone: "alert" }
    : counts.available
      ? { text: `${counts.available} ready to let`, tone: "calm" }
      : { text: "All let", tone: "calm" };

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
              <SummaryPanel
                label="Units"
                value={String(counts.all)}
                note={note}
                // Two, because the panel lays its facts out at 45% each in a
                // row that does not wrap — a third is cut off the right edge.
                // These two are the split that sums to the figure above them.
                facts={[
                  { label: "Occupied", value: String(counts.occupied) },
                  { label: "Available", value: String(counts.available) },
                ]}
              />
            ) : null}

            {counts.all ? (
              <View style={{ gap: space[3] }}>
                <ListHead
                  title={VIEW_LABEL[view]}
                  count={visible.length}
                  filters={narrowed}
                  filterTone="kola"
                  onFilter={() => setFiltering(true)}
                />
                {narrowed ? (
                  <View style={styles.tokens}>
                    {view === "all" ? null : (
                      <ActiveFilter label={VIEW_LABEL[view]} tone={VIEW_TONE[view]} onClear={() => setView("all")} />
                    )}
                    {propertyId ? (
                      <ActiveFilter label={propertyName} tone={KOLA_DEEP} onClear={() => setPropertyId("")} />
                    ) : null}
                    {sort === "property" ? null : (
                      <ActiveFilter label={SORT_LABEL[sort]} tone={MUTED} onClear={() => setSort("property")} />
                    )}
                  </View>
                ) : null}
                <SearchField
                  label="Search Units"
                  placeholder="Unit, Property or type"
                  value={query}
                  onChangeText={setQuery}
                />
                <View style={styles.add}>
                  <PrimaryAction icon="add" label="Add Unit" onPress={addUnit} />
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

      <BottomSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        title="Filter"
        hideTitle
        closeLabel="Close filter"
        footer={<SheetFooter
          canReset={narrowed > 0 || Boolean(query)}
          onReset={clearAll}
          results={visible.length}
          onShow={() => setFiltering(false)}
        />}
      >
        <FilterGroup title="Show">
          {VIEWS.map((value, index) => (
            <ChoiceRow
              key={value}
              first={index === 0}
              icon={VIEW_ICON[value]}
              label={VIEW_LABEL[value]}
              count={counts[value]}
              selected={view === value}
              onPress={() => setView(value)}
            />
          ))}
        </FilterGroup>

        {properties.length > 1 ? (
          <FilterGroup title="Property">
            <ChoiceRow
              first
              icon="business-outline"
              label="Every Property"
              count={counts.all}
              selected={!propertyId}
              onPress={() => setPropertyId("")}
            />
            {properties.map(([id, title]) => (
              <ChoiceRow
                key={id}
                first={false}
                icon="business-outline"
                label={title}
                count={all.filter((unit) => unit.property_id === id).length}
                selected={propertyId === id}
                onPress={() => setPropertyId(id)}
              />
            ))}
          </FilterGroup>
        ) : null}

        <FilterGroup title="Order">
          {(["property", "label"] as const).map((value, index) => (
            <ChoiceRow
              key={value}
              first={index === 0}
              icon={value === "property" ? "business-outline" : "text-outline"}
              label={SORT_LABEL[value]}
              count={counts.all}
              selected={sort === value}
              onPress={() => setSort(value)}
            />
          ))}
        </FilterGroup>
      </BottomSheet>
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
  tokens: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  add: {
    flexDirection: "row",
  },
});
