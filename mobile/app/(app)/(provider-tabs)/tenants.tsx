import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from "react-native";

import { privateAccess } from "@/accessCodeMeaning";
import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { shortDate, useHomeDensity } from "@/components/home/plinth";
import {
  ActiveFilter,
  ChoiceRow,
  EDGE,
  EmptyState,
  FilterGroup,
  Footnote,
  GLASS,
  GroupLabel,
  HARMATTAN,
  InfoNote,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  ListHead,
  ListRow,
  MUTED,
  PANEL_RADIUS,
  PRESSED,
  QuietAction,
  RowLine,
  RowSeparator,
  SearchField,
  SheetFooter,
  SignalPanel,
  SummaryPanel,
  initialsOf,
  rowStyles,
  type IconName,
  type Signal,
} from "@/components/portfolio/PortfolioList";
import { UnitAccessCodeManagement } from "@/components/property/UnitAccessCodeManagement";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, Type, space } from "@/components/ui";
import { formatMinor } from "@/listings";
import { getPortfolioSummary, listOrganizations, type PortfolioSummary } from "@/organizations";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * The Portfolio's tenancies, and the Units ready to share privately.
 *
 * Refined on review (2026-09-15) into the reading order Payments uses. How many
 * tenancies need attention leads, in one glass panel; a tenancy request waiting is
 * one row that goes to the requests inbox; then the list. It is grouped — what
 * needs attention, then what is on track — and each row is one exact Unit or bed
 * tenancy, not one person: initials in the colour of its rent, the Property and
 * Unit, what is owed and when, and the agreement's term. The two views and the
 * four statuses used to be tabs and a row of choices; they are one Filter control
 * now, opening a sheet that groups what to show and which tenancies. The parts are
 * `PortfolioList`'s, shared with Payments.
 *
 * Private access stays a secondary view and stays short: three share-ready Units,
 * each a card because each carries its own code and actions, then one note saying
 * what is off screen and the way to all of it.
 */

type Tenant = PortfolioSummary["tenants"][number];
type Access = PortfolioSummary["tenant_access"][number];

/** How many share-ready Units this tab shows before handing over to Units. */
const ACCESS_PREVIEW = 3;
/**
 * What a code lets someone do, said once above the cards rather than in each —
 * in `privateAccess`'s own words for a Unit that can share, so the two never differ.
 */
const SHARING = privateAccess({ state: "not_created", expires_at: null, can_rotate: true, can_revoke: false }, { verified: true, occupied: false }).detail;
type ViewName = "tenants" | "access";
type TenantFilter = "all" | "attention" | "overdue" | "current";
type Row = { kind: "tenant"; value: Tenant } | { kind: "access"; value: Access };
type Section = { key: "attention" | "track" | "access"; title?: string; data: Row[] };

const VIEWS: readonly ViewName[] = ["tenants", "access"];
const FILTERS: readonly TenantFilter[] = ["all", "attention", "overdue", "current"];

const VIEW_LABEL: Record<ViewName, string> = {
  tenants: "Tenancies",
  access: "Private access",
};
const VIEW_ICON: Record<ViewName, IconName> = {
  tenants: "people-outline",
  access: "key-outline",
};
const FILTER_LABEL: Record<TenantFilter, string> = {
  all: "All tenancies",
  attention: "Needs attention",
  overdue: "Overdue",
  current: "Paid up",
};
/** Each status in the colour it already carries across the product. */
const FILTER_TONE: Record<Exclude<TenantFilter, "all">, string> = {
  attention: HARMATTAN,
  overdue: LATERITE,
  current: KOLA,
};

