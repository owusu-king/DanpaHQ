import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from "react-native";

import {
  agreedTerms,
  agreementFilters,
  homeOf,
  matchesAgreementFilter,
  money,
  months,
  per,
  standing,
  type AgreementFilter,
  type AgreementStage,
  type AgreementStanding,
} from "@/agreementMeaning";
import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { ViewAll } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  ChoiceRow,
  EmptyState,
  FilterGroup,
  GroupLabel,
  HARMATTAN,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  ListHead,
  ListRow,
  MUTED,
  PRESSED,
  QuietAction,
  RowLine,
  RowSeparator,
  SearchField,
  SheetFooter,
  SummaryPanel,
  WHITE,
  initialsOf,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, Type, radius, space } from "@/components/ui";
import { listGrantedLeases, listMyLeases, type Lease } from "@/leases";
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import {
  leaseSearchText,
  providerLeasePeriod,
  providerLeasePlace,
  providerLeaseRent,
  providerLeaseStage,
  providerLeaseStatus,
  providerLeaseTenant,
  providerLeaseTone,
  providerLeaseWhen,
  type ProviderLeaseStage,
  type ProviderLeaseTone,
} from "@/providerLeaseMeaning";
import { theme } from "@/theme";

/**
 * Tenancy agreements.
 *
 * Accepting one commits real money — often a year of it up front — so the
 * screen states the total before it offers the button, breaks it into the
 * parts it is made of, and says plainly when the advance exceeds what the Rent
 * Act allows. It does not hide the button: two-year advances are the market,
 * and a tenant who decides to take one deserves to do it informed rather than
 * be blocked by us.
 *
 * Refined on review (2026-09-15) into the Portfolio lists' shape for both
 * readers: glass groups instead of rules and tabs, rows that never cut an
 * amount or a status short, and one green Filter control found at a glance.
 * The list's heading names what is showing, so the page says little else.
 */
export default function LeasesScreen() {
  const { state } = useAuth();
  const provider = state.status === "signed_in" &&
    state.me.capabilities.active_workspace === "provider" &&
    state.me.capabilities.provider.workspace_access;
  return provider ? <ProviderLeasesScreen /> : <TenantLeasesScreen />;
}

type ProviderView = "all" | ProviderLeaseStage;
type ProviderSection = { key: ProviderLeaseStage; title?: string; data: Lease[]; total: number };

/**
 * How much of a closed stage the whole list shows before it stops.
 *
 * History grows forever and is the one group nobody opened the page for, so it
 * gives two and then says how many there are. Filtering to it shows all of
 * them — somebody who asks for history has asked for history.
 */
const HISTORY_SHOWN = 2;

const STAGES: readonly ProviderLeaseStage[] = ["send", "current", "history"];
const VIEW_LABEL: Record<ProviderView, string> = {
  all: "All agreements",
  send: "To send",
  current: "Current",
  history: "History",
};
const VIEW_ICON: Record<ProviderView, IconName> = {
  all: "documents-outline",
  send: "paper-plane-outline",
  current: "document-text-outline",
  history: "archive-outline",
};

