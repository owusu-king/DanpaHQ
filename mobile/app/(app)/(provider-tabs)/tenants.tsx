import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { privateAccess } from "@/accessCodeMeaning";
import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { shortDate, useHomeDensity } from "@/components/home/plinth";
import {
  EDGE,
  FAINT,
  Footnote,
  GLASS,
  GroupLabel,
  HARMATTAN,
  InfoNote,
  KOLA,
  KOLA_DEEP,
  LAGOON,
  LATERITE,
  ListRow,
  MUTED,
  PANEL_RADIUS,
  PRESSED,
  QuietAction,
  RULE,
  RowLine,
  SearchField,
  SignalPanel,
  rowStyles,
  type Signal,
} from "@/components/portfolio/PortfolioList";
import { UnitAccessCodeManagement } from "@/components/property/UnitAccessCodeManagement";
import { Act, Acts, Bar, Briefing, BriefingButton, Calm, Empty, Face, Fold, MoreRow } from "@/components/work/WorkParts";
import { Notice, Type, space } from "@/components/ui";
import { formatMinor } from "@/listings";
import { getPortfolioSummary, listOrganizations, type PortfolioSummary } from "@/organizations";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { ENDING_DAYS, endsIn, laneOf, monthlyRent, startsIn, tenantWork, termShare, type Tenant, type TenantLane, type TenantWork } from "@/tenantWork";
import { theme } from "@/theme";
import { ProviderTabFrame } from "@/components/nav/NativeTabFrame";

/**
 * The Portfolio's tenancies, read as the people in its homes (owner, 2026-10-06).
 *
 * How many tenancies need the landlord leads, with what is overdue in money;
 * then who needs them — overdue rent first, unfinished paperwork, rent coming
 * due — with the rent account one tap from an overdue row; who is moving in;
 * whose term is running out; and everyone settled, by the Property they live
 * in. Private access, which used to be a second "view" behind the Filter, folds
 * into one line at the foot that opens the share-ready Units.
 *
 * Each row is one exact Unit or bed tenancy, not one person.
 */

type Access = PortfolioSummary["tenant_access"][number];
type Entry =
  | { kind: "label"; key: string; title: string; count: number; tone?: string; first: boolean }
  | { kind: "row"; key: string; tenant: Tenant; first: boolean; last: boolean }
  | { kind: "more"; key: string; section: "needs"; hidden: number }
  | { kind: "calm"; key: string }
  | { kind: "access"; key: string; open: boolean; ready: number }
  | { kind: "card"; key: string; access: Access }
  | { kind: "accessFoot"; key: string };

/** How many share-ready Units the fold shows before handing over to Units. */
const ACCESS_PREVIEW = 3;
/**
 * What a code lets someone do, said once above the cards rather than in each —
 * in `privateAccess`'s own words for a Unit that can share, so the two never differ.
 */
const SHARING = privateAccess({ state: "not_created", expires_at: null, can_rotate: true, can_revoke: false }, { verified: true, occupied: false }).detail;
const SEARCH_FROM = 9;
const NEEDS_SHOWN = 8;