export default function ProviderTenantsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const { view: requestedView } = useLocalSearchParams<{ view?: ViewName | "requests" }>();
  const { activeContext } = useAuth();
  const [organizationId, setOrganizationId] = useState("");
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [view, setView] = useState<ViewName>(requestedView === "access" ? "access" : "tenants");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TenantFilter>("all");
  const [filtering, setFiltering] = useState(false);
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
      // Keep what was on screen: a failed refresh must not unmount a Unit's card
      // and take a code that was just issued with it.
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load tenants.");
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const all = useMemo(() => summary?.tenants ?? [], [summary]);
  const tenants = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return all
      .filter((tenant) => matchesFilter(tenant, filter))
      .filter((tenant) => !needle || [tenant.name, tenant.property_title, tenant.unit_label, tenant.bed_label]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase("en-GH").includes(needle)))
      .sort((a, b) => Number(tenantNeedsAttention(b)) - Number(tenantNeedsAttention(a)) || a.name.localeCompare(b.name));
  }, [all, filter, query]);

  // Only verified, available Units are sharing work; the rest are summarised.
  const ready = useMemo(
    () => summary ? summary.tenant_access.filter((value) => value.condition_state === "approved" && value.availability.state === "available") : [],
    [summary],
  );
  const readyCount = ready.length;
  const notReady = (summary?.tenant_access.length ?? 0) - readyCount;
  const shownAccess = useMemo(() => ready.slice(0, ACCESS_PREVIEW), [ready]);

  const sections = useMemo<Section[]>(() => {
    if (!summary) return [];
    if (view === "access") {
      return shownAccess.length ? [{ key: "access", data: shownAccess.map((value) => ({ kind: "access", value })) }] : [];
    }
    const attention = tenants.filter(tenantNeedsAttention);
    const track = tenants.filter((tenant) => !tenantNeedsAttention(tenant));
    return [
      ...(attention.length ? [{ key: "attention" as const, title: "Needs attention", data: attention.map((value) => ({ kind: "tenant" as const, value })) }] : []),
      ...(track.length ? [{ key: "track" as const, title: "On track", data: track.map((value) => ({ kind: "tenant" as const, value })) }] : []),
    ];
  }, [shownAccess, summary, tenants, view]);

  const attentionCount = all.filter(tenantNeedsAttention).length;
  const filterCount = (value: TenantFilter) => all.filter((tenant) => matchesFilter(tenant, value)).length;
  const results = view === "access" ? shownAccess.length : tenants.length;
  const activeFilters = view === "tenants" && filter !== "all" ? 1 : 0;

  // A request is decided in its own inbox; this only says one is waiting.
  const pendingRequests = summary ? summary.tenancy_requests.filter((request) => request.status === "pending").length : 0;
  const signals: Signal[] = pendingRequests
    ? [{
      key: "requests",
      icon: "mail-unread-outline",
      tone: HARMATTAN,
      wash: theme.color.harmattan["100"],
      title: `${pendingRequests} tenancy request${pendingRequests === 1 ? "" : "s"} waiting`,
      hint: "Opens tenancy requests",
      onPress: () => router.push("/(app)/provider-applications" as never),
    }]
    : [];

  return (
    <IndexGround>
      <SectionList<Row, Section>
        sections={sections}
        keyExtractor={(item) => item.kind === "tenant" ? item.value.occupancy_id : item.value.unit_id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: space[12] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={<View style={{ gap: density.sectionGap + space[2], marginBottom: space[4] }}>
          {error ? <Notice tone="error" title={error} /> : null}
          {summary ? <SummaryPanel
            label="Needs attention"
            value={attentionCount ? String(attentionCount) : "None"}
            note={summary.money.overdue_minor > 0
              ? { text: `${formatMinor(summary.money.overdue_minor)} overdue`, tone: "alert" }
              : { text: "Nothing overdue", tone: "calm" }}
            facts={[
              { label: "Tenancies", value: String(all.length) },
              { label: "Paid up", value: String(filterCount("current")) },
            ]}
          /> : null}
          <SignalPanel signals={signals} />
          {summary ? <View style={{ gap: space[3] }}>
            <ListHead title={VIEW_LABEL[view]} count={view === "access" ? readyCount : tenants.length} filters={activeFilters} onFilter={() => setFiltering(true)} />
            {view === "access" && shownAccess.length ? <Footnote>{SHARING}</Footnote> : null}
            {view === "tenants" && filter !== "all" ? (
              <ActiveFilter label={FILTER_LABEL[filter]} tone={FILTER_TONE[filter]} onClear={() => setFilter("all")} />
            ) : null}
            {view === "tenants" && all.length ? (
              <SearchField label="Search tenants" placeholder="Name, Property, Unit or bed" value={query} onChangeText={setQuery} />
            ) : null}
          </View> : null}
        </View>}
        renderSectionHeader={({ section }) => section.title ? (
          <View style={styles.sectionHead}>
            <GroupLabel count={section.data.length}>{section.title}</GroupLabel>
          </View>
        ) : null}
        renderSectionFooter={() => <View style={{ height: space[5] }} />}
        // Tenancies read as one panel per group; each Unit's access is its own card.
        ItemSeparatorComponent={({ section }: { section: Section }) => section.key === "access" ? <View style={{ height: space[3] }} /> : <RowSeparator />}
        renderItem={({ item, index, section }) => item.kind === "tenant" ? (
          <ListRow first={index === 0} last={index === section.data.length - 1}>
            <TenantRow
              tenant={item.value}
              narrow={density.veryCompact}
              onPress={() => router.push({ pathname: "/(app)/provider-tenancy", params: { tenancyId: item.value.tenancy_id ?? item.value.occupancy_id, organizationId } } as never)}
            />
          </ListRow>
        ) : (
          <AccessCard
            access={item.value}
            onChanged={load}
            onView={() => router.push({ pathname: "/(app)/space", params: { propertyId: item.value.property_id, unitId: item.value.unit_id } } as never)}
          />
        )}
        ListFooterComponent={view === "access" && shownAccess.length ? (
          <AccessFooter shown={shownAccess.length} ready={readyCount} unavailable={notReady} onUnits={() => router.push("/(app)/units" as never)} />
        ) : null}
        ListEmptyComponent={summary === null ? (error ? null : <Type variant="caption" style={styles.loading}>Loading…</Type>) : (
          <Empty
            view={view}
            hasTenants={Boolean(all.length)}
            unavailableAccess={notReady}
            onProperties={() => router.push("/(app)/(provider-tabs)/properties" as never)}
          />
        )}
      />
      <BottomSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        title="Filter"
        hideTitle
        closeLabel="Close filter"
        footer={<SheetFooter
          canReset={view !== "tenants" || filter !== "all"}
          onReset={() => { setView("tenants"); setFilter("all"); setQuery(""); }}
          results={results}
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
              count={value === "tenants" ? all.length : readyCount}
              selected={view === value}
              onPress={() => setView(value)}
            />
          ))}
        </FilterGroup>
        {view === "tenants" ? (
          <FilterGroup title="Status">
            {FILTERS.map((value, index) => (
              <ChoiceRow
                key={value}
                first={index === 0}
                tone={value === "all" ? undefined : FILTER_TONE[value]}
                label={FILTER_LABEL[value]}
                count={filterCount(value)}
                selected={filter === value}
                onPress={() => setFilter(value)}
              />
            ))}
          </FilterGroup>
        ) : null}
      </BottomSheet>
    </IndexGround>
  );
}