/** Each tone as the agreement screen colours it, with the soft wash its initials sit on. */
const TONE: Record<ProviderLeaseTone, { text: string; ink: string; wash: string }> = {
  good: { text: KOLA, ink: KOLA_DEEP, wash: theme.color.kola["50"] },
  attention: { text: LATERITE, ink: LATERITE, wash: theme.color.laterite["100"] },
  waiting: { text: HARMATTAN, ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  muted: { text: MUTED, ink: theme.color.ink["700"], wash: theme.color.field["100"] },
};

/**
 * The agreements this Portfolio granted.
 *
 * What is running leads, with what waits on the provider under it; then every
 * agreement, grouped in the order somebody works in — to send, current, history.
 * One green Filter narrows to a single stage, and search reaches the tenant, the
 * Property, the Unit and the bed.
 */
function ProviderLeasesScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  // An agreement belongs to the Portfolio whose Property granted it.
  const { activeContext } = useAuth();
  const preferred = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";
  const [items, setItems] = useState<Lease[] | null>(null);
  const [view, setView] = useState<ProviderView>("all");
  const [query, setQuery] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setItems(null);
    try { setItems(await listGrantedLeases(preferred ? { organization: preferred } : undefined)); setError(""); }
    catch (cause) { setItems([]); setError(cause instanceof ApiFailure ? cause.error.message : "We could not load these agreements."); }
  }, [preferred]);
  useEffect(() => { void load(); }, [load]);

  const all = useMemo(() => items ?? [], [items]);
  const stageCount = (value: ProviderView) => value === "all" ? all.length : all.filter((lease) => providerLeaseStage(lease) === value).length;
  const matching = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return all
      .filter((lease) => view === "all" || providerLeaseStage(lease) === view)
      .filter((lease) => !needle || leaseSearchText(lease).toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [all, query, view]);
  const sections = useMemo<ProviderSection[]>(
    () => (view === "all" ? STAGES : [view])
      .map((stage) => {
        const group = matching.filter((lease) => providerLeaseStage(lease) === stage);
        const folded = stage === "history" && view === "all" && group.length > HISTORY_SHOWN;
        return {
          key: stage,
          title: view === "all" ? VIEW_LABEL[stage] : undefined,
          data: folded ? group.slice(0, HISTORY_SHOWN) : group,
          total: group.length,
        };
      })
      .filter((section) => section.total > 0),
    [matching, view],
  );

  const active = all.filter((lease) => lease.status === "active").length;
  // Waiting for the tenant means offered, and only offered: by activation they have accepted.
  const awaiting = all.filter((lease) => lease.status === "offered").length;
  const toSend = stageCount("send");
  const toConfirm = all.filter((lease) => lease.status === "tenant_accepted").length;
  const onYou = [toSend ? `${toSend} to send` : "", toConfirm ? `${toConfirm} to confirm` : ""].filter(Boolean).join(" · ");

  return (
    <IndexGround>
      <SectionList<Lease, ProviderSection>
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={<View style={{ gap: density.sectionGap + space[2], marginBottom: space[4] }}>
          {error ? <Notice tone="error" title={error} /> : null}
          {all.length ? <SummaryPanel
            label="Active"
            value={String(active)}
            note={onYou ? { text: onYou, tone: "alert" } : { text: "Nothing waiting on you", tone: "calm" }}
            facts={[
              { label: "Waiting for tenant", value: String(awaiting) },
              { label: "All agreements", value: String(all.length) },
            ]}
          /> : null}
          {all.length ? <View style={{ gap: space[3] }}>
            <ListHead title={VIEW_LABEL[view]} count={matching.length} filters={view === "all" ? 0 : 1} filterTone="kola" onFilter={() => setFiltering(true)} />
            <SearchField label="Search agreements" placeholder="Tenant, Property or Unit" value={query} onChangeText={setQuery} />
          </View> : null}
        </View>}
        renderSectionHeader={({ section }) => section.title ? (
          <View style={styles.sectionHead}>
            {/* The count is the whole stage, never what the fold is showing. */}
            <GroupLabel count={section.total}>{section.title}</GroupLabel>
          </View>
        ) : null}
        renderSectionFooter={({ section }) => (
          <>
            {section.data.length < section.total ? (
              <ListRow first={false} last>
                <ViewAll count={section.total} noun="in history" onPress={() => setView("history")} />
              </ListRow>
            ) : null}
            <View style={{ height: space[5] }} />
          </>
        )}
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item, index, section }) => (
          <ListRow first={index === 0} last={section.data.length === section.total && index === section.data.length - 1}>
            <ProviderLeaseRow lease={item} narrow={density.veryCompact} onPress={() => router.push({ pathname: "/(app)/provider-lease", params: { leaseId: item.id } } as never)} />
          </ListRow>
        )}
        ListEmptyComponent={items === null ? <Type variant="caption" style={styles.loading}>Loading…</Type> : error ? null : (
          <ProviderEmpty
            view={view}
            searching={Boolean(query.trim())}
            hasAny={all.length > 0}
            onRequests={() => router.push("/(app)/provider-applications" as never)}
          />
        )}
      />
      <BottomSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        title="Filter"
        closeLabel="Close filter"
        footer={<SheetFooter
          canReset={view !== "all" || Boolean(query)}
          onReset={() => { setView("all"); setQuery(""); }}
          results={matching.length}
          onShow={() => setFiltering(false)}
        />}
      >
        <FilterGroup title="Show">
          {(["all", ...STAGES] as const).map((value, index) => (
            <ChoiceRow
              key={value}
              first={index === 0}
              icon={VIEW_ICON[value]}
              label={VIEW_LABEL[value]}
              count={stageCount(value)}
              selected={view === value}
              onPress={() => setView(value)}
            />
          ))}
        </FilterGroup>
      </BottomSheet>
    </IndexGround>
  );
}