/** Each lane in the colour the product already gives it. */
const LANE: Record<TenantLane, { ink: string; wash: string }> = {
  overdue: { ink: LATERITE, wash: theme.color.laterite["100"] },
  paperwork: { ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  due: { ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  moving_in: { ink: LAGOON, wash: theme.color.lagoon["100"] },
  ending: { ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  settled: { ink: KOLA_DEEP, wash: theme.color.kola["50"] },
};

function ProviderTenantsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { view: requestedView, unitId: requestedUnit, propertyId: requestedProperty, scopeLabel } = useLocalSearchParams<{
    view?: "tenants" | "access" | "requests";
    unitId?: string;
    propertyId?: string;
    /** The Unit or Property by name, from the page that opened this, for when no record here names it. */
    scopeLabel?: string;
  }>();
  const { activeContext } = useAuth();
  const [organizationId, setOrganizationId] = useState("");
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [accessOpen, setAccessOpen] = useState(requestedView === "access" || Boolean(requestedUnit));
  const [needsAll, setNeedsAll] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Opened from a Unit or a Property, the page is about that Unit or Property
  // until the chip saying so is cleared (owner, 2026-10-06). It used to open on
  // the whole Portfolio, and a provider had to find the one Unit again.
  const [scope, setScope] = useState<Scope>(() => scopeFrom(requestedUnit, requestedProperty));
  const [seenScope, setSeenScope] = useState(`${requestedUnit ?? ""}|${requestedProperty ?? ""}`);
  if (`${requestedUnit ?? ""}|${requestedProperty ?? ""}` !== seenScope) {
    setSeenScope(`${requestedUnit ?? ""}|${requestedProperty ?? ""}`);
    setScope(scopeFrom(requestedUnit, requestedProperty));
    if (requestedUnit) setAccessOpen(true);
  }
  const clearScope = () => {
    setScope(null);
    router.setParams({ unitId: undefined, propertyId: undefined } as never);
  };

  // Arriving with `view=access` opens the private-access fold, as it once opened that view.
  const [seenView, setSeenView] = useState(requestedView);
  if (requestedView !== seenView) {
    setSeenView(requestedView);
    if (requestedView === "access") setAccessOpen(true);
  }
  useEffect(() => {
    if (requestedView === "requests") router.replace("/(app)/provider-applications" as never);
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
    } finally {
      setLoaded(true);
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const all = useMemo(() => (summary?.tenants ?? []).filter((row) => inScope(row, scope)), [summary, scope]);
  const access = useMemo(() => (summary?.tenant_access ?? []).filter((row) => inScope(row, scope)), [summary, scope]);
  const work = useMemo(() => tenantWork(all), [all]);
  // Only verified, available Units are sharing work; the rest are summarised.
  const ready = useMemo(
    () => access.filter((value) => value.condition_state === "approved" && value.availability.state === "available"),
    [access],
  );
  const notReady = access.length - ready.length;
  const scopeName = scope ? nameOf(scope, summary, scopeLabel) : "";
  const needle = query.trim().toLocaleLowerCase("en-GH");
  const entries = useMemo(
    () => entriesFor(work, all, { needle, needsAll, accessOpen, ready, hasAccess: Boolean(access.length) }),
    [work, all, needle, needsAll, accessOpen, ready, access],
  );

  // A request is decided in its own inbox; this only says one is waiting.
  const pendingRequests = summary ? summary.tenancy_requests.filter((request) => request.status === "pending" && inScope(request, scope)).length : 0;
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

  const openTenancy = (tenant: Tenant) =>
    router.push({ pathname: "/(app)/provider-tenancy", params: { tenancyId: tenant.tenancy_id ?? tenant.occupancy_id, organizationId } } as never);
  const openAccount = (tenant: Tenant) => tenant.lease_id && router.push({
    pathname: "/(app)/rent-account",
    params: { leaseId: tenant.lease_id, tenantName: tenant.name, propertyTitle: tenant.property_title, unitLabel: tenant.unit_label, bedLabel: tenant.bed_label ?? "", tenancyId: tenant.tenancy_id ?? "", canRecord: tenant.can_record_payment ? "1" : "0" },
  } as never);

  const loading = !loaded && summary === null;
  const nothingAtAll = loaded && !error && summary !== null && all.length === 0 && !access.length;
  const needs = work.needsYou.length;
  const parts = [
    work.overdueMinor > 0 ? { text: `${formatMinor(work.overdueMinor)} overdue`, tone: LATERITE, strong: true } : null,
    work.count.paperwork ? { text: `${work.count.paperwork} without an agreement`, tone: HARMATTAN } : null,
    work.count.moving_in ? { text: `${work.count.moving_in} moving in`, tone: LAGOON } : null,
    work.count.ending ? { text: `${work.count.ending} ending within ${ENDING_DAYS} days`, tone: HARMATTAN } : null,
    !needs && all.length ? { text: `${all.length} ${all.length === 1 ? "tenancy" : "tenancies"}`, tone: MUTED } : null,
  ].filter((part): part is NonNullable<typeof part> => part !== null);

  return (
    <IndexGround>
      <FlatList
        data={loading || nothingAtAll ? [] : entries}
        keyExtractor={(entry) => entry.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={loading || nothingAtAll ? (
          error ? <Notice tone="error" title={error} />
            : scope && !loading ? <View style={styles.header}><ScopeChip label={scopeName} unit={scope.kind === "unit"} onClear={clearScope} /></View>
              : null
        ) : (
          <View style={styles.header}>
            {error ? <Notice tone="error" title={error} /> : null}
            {scope ? <ScopeChip label={scopeName} unit={scope.kind === "unit"} onClear={clearScope} /> : null}
            {scope && !all.length ? (
              // Not an all-clear: an empty Unit is work to do, so it carries the Unit, not a tick.
              <Calm icon={scope.kind === "unit" ? "key-outline" : "business-outline"} text={scope.kind === "unit" ? "Nobody lives here yet. Share it privately below, or list it on Explore." : "Nobody lives in this Property yet."} />
            ) : null}
            {all.length ? (
              <Briefing
                title={needs ? `${needs} ${needs === 1 ? "tenancy needs" : "tenancies need"} you` : "Everyone is paid up"}
                parts={parts}
                trailing={all.length >= SEARCH_FROM
                  ? <BriefingButton icon={searching ? "close" : "search"} label={searching ? "Close search" : "Search tenants"} onPress={() => { setSearching((current) => !current); setQuery(""); }} />
                  : undefined}
              />
            ) : null}
            {searching ? <SearchField label="Search tenants" placeholder="Name, Property, Unit or bed" value={query} onChangeText={setQuery} /> : null}
            <SignalPanel signals={signals} />
          </View>
        )}
        renderItem={({ item: entry }) => {
          if (entry.kind === "label") {
            return (
              <View style={[styles.label, entry.first ? null : styles.labelGap]}>
                <GroupLabel count={entry.count} tone={entry.tone}>{entry.title}</GroupLabel>
              </View>
            );
          }
          if (entry.kind === "more") {
            return (
              <ListRow first={false} last>
                <View style={styles.rule} />
                <MoreRow label={`Show ${entry.hidden} more`} onPress={() => setNeedsAll(true)} />
              </ListRow>
            );
          }
          if (entry.kind === "calm") return <Calm text="Nobody is behind on rent or waiting on paperwork." />;
          if (entry.kind === "access") {
            return (
              <View style={styles.labelGap}>
                <Fold
                  title="Private access"
                  icon="key-outline"
                  summary={entry.ready ? `${entry.ready} ${entry.ready === 1 ? "Unit" : "Units"} ready to share with a code` : "No Unit is ready to share yet"}
                  count={entry.ready}
                  open={entry.open}
                  onToggle={() => setAccessOpen((current) => !current)}
                />
                {entry.open && entry.ready ? <View style={styles.sharing}><Footnote>{SHARING}</Footnote></View> : null}
              </View>
            );
          }
          if (entry.kind === "card") {
            return (
              <View style={styles.card}>
                <AccessCard
                  access={entry.access}
                  onChanged={load}
                  onView={() => router.push({ pathname: "/(app)/space", params: { propertyId: entry.access.property_id, unitId: entry.access.unit_id } } as never)}
                />
              </View>
            );
          }
          if (entry.kind === "accessFoot") {
            return ready.length ? (
              <AccessFooter shown={Math.min(ready.length, ACCESS_PREVIEW)} ready={ready.length} unavailable={notReady} onUnits={() => router.push("/(app)/units" as never)} />
            ) : (
              <Empty
                compact
                icon="key-outline"
                title="No Units ready to share privately"
                hint={notReady > 0 ? `${notReady} Unit${notReady === 1 ? " is" : "s are"} not verified or available.` : "A Unit must be verified and available before it can issue an access code."}
                action={<QuietAction icon="business-outline" label="Review Properties" onPress={() => router.push("/(app)/(provider-tabs)/properties" as never)} />}
              />
            );
          }
          return (
            <ListRow first={entry.first} last={entry.last}>
              {entry.first ? null : <View style={styles.rule} />}
              <TenantRow tenant={entry.tenant} onOpen={() => openTenancy(entry.tenant)} onAccount={() => openAccount(entry.tenant)} />
            </ListRow>
          );
        }}
        ListEmptyComponent={loading ? <TenantsSkeleton /> : nothingAtAll && scope ? (
          <Empty
            icon="people-outline"
            title={scope.kind === "unit" ? "Nobody lives here yet" : "No tenants in this Property yet"}
            hint="People appear here once an agreement is accepted and their tenancy begins."
            action={<QuietAction icon="people-outline" label="Show every tenant" onPress={clearScope} />}
          />
        ) : nothingAtAll ? (
          <Empty
            icon="people-outline"
            title="No tenants yet"
            hint="People appear here once an agreement is accepted and their tenancy begins."
            action={<QuietAction icon="mail-open-outline" label="Open tenancy requests" onPress={() => router.push("/(app)/provider-applications" as never)} />}
          />
        ) : needle ? (
          <Empty icon="search-outline" title="No matching tenants" hint="Try another name, Property, Unit or bed." />
        ) : null}
      />
    </IndexGround>
  );
}

/** What the page is narrowed to, from the link that opened it. A Unit wins over its Property. */
type Scope = { kind: "unit"; id: string } | { kind: "property"; id: string } | null;

function scopeFrom(unitId?: string, propertyId?: string): Scope {
  if (unitId) return { kind: "unit", id: unitId };
  if (propertyId) return { kind: "property", id: propertyId };
  return null;
}

function inScope(row: { unit_id: string; property_id: string }, scope: Scope): boolean {
  if (!scope) return true;
  return scope.kind === "unit" ? row.unit_id === scope.id : row.property_id === scope.id;
}

/** The Unit or Property by name, from whichever record names it. */
function nameOf(scope: NonNullable<Scope>, summary: PortfolioSummary | null, given?: string): string {
  const rows = [...(summary?.tenants ?? []), ...(summary?.tenant_access ?? []), ...(summary?.tenancy_requests ?? [])];
  const row = rows.find((candidate) => inScope(candidate, scope));
  if (!row) return given || (scope.kind === "unit" ? "This Unit" : "This Property");
  return scope.kind === "unit" ? `${row.unit_label} · ${row.property_title}` : row.property_title;
}

/** What the page is narrowed to, said once, with the way back to everyone. */
function ScopeChip({ label, unit, onClear }: { label: string; unit: boolean; onClear: () => void }) {
  return (
    <View style={styles.scopeRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Showing ${label}. Show every tenant.`}
        onPress={onClear}
        hitSlop={6}
        {...pressableFeedback(theme.color.kola["50"])}
        style={({ pressed }) => [styles.scope, pressed ? { opacity: 0.85 } : null]}
      >
        <Ionicons name={unit ? "grid-outline" : "business-outline"} size={15} color={KOLA_DEEP} />
        <Type variant="captionStrong" numberOfLines={1} style={styles.scopeText}>{label}</Type>
        <Ionicons name="close" size={16} color={KOLA_DEEP} />
      </Pressable>
    </View>
  );
}

function entriesFor(
  work: TenantWork,
  all: Tenant[],
  { needle, needsAll, accessOpen, ready, hasAccess }: { needle: string; needsAll: boolean; accessOpen: boolean; ready: Access[]; hasAccess: boolean },
): Entry[] {
  const out: Entry[] = [];
  const rows = (list: Tenant[], prefix: string, open = false) => list.forEach((tenant, index) => {
    out.push({ kind: "row", key: `${prefix}:${tenant.occupancy_id}`, tenant, first: index === 0, last: !open && index === list.length - 1 });
  });
  const label = (key: string, title: string, count: number, tone?: string) =>
    out.push({ kind: "label", key: `label:${key}`, title, count, tone, first: out.length === 0 });

  if (needle) {
    const found = all
      .filter((tenant) => [tenant.name, tenant.property_title, tenant.unit_label, tenant.bed_label].filter(Boolean).some((value) => value!.toLocaleLowerCase("en-GH").includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name, "en-GH"));
    rows(found, "found");
    return out;
  }

  if (work.needsYou.length) {
    label("needs", "Needs you", work.needsYou.length, LATERITE);
    const cut = !needsAll && work.needsYou.length > NEEDS_SHOWN + 1;
    const shown = cut ? work.needsYou.slice(0, NEEDS_SHOWN) : work.needsYou;
    rows(shown, "needs", cut);
    if (cut) out.push({ kind: "more", key: "more:needs", section: "needs", hidden: work.needsYou.length - shown.length });
  } else if (all.length) {
    out.push({ kind: "calm", key: "calm" });
  }
  if (work.movingIn.length) { label("moving", "Moving in", work.movingIn.length); rows(work.movingIn, "moving"); }
  if (work.ending.length) { label("ending", "Ending soon", work.ending.length); rows(work.ending, "ending"); }
  for (const group of work.byProperty) {
    label(`property:${group.property}`, group.property, group.tenants.length);
    rows(group.tenants, `property:${group.property}`);
  }

  if (hasAccess) {
    out.push({ kind: "access", key: "access", open: accessOpen, ready: ready.length });
    if (accessOpen) {
      ready.slice(0, ACCESS_PREVIEW).forEach((access) => out.push({ kind: "card", key: `card:${access.unit_id}`, access }));
      out.push({ kind: "accessFoot", key: "accessFoot" });
    }
  }
  return out;
}

/**
 * One tenancy: who, and the one figure that matters for its lane — what is
 * overdue or due, else the rent; where; and the one line about where it stands.
 * An overdue row carries the way into its rent account.
 */
function TenantRow({ tenant, onOpen, onAccount }: { tenant: Tenant; onOpen: () => void; onAccount: () => void }) {
  const lane = laneOf(tenant);
  const look = LANE[lane];
  const currency = tenant.lease_rent_currency ?? "GHS";
  const rent = monthlyRent(tenant);
  const place = [tenant.property_title, tenant.unit_label, tenant.bed_label].filter(Boolean).join(" · ");
  const figure = lane === "overdue"
    ? formatMinor(tenant.rent.overdue_minor, currency)
    : lane === "due"
      ? formatMinor(tenant.rent.outstanding_minor, currency)
      : rent !== null ? `${formatMinor(rent, currency).replace(/\.00$/, "")}/mo` : "";
  const ends = endsIn(tenant);
  const starts = startsIn(tenant);
  const line = lane === "overdue"
    ? "Overdue"
    : lane === "paperwork"
      ? "No agreement yet"
      : lane === "due"
        ? tenant.rent.next_due_on ? `Due ${shortDate(tenant.rent.next_due_on)}` : "Rent due"
        : lane === "moving_in"
          ? tenant.lease_starts_on ? `Moves in ${shortDate(tenant.lease_starts_on)}${starts !== null && starts >= 0 ? ` · in ${starts} ${starts === 1 ? "day" : "days"}` : ""}` : "Moving in"
          : lane === "ending"
            ? `Ends ${shortDate(tenant.lease_ends_on as string)}${ends !== null ? ` · in ${ends} ${ends === 1 ? "day" : "days"}` : ""}`
            : tenant.rent.next_due_on ? `Paid up · next due ${shortDate(tenant.rent.next_due_on)}` : "Paid up";
  const term = lane === "ending" ? termShare(tenant) : null;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${tenant.name}, ${place}. ${line}${figure ? `, ${figure}` : ""}. Open tenancy.`}
      onPress={onOpen}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, styles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <Face name={tenant.name} ink={look.ink} wash={look.wash} />
      <View style={[rowStyles.rowBody, styles.body]}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={2} style={rowStyles.rowTitle}>{tenant.name}</Type>}
          end={figure ? <Type variant="bodyStrong" numberOfLines={1} style={[styles.figure, lane === "overdue" ? { color: LATERITE } : lane === "settled" || lane === "moving_in" || lane === "ending" ? styles.figureQuiet : null]}>{figure}</Type> : undefined}
        />
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{place}</Type>
        {term !== null ? <View style={styles.term}><Bar value={term} tone={HARMATTAN} /></View> : null}
        <Type variant="caption" numberOfLines={1} style={[styles.line, { color: lane === "settled" ? MUTED : look.ink }]}>{line}</Type>
        {lane === "overdue" && tenant.lease_id ? (
          <Acts>
            <Act label="Rent account" icon="wallet-outline" primary onPress={onAccount} />
          </Acts>
        ) : null}
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

function TenantsSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading tenants" style={styles.skeleton}>
      <Bone width="58%" height={22} />
      <Bone width="42%" height={12} />
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={38} height={38} round={19} />
            <View style={styles.skeletonLines}>
              <Bone width="46%" height={14} />
              <Bone width="70%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  scopeRow: {
    flexDirection: "row",
  },
  scope: {
    maxWidth: "100%",
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: KOLA_DEEP,
    backgroundColor: theme.color.kola["50"],
  },
  scopeText: {
    flexShrink: 1,
    fontSize: 13.5,
    lineHeight: 18,
    color: KOLA_DEEP,
  },
  header: { gap: space[4], marginBottom: space[5] },
  label: { paddingBottom: space[2] },
  labelGap: { marginTop: space[5] },
  rule: { height: StyleSheet.hairlineWidth, marginLeft: 64, backgroundColor: RULE },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  row: { paddingVertical: 14 },
  body: { gap: 3 },
  figure: { fontSize: 14.5, lineHeight: 20, color: theme.color.ink["900"], fontVariant: ["tabular-nums"] },
  figureQuiet: { fontSize: 13.5, fontWeight: "500", color: FAINT },
  term: { marginTop: 6 },
  line: { fontSize: 12.5, lineHeight: 17, fontWeight: "500", marginTop: 2 },
  sharing: { marginTop: space[3] },
  card: { marginTop: space[3] },
  access: { overflow: "hidden", borderRadius: PANEL_RADIUS, borderWidth: 1, borderColor: EDGE, backgroundColor: GLASS },
  accessHead: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[3], paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: EDGE },
  viewUnit: { flexDirection: "row", alignItems: "center", gap: 2 },
  accessBody: { paddingHorizontal: 14, paddingVertical: space[3] },
  accessFooter: { gap: space[3], marginTop: space[3] },
  skeleton: { gap: space[3] },
  skeletonRow: { flexDirection: "row", gap: space[3], padding: 14 },
  skeletonLines: { flex: 1, justifyContent: "center", gap: space[2] },
});

/** On iOS the tab sits in the native bar, which draws no header; see `ProviderTabFrame`. */
export default function TenantsTab() {
  return (
    <ProviderTabFrame tab="tenants">
      <ProviderTenantsScreen />
    </ProviderTabFrame>
  );
}