/**
 * One tenancy. The name and what is owed lead; where it is and how the rent stands
 * sit under them; the agreement's term closes it. The initials carry the rent's
 * colour, so a thumb finds the overdue rows before reading them.
 */
function TenantRow({ tenant, narrow, onPress }: { tenant: Tenant; narrow: boolean; onPress: () => void }) {
  const standing = standingOf(tenant);
  const agreementNeeded = tenant.tenancy_status === "pending_lease" || !tenant.lease_id;
  const term = termOf(tenant, narrow);
  const place = [tenant.property_title, tenant.unit_label, tenant.bed_label].filter(Boolean).join(" · ");
  // On the narrowest phones a paid-up row's next date gives way to the place.
  const status = standing.paid && narrow ? "" : standing.status;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${tenant.name}, ${tenancyLabel(tenant)}, ${[tenant.property_title, tenant.unit_label, tenant.bed_label].filter(Boolean).join(", ")}, ${rentLabel(tenant)}${term ? `, ${term}` : ""}`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.initials, { backgroundColor: standing.wash }]}>
        <Type variant="captionStrong" style={[styles.initialsText, { color: standing.ink }]}>{initialsOf(tenant.name)}</Type>
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{tenant.name}</Type>}
          end={<Type variant="bodyStrong" numberOfLines={1} style={[rowStyles.rowAmount, standing.paid ? { color: KOLA_DEEP } : null]}>{standing.figure}</Type>}
        />
        <RowLine
          start={<Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{place}</Type>}
          end={status ? <Type variant="caption" numberOfLines={1} style={[rowStyles.rowStatus, { color: standing.statusInk }]}>{status}</Type> : undefined}
        />
        <Type variant="caption" numberOfLines={1} style={[rowStyles.rowMeta, agreementNeeded ? styles.agreementNeeded : null]}>
          {agreementNeeded ? "Agreement needed" : term || tenancyLabel(tenant)}
        </Type>
      </View>
    </Pressable>
  );
}

/** A Unit ready to share: which one, the way to it, and its code's state and actions. */
function AccessCard({ access, onChanged, onView }: { access: Access; onChanged: () => Promise<void>; onView: () => void }) {
  return (
    <View style={styles.access}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View Unit ${access.unit_label}, ${access.property_title}`}
        onPress={onView}
        {...pressableFeedback(PRESSED)}
        style={({ pressed }) => [styles.accessHead, pressed ? { backgroundColor: PRESSED } : null]}
      >
        <View style={[rowStyles.well, { backgroundColor: theme.color.kola["50"] }]}>
          <Ionicons name="key-outline" size={15} color={KOLA} />
        </View>
        <View style={rowStyles.rowBody}>
          <Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{access.unit_label}</Type>
          <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{access.property_title}</Type>
        </View>
        <View style={styles.viewUnit}>
          <Type variant="captionStrong" style={{ fontSize: 13, lineHeight: 18, color: KOLA_DEEP }}>View Unit</Type>
          <Ionicons name="chevron-forward" size={14} color={KOLA_DEEP} />
        </View>
      </Pressable>
      <View style={styles.accessBody}>
        <UnitAccessCodeManagement
          unitId={access.unit_id}
          accessCode={access.access_code}
          verified={access.condition_state === "approved"}
          occupied={access.availability.state === "occupied"}
          onChanged={onChanged}
          layout="card"
        />
      </View>
    </View>
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
  const others = `${unavailable} other Unit${unavailable === 1 ? " is" : "s are"} not ready yet`;
  return (
    <View style={styles.accessFooter}>
      <InfoNote
        tone="lagoon"
        icon="layers-outline"
        title={capped ? `Showing ${shown} of ${ready} ready to share` : others}
        body={capped && unavailable > 0 ? `${others}.` : undefined}
      />
      <QuietAction icon="grid-outline" label="See all Units" onPress={onUnits} />
    </View>
  );
}