/**
 * One agreement: the tenant against the rent, the exact space against where it
 * stands, then the rent's period and the one date that matters now. The initials
 * carry the status colour, so what waits on the provider is found before it is read.
 * On the narrowest phones the space keeps its whole line and the status moves
 * under it, because a Unit cut to "Fl…" is no longer an exact space.
 */
function ProviderLeaseRow({ lease, narrow, onPress }: { lease: Lease; narrow: boolean; onPress: () => void }) {
  const tenant = providerLeaseTenant(lease);
  const place = providerLeasePlace(lease);
  const rent = providerLeaseRent(lease);
  const period = providerLeasePeriod(lease);
  const status = providerLeaseStatus(lease);
  const when = providerLeaseWhen(lease);
  const tone = TONE[providerLeaseTone(lease)];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tenant}. ${place.join(", ")}. ${status}. ${rent ? `${rent} per ${period}` : "Rent not recorded"}. ${when}. Open agreement.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.initials, { backgroundColor: tone.wash }]}>
        <Type variant="captionStrong" style={[styles.initialsText, { color: tone.ink }]}>{initialsOf(tenant)}</Type>
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{tenant}</Type>}
          end={rent ? <Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowAmount}>{rent}</Type> : undefined}
        />
        {narrow ? (
          <>
            <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{place.join(" · ")}</Type>
            <Type variant="caption" numberOfLines={2} style={rowStyles.rowMeta}>
              <Type variant="caption" style={[rowStyles.rowStatus, { color: tone.text }]}>{status}</Type>
              {` · ${rent ? `Per ${period}` : "Rent not recorded"} · ${when}`}
            </Type>
          </>
        ) : (
          <>
            <RowLine
              start={<Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{place.join(" · ")}</Type>}
              end={<Type variant="caption" numberOfLines={1} style={[rowStyles.rowStatus, { color: tone.text }]}>{status}</Type>}
            />
            <Type variant="caption" numberOfLines={1} style={rowStyles.rowMeta}>{rent ? `Per ${period}` : "Rent not recorded"} · {when}</Type>
          </>
        )}
      </View>
    </Pressable>
  );
}

function ProviderEmpty({ view, searching, hasAny, onRequests }: { view: ProviderView; searching: boolean; hasAny: boolean; onRequests: () => void }) {
  const requests = <View style={styles.emptyAction}><QuietAction icon="mail-open-outline" label="Open tenancy requests" onPress={onRequests} /></View>;
  if (searching) return <EmptyState icon="search-outline" title="No matching agreements" hint="Try a different tenant, Property or Unit." />;
  if (!hasAny) return <EmptyState icon={VIEW_ICON.all} hero title="No agreements yet" hint="Prepare one from an accepted tenancy request." action={requests} />;
  if (view === "send") return <EmptyState icon={VIEW_ICON.send} title="Nothing to send" hint="Saved drafts wait here until they are sent." action={requests} />;
  if (view === "current") return <EmptyState icon={VIEW_ICON.current} title="No current agreements" hint="Sent, accepted and active agreements appear here." />;
  return <EmptyState icon={VIEW_ICON.history} title="No agreement history yet" hint="Declined, withdrawn and ended agreements stay here as records." />;
}

type AgreementRowData = { lease: Lease; state: AgreementStanding };
type TenantSection = { key: AgreementStage; title?: string; data: AgreementRowData[]; total: number };

