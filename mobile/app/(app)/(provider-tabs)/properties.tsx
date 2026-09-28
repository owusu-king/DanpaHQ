import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from "react-native";

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
  HARMATTAN,
  KOLA,
  LATERITE,
  ListHead,
  ListRow,
  MUTED,
  PRESSED,
  PrimaryAction,
  RowSeparator,
  SearchField,
  SheetFooter,
  SummaryPanel,
  Thumb,
  rowStyles,
  type IconName,
  type SummaryNote,
} from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, Type, space } from "@/components/ui";
import { propertyStatus } from "@/components/property/WorkspacePatterns";
import {
  listOrganizationProperties,
  listOrganizations,
  type ManagedProperty,
  type Organization,
} from "@/organizations";
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { useBlankOnPortfolioSwitch } from "@/portfolioScope";
import { theme } from "@/theme";

/**
 * Every Property in the Portfolio.
 *
 * Refined on review (2026-09-21) into the shape its sibling tabs already have.
 * It was the last provider tab standing on the flat background while Home,
 * Tenants and Payments stood on the green, and it led with the words
 * "2 Properties" where they lead with figures. It also had no way to narrow
 * itself at all: a Portfolio with twenty buildings scrolled.
 *
 * The view is unchanged — one Property to a row, the photograph, where it is,
 * where it stands and how much of it is let. What changed is the ground it
 * stands on, the figures above it, and that there is now one Filter and a
 * search, which is what every other list of this size already offers.
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

export default function ProviderPropertiesScreen() {
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
  const [filtering, setFiltering] = useState(false);
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

  // What the figure's line says: the worst thing outstanding, or that nothing is.
  const note: SummaryNote = counts.attention
    ? { text: `${counts.attention} needs attention`, tone: "alert" }
    : counts.review
      ? { text: `${counts.review} in review`, tone: "calm" }
      : counts.setup
        ? { text: `${counts.setup} to finish setting up`, tone: "calm" }
        : { text: "All verified", tone: "calm" };

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
              <SummaryPanel
                label="Properties"
                value={String(properties.length)}
                note={note}
                // Two, because the panel lays its facts out at 45% each in a
                // row that does not wrap. What is held, and what of it is
                // still to let — which is the one a provider acts on.
                facts={[
                  { label: "Units", value: String(units) },
                  { label: "Vacant", value: String(units - occupied) },
                ]}
              />
            ) : null}

            {properties.length ? (
              <View style={{ gap: space[3] }}>
                <ListHead
                  title={FILTER_LABEL[filter]}
                  count={visible.length}
                  filters={filter === "all" ? 0 : 1}
                  filterTone="kola"
                  onFilter={() => setFiltering(true)}
                />
                {filter === "all" ? null : (
                  <View style={styles.tokens}>
                    <ActiveFilter label={FILTER_LABEL[filter]} tone={FILTER_TONE[filter]} onClear={() => setFilter("all")} />
                  </View>
                )}
                <SearchField label="Search Properties" placeholder="Property, town or district" value={query} onChangeText={setQuery} />
                {canCreateProperty ? (
                  <View style={styles.add}>
                    <PrimaryAction icon="add" label="Add Property" onPress={add} />
                  </View>
                ) : null}
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

      <BottomSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        title="Filter"
        hideTitle
        closeLabel="Close filter"
        footer={<SheetFooter
          canReset={filter !== "all" || Boolean(query)}
          onReset={() => { setFilter("all"); setQuery(""); }}
          results={visible.length}
          onShow={() => setFiltering(false)}
        />}
      >
        <FilterGroup title="Show">
          {FILTERS.map((value, index) => (
            <ChoiceRow
              key={value}
              first={index === 0}
              icon={FILTER_ICON[value]}
              label={FILTER_LABEL[value]}
              count={counts[value]}
              selected={filter === value}
              onPress={() => setFilter(value)}
            />
          ))}
        </FilterGroup>
      </BottomSheet>
    </IndexGround>
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
  const let_ = property.unit_count
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
      style={({ pressed }) => [rowStyles.row, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
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
          {property.vacant_unit_count ? (
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
  tokens: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
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
