import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { UNIT_COLUMNS, UNIT_TILE_GAP, UnitTile } from "@/components/property/UnitTile";
import { listOrganizations } from "@/organizations";
import { listPortfolioUnits, type Unit } from "@/provider";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

type Filter = "all" | "available" | "public" | "occupied" | "attention";

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
type Sort = "property" | "label";

/**
 * Every Unit in the Portfolio.
 *
 * Property → Units answers "what is inside this building". This answers "where
 * is Room 4", which is the question a provider with eleven Properties has. Both
 * open the same Unit.
 *
 * Search and availability stay on the screen because they are what people reach
 * for; Property and sort go in a sheet, because they are not.
 */
export default function UnitsScreen() {
  const router = useRouter();
  const { activeContext } = useAuth();
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<Filter>("all");
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

  const properties = useMemo(() => {
    const seen = new Map<string, string>();
    for (const unit of units ?? []) seen.set(unit.property_id, unit.property_title);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1], "en-GH"));
  }, [units]);

  const counts = useMemo(() => ({
    all: units?.length ?? 0,
    available: (units ?? []).filter((unit) => unit.availability.state === "available").length,
    public: (units ?? []).filter(isPublic).length,
    occupied: (units ?? []).filter((unit) => unit.availability.state === "occupied").length,
    attention: (units ?? []).filter(needsAttention).length,
  }), [units]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (units ?? [])
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
  }, [units, propertyId, view, query, sort]);

  const narrowed = Boolean(propertyId) || sort !== "property";

  return (
    <>
      <FlatList
        data={visible}
        keyExtractor={(unit) => unit.id}
        numColumns={UNIT_COLUMNS}
        columnWrapperStyle={{ gap: UNIT_TILE_GAP }}
        contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: UNIT_TILE_GAP }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={theme.color.kola["600"]}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space[3], marginBottom: space[2] }}>
            <View style={{ gap: space[1] }}>
              <Type variant="label">RENTABLE SPACES</Type>
              <Type variant="display2" accessibilityRole="header">Units</Type>
            </View>

            {error ? <Notice tone="error" title={error} /> : null}

            {counts.all ? (
              <>
                <Field
                  label="Search Units"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Unit or Property"
                  returnKeyType="search"
                />
                <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
                    <Chip label="All" count={counts.all} selected={view === "all"} onPress={() => setView("all")} />
                    <Chip label="Available" count={counts.available} selected={view === "available"} onPress={() => setView("available")} />
                    <Chip label="Public" count={counts.public} selected={view === "public"} onPress={() => setView("public")} />
                    <Chip label="Occupied" count={counts.occupied} selected={view === "occupied"} onPress={() => setView("occupied")} />
                    {counts.attention ? (
                      <Chip label="Attention" count={counts.attention} selected={view === "attention"} onPress={() => setView("attention")} />
                    ) : null}
                  </ScrollView>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={narrowed ? "Filters, active" : "Filters"}
                    onPress={() => setFiltering(true)}
                    {...pressableFeedback(theme.color.field["200"])}
                    style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}
                  >
                    <Ionicons
                      name={narrowed ? "options" : "options-outline"}
                      size={22}
                      color={narrowed ? theme.color.kola["600"] : theme.color.ink["500"]}
                    />
                  </Pressable>
                </View>
                <Button label="Add Unit" onPress={() => router.push("/(app)/unit-new" as never)} />
              </>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <UnitTile
            unit={item}
            // Across a Portfolio, which building it is in is what tells two
            // Room 4s apart.
            meta={item.property_title}
            onOpen={() => router.push({ pathname: "/(app)/space", params: { unitId: item.id } } as never)}
          />
        )}
        ListEmptyComponent={
          units === null && !error ? (
            <Type variant="caption">Loading…</Type>
          ) : counts.all === 0 ? (
            <View style={{ paddingVertical: space[8], gap: space[3] }}>
              <Type variant="bodyStrong">No Units yet</Type>
              <Type variant="caption">
                Units are the rentable spaces inside a Property — a room, a flat, a shop.
              </Type>
              <Button
                label="Open Properties"
                variant="secondary"
                onPress={() => router.push("/(app)/(provider-tabs)/properties" as never)}
              />
            </View>
          ) : (
            <View style={{ paddingVertical: space[6], gap: space[2] }}>
              <Type variant="bodyStrong">No matching Unit</Type>
              <Button
                label="Clear filters"
                variant="secondary"
                onPress={() => { setQuery(""); setView("all"); setPropertyId(""); setSort("property"); }}
              />
            </View>
          )
        }
      />

      <Modal visible={filtering} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setFiltering(false)}>
        <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[10], gap: space[4] }}>
          <Type variant="title1" accessibilityRole="header">Filters</Type>

          <Type variant="label">PROPERTY</Type>
          <Button label="All Properties" variant="secondary" selected={!propertyId} onPress={() => setPropertyId("")} />
          {properties.map(([id, title]) => (
            <Button
              key={id}
              label={title}
              variant="secondary"
              selected={propertyId === id}
              onPress={() => setPropertyId(id)}
            />
          ))}

          <Type variant="label">SORT</Type>
          <Button label="By Property" variant="secondary" selected={sort === "property"} onPress={() => setSort("property")} />
          <Button label="By Unit name" variant="secondary" selected={sort === "label"} onPress={() => setSort("label")} />

          <Button label="Show results" onPress={() => setFiltering(false)} />
        </ScrollView>
      </Modal>
    </>
  );
}

function Chip({
  label,
  count,
  selected,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${count}`}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={{
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: space[3],
        borderWidth: 1,
        borderColor: selected ? theme.color.kola["300"] : theme.color.field["200"],
        borderRadius: 22,
        backgroundColor: selected ? theme.color.kola["50"] : "transparent",
      }}
    >
      <Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["500"] }}>
        {label} · {count}
      </Type>
    </Pressable>
  );
}

/**
 * Something is wrong or waiting. Not "this is private" — a private Unit is a
 * normal, deliberate state, and flagging it would make the filter meaningless.
 */
function needsAttention(unit: Unit) {
  return ["changes_requested", "rejected", "suspended", "expired"].includes(unit.verification.state)
    || unit.availability.state === "expired";
}