const TENANT_STAGES: readonly AgreementStage[] = ["action", "active", "past"];
const STAGE_TITLE: Record<AgreementStage, string> = {
  action: "Needs your decision",
  active: "Active",
  past: "Past",
};
const FILTER_TITLE: Record<AgreementFilter, string> = {
  all: "All agreements",
  action: "Needs you",
  active: "Active",
  past: "Past",
};
const FILTER_ICON: Record<AgreementFilter, IconName> = {
  all: "documents-outline",
  action: "create-outline",
  active: "home-outline",
  past: "time-outline",
};
/** What needs deciding in kola, a home in place in its deep green, the past quiet. */
const STAGE_LOOK: Record<AgreementStage, { icon: IconName; ink: string; wash: string; dot: string }> = {
  action: { icon: "create-outline", ink: KOLA, wash: theme.color.kola["50"], dot: KOLA },
  active: { icon: "home-outline", ink: KOLA_DEEP, wash: theme.color.kola["50"], dot: theme.color.kola["300"] },
  past: { icon: "time-outline", ink: theme.color.ink["700"], wash: theme.color.field["100"], dot: theme.color.ink["300"] },
};

/**
 * The agreements this tenant holds.
 *
 * A row answers five of the six questions — which home, with whom, how much,
 * for how long, and what needs deciding. The sixth, *what am I agreeing to*, is
 * a document, and it opens on its own screen.
 *
 * The old card put "Accept agreement" and "Decline" above the money, the dates,
 * the conditions and the statutory advance notice, then asked the tenant to
 * confirm they had read "the advance-rent notice below". The most consequential
 * action in the product was offered before the reading. It now sits at the end
 * of the review, after the terms.
 */
function TenantLeasesScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const [items, setItems] = useState<Lease[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<AgreementFilter>("all");
  const [filtering, setFiltering] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listMyLeases());
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not load your agreements.",
      );
      setItems([]);
    }
  }, []);

  // Deciding happens on the review screen, so the list has to be right when it
  // comes back into view.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const rows = useMemo<AgreementRowData[]>(() => (items ?? []).map((lease) => ({ lease, state: standing(lease) })), [items]);
  const counts: Record<AgreementFilter, number> = {
    all: rows.length,
    action: rows.filter((row) => row.state.stage === "action").length,
    active: rows.filter((row) => row.state.stage === "active").length,
    past: rows.filter((row) => row.state.stage === "past").length,
  };
  const sections: TenantSection[] = TENANT_STAGES
    .filter((stage) => matchesAgreementFilter(stage, filter))
    .map((stage) => {
      const group = rows.filter((row) => row.state.stage === stage);
      const folded = stage === "past" && filter === "all" && group.length > HISTORY_SHOWN;
      return {
        key: stage,
        title: filter === "all" ? STAGE_TITLE[stage] : undefined,
        data: folded ? group.slice(0, HISTORY_SHOWN) : group,
        total: group.length,
      };
    })
    .filter((section) => section.total > 0);

  const open = (lease: Lease) =>
    router.push({ pathname: "/(app)/agreement/[id]", params: { id: lease.id } });

  return (
    <IndexGround>
      <SectionList<AgreementRowData, TenantSection>
        sections={sections}
        keyExtractor={(item) => item.lease.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={<View style={{ gap: space[3], marginBottom: space[4] }}>
          {error ? <Notice tone="error" title={error} /> : null}
          {rows.length ? (
            <ListHead title={FILTER_TITLE[filter]} count={counts[filter]} filters={filter === "all" ? 0 : 1} filterTone="kola" onFilter={() => setFiltering(true)} />
          ) : null}
        </View>}
        renderSectionHeader={({ section }) => section.title ? (
          <View style={styles.sectionHead}>
            {/* The count is the whole stage, never what the fold is showing. */}
            <GroupLabel count={section.total} tone={section.key === "action" ? KOLA_DEEP : undefined}>{section.title}</GroupLabel>
          </View>
        ) : null}
        renderSectionFooter={({ section }) => (
          <>
            {section.data.length < section.total ? (
              <ListRow first={false} last>
                <ViewAll count={section.total} noun="past agreements" onPress={() => setFilter("past")} />
              </ListRow>
            ) : null}
            <View style={{ height: space[5] }} />
          </>
        )}
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item, index, section }) => (
          <ListRow first={index === 0} last={section.data.length === section.total && index === section.data.length - 1}>
            <TenantAgreementRow lease={item.lease} state={item.state} onPress={() => open(item.lease)} />
          </ListRow>
        )}
        ListEmptyComponent={items === null ? <Type variant="caption" style={styles.loading}>Loading…</Type> : error ? null : (
          <TenantEmpty filter={filter} hasAny={rows.length > 0} />
        )}
      />
      <BottomSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        title="Filter"
        closeLabel="Close filter"
        footer={<SheetFooter
          canReset={filter !== "all"}
          onReset={() => setFilter("all")}
          results={counts[filter]}
          onShow={() => setFiltering(false)}
        />}
      >
        <FilterGroup title="Show">
          {agreementFilters.map((option, index) => (
            <ChoiceRow
              key={option.id}
              first={index === 0}
              icon={FILTER_ICON[option.id]}
              label={option.label}
              count={counts[option.id]}
              selected={filter === option.id}
              onPress={() => setFilter(option.id)}
            />
          ))}
        </FilterGroup>
      </BottomSheet>
    </IndexGround>
  );
}