function Empty({ view, hasTenants, unavailableAccess, onProperties }: { view: ViewName; hasTenants: boolean; unavailableAccess: number; onProperties: () => void }) {
  if (view === "tenants") {
    return (
      <EmptyState
        icon={hasTenants ? "search-outline" : "people-outline"}
        title={hasTenants ? "No matching tenants" : "No active tenancies"}
        hint={hasTenants ? "Change the search or filter to see other relationships." : "Approved requests appear here after an agreement is accepted and activated."}
      />
    );
  }
  return (
    <EmptyState
      icon="key-outline"
      title="No Units ready to share privately"
      hint={unavailableAccess > 0 ? `${unavailableAccess} Unit${unavailableAccess === 1 ? " is" : "s are"} not verified or available.` : "A Unit must be verified and available before it can issue an access code."}
      action={<View style={styles.emptyAction}><QuietAction icon="business-outline" label="Review Properties" onPress={onProperties} /></View>}
    />
  );
}

function matchesFilter(tenant: Tenant, filter: TenantFilter) {
  if (filter === "attention") return tenantNeedsAttention(tenant);
  if (filter === "overdue") return tenant.rent.status === "overdue";
  if (filter === "current") return tenant.rent.status === "current" && tenant.tenancy_status === "active";
  return true;
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

/** How the rent stands, in the colour the product already gives it. */
function standingOf(tenant: Tenant) {
  const currency = tenant.lease_rent_currency ?? "GHS";
  if (tenant.rent.status === "overdue") {
    return { figure: formatMinor(tenant.rent.overdue_minor, currency), status: "Overdue", statusInk: LATERITE, ink: LATERITE, wash: theme.color.laterite["100"], paid: false };
  }
  if (tenant.rent.status === "outstanding") {
    return {
      figure: formatMinor(tenant.rent.outstanding_minor, currency),
      status: tenant.rent.next_due_on ? `Due ${shortDate(tenant.rent.next_due_on)}` : "Outstanding",
      statusInk: HARMATTAN,
      ink: HARMATTAN,
      wash: theme.color.harmattan["100"],
      paid: false,
    };
  }
  const attention = tenantNeedsAttention(tenant);
  return {
    figure: "Paid up",
    status: tenant.rent.next_due_on ? `Next ${shortDate(tenant.rent.next_due_on)}` : "",
    statusInk: MUTED,
    ink: attention ? HARMATTAN : KOLA_DEEP,
    wash: attention ? theme.color.harmattan["100"] : theme.color.kola["50"],
    paid: true,
  };
}

/** The agreement's term, said the way it matters today: when it starts, or when it ends. */
function termOf(tenant: Tenant, narrow: boolean) {
  if (tenant.tenancy_status === "pending_lease" || !tenant.lease_id) return "";
  if (tenant.tenancy_status === "upcoming" && tenant.lease_starts_on) return `Starts ${onDay(tenant.lease_starts_on, narrow)}`;
  if (tenant.tenancy_status === "active" && tenant.lease_ends_on) return `Ends ${onDay(tenant.lease_ends_on, narrow)}`;
  return "";
}

/** A calendar date with its year, in `shortDate`'s words; at midday, so no time zone moves it a day. */
function onDay(value: string, narrow: boolean) {
  const at = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(at.getTime())) return value;
  return at.toLocaleDateString("en-GH", narrow ? { month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  sectionHead: {
    paddingBottom: space[2],
  },
  initials: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  initialsText: {
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.3,
  },
  agreementNeeded: {
    color: HARMATTAN,
    fontWeight: "600",
  },
  access: {
    overflow: "hidden",
    borderRadius: PANEL_RADIUS,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  accessHead: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: EDGE,
  },
  viewUnit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  accessBody: {
    paddingHorizontal: 14,
    paddingVertical: space[3],
  },
  accessFooter: {
    gap: space[3],
  },
  emptyAction: {
    marginTop: space[2],
  },
  loading: {
    paddingVertical: space[6],
    textAlign: "center",
    color: MUTED,
  },
});