/**
 * Read top to bottom, so nothing a tenant needs is cut short beside something
 * else: which home, with whom, then the rent leading one line of what moving in
 * costs and for how long; where it stands closes the row, with a Review pill
 * only while the tenant may still decide.
 */
function TenantAgreementRow({
  lease,
  state,
  onPress,
}: {
  lease: Lease;
  state: AgreementStanding;
  onPress: () => void;
}) {
  const terms = agreedTerms(lease);
  const decide = state.decisionOpen;
  const look = STAGE_LOOK[state.stage];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${homeOf(terms)}. With ${terms.landlordName}. ${money(terms.rentMinor, terms.rentCurrency)} per ${per(terms.rentPeriod)}. ${state.line}.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[rowStyles.well, { backgroundColor: look.wash }]}>
        <Ionicons name={look.icon} size={16} color={look.ink} />
      </View>
      <View style={rowStyles.rowBody}>
        <Type variant="bodyStrong" numberOfLines={2} style={rowStyles.rowTitle}>{homeOf(terms)}</Type>
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>
          With {terms.landlordName}{lease.locality_name ? ` · ${lease.locality_name}` : ""}
        </Type>
        <Type variant="caption" numberOfLines={1} style={[rowStyles.rowMeta, styles.rent]}>
          <Type variant="bodyStrong" style={rowStyles.rowAmount}>{money(terms.rentMinor, terms.rentCurrency)}</Type>
          {` / ${per(terms.rentPeriod)}`}
          {` · ${months(terms.termMonths)}`}
        </Type>
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowMeta}>
          {money(terms.moveInTotalMinor, terms.rentCurrency)} to move in
          {terms.startsOn ? ` · starts ${shortDate(terms.startsOn)}` : ""}
        </Type>
        <View style={styles.standing}>
          <View style={[styles.dot, { backgroundColor: look.dot }]} />
          <Type variant="captionStrong" numberOfLines={2} style={[styles.standingText, { color: decide ? KOLA_DEEP : MUTED }]}>
            {state.line}
          </Type>
          {decide ? (
            <View style={styles.review}>
              <Type variant="captionStrong" style={styles.reviewText}>Review</Type>
              <Ionicons name="arrow-forward" size={13} color={WHITE} />
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function TenantEmpty({ filter, hasAny }: { filter: AgreementFilter; hasAny: boolean }) {
  if (!hasAny) {
    return (
      <EmptyState
        icon={FILTER_ICON.all}
        hero
        title="No agreements yet"
        hint="When a landlord sends one, it waits here for you. Nothing binds you until you accept."
      />
    );
  }
  const copy: Record<AgreementFilter, { title: string; hint?: string }> = {
    all: { title: "No agreements here" },
    action: { title: "Nothing needs your decision", hint: "You have reviewed every agreement sent to you." },
    active: { title: "No active agreements", hint: "Accepted agreements stay easy to find here." },
    past: { title: "No past agreements", hint: "Declined, withdrawn and ended agreements appear here." },
  };
  return <EmptyState icon={FILTER_ICON[filter]} title={copy[filter].title} hint={copy[filter].hint} />;
}

function shortDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
  });
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
  rent: {
    marginTop: 2,
    lineHeight: 22,
  },
  standing: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    marginTop: space[2],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  standingText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
  },
  review: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: KOLA,
  },
  reviewText: {
    fontSize: 13,
    lineHeight: 17,
    color: WHITE,
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
