import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { type RentalApplication, listReceivedApplications } from "@/applications";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel, ViewAll } from "@/components/billing/BillingSurfaces";
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
  RULE,
  RowLine,
  SearchField,
  SheetFooter,
  SummaryPanel,
  initialsOf,
  rowStyles,
  type IconName,
  type SummaryNote,
} from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, Type, space } from "@/components/ui";
import { type Lease, listGrantedLeases } from "@/leases";
import { timeAgo } from "@/notifications";
import { getPortfolioSummary, listOrganizations, type PortfolioSummary } from "@/organizations";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { useBlankOnPortfolioSwitch } from "@/portfolioScope";
import { theme } from "@/theme";

type Stage = "action" | "agreement" | "history";
type Show = "all" | Stage;
type Source = "all" | "application" | "private";
type Tone = "attention" | "waiting" | "good" | "neutral";
type PrivateRequest = PortfolioSummary["tenancy_requests"][number];
type RequestItem =
  | { key: string; kind: "application"; application: RentalApplication; lease: Lease | null }
  | { key: string; kind: "private"; request: PrivateRequest; organizationId: string };
type Entry =
  | { kind: "group"; key: string; title: string; count: number; tone?: string; first: boolean }
  | { kind: "row"; key: string; item: RequestItem; first: boolean; last: boolean }
  | { kind: "more"; key: string; count: number };

const TITLE: Record<Show, string> = {
  all: "All requests",
  action: "Needs action",
  agreement: "Agreement",
  history: "History",
};
const GROUP_TITLE: Record<Stage, string> = {
  action: "Needs your decision",
  agreement: "Agreement to prepare",
  history: "History",
};
const ICON: Record<Show, IconName> = {
  all: "albums-outline",
  action: "flash-outline",
  agreement: "document-text-outline",
  history: "time-outline",
};
/** Where a request came from, in the words the design record settled on. */
const SOURCE_LABEL: Record<RequestItem["kind"], string> = {
  application: "Public listing",
  private: "Direct request",
};
/** Waiting on the provider in laterite, on an agreement in harmattan, settled in kola or quiet. */
const TONE: Record<Tone, { text: string; ink: string; wash: string }> = {
  attention: { text: LATERITE, ink: LATERITE, wash: theme.color.laterite["100"] },
  waiting: { text: HARMATTAN, ink: HARMATTAN, wash: theme.color.harmattan["100"] },
  good: { text: KOLA, ink: KOLA_DEEP, wash: theme.color.kola["50"] },
  neutral: { text: MUTED, ink: theme.color.ink["700"], wash: theme.color.field["100"] },
};
/** How many settled requests the whole inbox shows before the rest are one tap away. */
const HISTORY_SHOWN = 3;

/**
 * People asking to rent, from a listing or with a Unit's access code, read as one
 * inbox and worked through in order: decide, prepare the agreement, keep the record.
 *
 * Refined on review (2026-09-15). How many wait for a decision leads, with how long
 * the oldest has waited; then one list grouped by what each request needs. One
 * green Filter holds the stage and the source together, beside a search, in place
 * of the page title, its sentence and three tabs.
 */
export default function ProviderApplicationsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const list = useRef<FlatList<Entry>>(null);
  const { activeContext } = useAuth();
  const [summaries, setSummaries] = useState<PortfolioSummary[] | null>(null);
  const [applications, setApplications] = useState<RentalApplication[] | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [stage, setStage] = useState<Show>("all");
  const [source, setSource] = useState<Source>("all");
  const [query, setQuery] = useState("");
  const [filtering, setFiltering] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // The private tenancy requests come from the Portfolio summary, so they too
  // go when the Portfolio does — a request answered on this screen decides
  // somebody's tenancy, and it must be one this Portfolio actually received.
  useBlankOnPortfolioSwitch(activeContext, () => {
    setSummaries(null);
    setApplications(null);
    setLeases([]);
  });

  const load = useCallback(async () => {
    // One Portfolio: the one being operated. Reading every Portfolio and
    // flattening them put a personal Portfolio's request beside a company's,
    // and answering it decided something this screen was not about.
    setApplications(null);
    try {
      const organizations = await listOrganizations();
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const organization = organizations.find((row) => row.id === preferred) ?? organizations[0];
      if (!organization) {
        setSummaries([]); setApplications([]); setLeases([]); setError("");
        return;
      }
      const scope = { organization: organization.id };
      const [summary, nextApplications, nextLeases] = await Promise.all([
        getPortfolioSummary(organization.id),
        listReceivedApplications(false, scope),
        listGrantedLeases(scope),
      ]);
      setSummaries([summary]); setApplications(nextApplications); setLeases(nextLeases); setError("");
    } catch (cause) {
      setApplications([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load tenancy requests.");
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const items = useMemo<RequestItem[]>(() => {
    const leaseByApplication = new Map(leases.filter((lease) => lease.application).map((lease) => [lease.application!, lease]));
    return [
      ...(applications ?? []).map((application) => ({ key: `application:${application.id}`, kind: "application" as const, application, lease: leaseByApplication.get(application.id) ?? null })),
      ...(summaries ?? []).flatMap((summary) => summary.tenancy_requests.map((request) => ({ key: `private:${request.id}`, kind: "private" as const, request, organizationId: summary.organization.id }))),
    ].sort((a, b) => createdAt(b).localeCompare(createdAt(a)));
  }, [applications, leases, summaries]);

  const inStage = (item: RequestItem, value: Show) => value === "all" || itemStage(item) === value;
  const fromSource = (item: RequestItem, value: Source) => value === "all" || item.kind === value;
  // Each choice counts what it would show beside the other choice already made.
  const stageCount = (value: Show) => items.filter((item) => fromSource(item, source) && inStage(item, value)).length;
  const sourceCount = (value: Source) => items.filter((item) => inStage(item, stage) && fromSource(item, value)).length;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return items
      .filter((item) => inStage(item, stage) && fromSource(item, source))
      .filter((item) => !needle || searchText(item).toLocaleLowerCase("en-GH").includes(needle));
  }, [items, query, source, stage]);
  const entries = useMemo(() => entriesFor(visible, stage), [visible, stage]);

  // What waits on the provider, and for how long the oldest of it has waited.
  const waiting = items.filter((item) => itemStage(item) === "action");
  // The summary is about every request, whatever the Filter is showing.
  const toPrepare = items.filter((item) => itemStage(item) === "agreement").length;
  const oldest = waiting.map(createdAt).sort()[0];
  const days = oldest ? Math.floor((Date.now() - new Date(oldest).getTime()) / 86_400_000) : 0;
  const note: SummaryNote = waiting.length
    ? { text: days > 0 ? `Oldest waiting ${days} ${days === 1 ? "day" : "days"}` : "All arrived today", tone: days >= 3 ? "alert" : "calm" }
    : { text: "Nothing waiting on you", tone: "calm" };

  const open = (item: RequestItem) =>
    router.push({ pathname: "/(app)/provider-application", params: { kind: item.kind, id: item.kind === "application" ? item.application.id : item.request.id, organizationId: item.kind === "private" ? item.organizationId : "" } } as never);
  // A new stage starts at the top of what it shows.
  const choose = (next: Show) => {
    setStage(next);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };

  return (
    <IndexGround>
      <FlatList
        ref={list}
        data={entries}
        keyExtractor={(entry) => entry.key}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
        ListHeaderComponent={(
          <View style={{ gap: density.sectionGap + space[2], marginBottom: space[4] }}>
            {error ? <Notice tone="error" title={error} /> : null}
            {items.length ? (
              <SummaryPanel
                label="Waiting for your decision"
                value={String(waiting.length)}
                note={note}
                facts={[
                  { label: "Need an agreement", value: String(toPrepare) },
                  { label: "All requests", value: String(items.length) },
                ]}
              />
            ) : null}
            {items.length ? (
              <View style={{ gap: space[3] }}>
                <ListHead title={TITLE[stage]} count={visible.length} filters={(stage === "all" ? 0 : 1) + (source === "all" ? 0 : 1)} filterTone="kola" onFilter={() => setFiltering(true)} />
                <SearchField label="Search requests" placeholder="Person, Property or Unit" value={query} onChangeText={setQuery} />
              </View>
            ) : null}
          </View>
        )}
        renderItem={({ item: entry }) => {
          if (entry.kind === "group") {
            return (
              <View style={[styles.group, entry.first ? null : styles.groupGap]}>
                <GroupLabel count={entry.count} tone={entry.tone}>{entry.title}</GroupLabel>
              </View>
            );
          }
          if (entry.kind === "more") {
            return (
              <ListRow first={false} last>
                <ViewAll count={entry.count} noun="in history" onPress={() => choose("history")} />
              </ListRow>
            );
          }
          return (
            <ListRow first={entry.first} last={entry.last}>
              {entry.first ? null : <View style={styles.rule} />}
              <RequestRow item={entry.item} onPress={() => open(entry.item)} />
            </ListRow>
          );
        }}
        ListEmptyComponent={applications === null ? <InboxSkeleton /> : error ? null : (
          <InboxEmpty
            stage={stage}
            narrowed={Boolean(query.trim()) || source !== "all"}
            hasAny={items.length > 0}
            onTenants={() => router.push("/(app)/(provider-tabs)/tenants" as never)}
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
          canReset={stage !== "all" || source !== "all" || Boolean(query)}
          onReset={() => { choose("all"); setSource("all"); setQuery(""); }}
          results={visible.length}
          onShow={() => setFiltering(false)}
        />}
      >
        <FilterGroup title="Show">
          <ChoiceRow first icon={ICON.all} label="All requests" count={stageCount("all")} selected={stage === "all"} onPress={() => choose("all")} />
          <ChoiceRow first={false} icon={ICON.action} label="Needs action" count={stageCount("action")} selected={stage === "action"} onPress={() => choose("action")} />
          <ChoiceRow first={false} icon={ICON.agreement} label="Agreement" count={stageCount("agreement")} selected={stage === "agreement"} onPress={() => choose("agreement")} />
          <ChoiceRow first={false} icon={ICON.history} label="History" count={stageCount("history")} selected={stage === "history"} onPress={() => choose("history")} />
        </FilterGroup>
        <FilterGroup title="From">
          <ChoiceRow first icon="albums-outline" label="Everywhere" count={sourceCount("all")} selected={source === "all"} onPress={() => setSource("all")} />
          <ChoiceRow first={false} icon="globe-outline" label={SOURCE_LABEL.application} count={sourceCount("application")} selected={source === "application"} onPress={() => setSource("application")} />
          <ChoiceRow first={false} icon="key-outline" label={SOURCE_LABEL.private} count={sourceCount("private")} selected={source === "private"} onPress={() => setSource("private")} />
        </FilterGroup>
      </BottomSheet>
    </IndexGround>
  );
}

/** The inbox as rows the list can virtualise: a group's name, its rows in one glass frame, and the way to the rest of the history. */
function entriesFor(rows: RequestItem[], show: Show): Entry[] {
  const out: Entry[] = [];
  for (const stage of show === "all" ? (["action", "agreement", "history"] as const) : [show]) {
    const group = rows.filter((item) => itemStage(item) === stage);
    if (!group.length) continue;
    if (show === "all") {
      out.push({ kind: "group", key: `group:${stage}`, title: GROUP_TITLE[stage], count: group.length, tone: stage === "action" ? LATERITE : undefined, first: out.length === 0 });
    }
    const cut = stage === "history" && show === "all" && group.length > HISTORY_SHOWN;
    const shown = cut ? group.slice(0, HISTORY_SHOWN) : group;
    shown.forEach((item, index) => out.push({ kind: "row", key: item.key, item, first: index === 0, last: !cut && index === shown.length - 1 }));
    if (cut) out.push({ kind: "more", key: "more:history", count: group.length });
  }
  return out;
}

/**
 * One request: who, and how long ago it arrived; the place they asked about; then
 * where it stands, in its colour, and where it came from. The initials carry the
 * colour too, so what waits on the provider is found before it is read.
 */
function RequestRow({ item, onPress }: { item: RequestItem; onPress: () => void }) {
  const who = item.kind === "application" ? item.application.applicant_name : item.request.requester_display;
  const where = item.kind === "application"
    ? item.application.listing_headline
    : [item.request.property_title, item.request.unit_label, item.request.bed_label].filter(Boolean).join(" · ");
  const status = statusLabel(item);
  const tone = TONE[toneOf(item)];
  const received = timeAgo(createdAt(item));
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${who}, ${status}, ${where}. ${SOURCE_LABEL[item.kind]}, received ${received}.`}
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[styles.initials, { backgroundColor: tone.wash }]}>
        <Type variant="captionStrong" style={[styles.initialsText, { color: tone.ink }]}>{initialsOf(who)}</Type>
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{who}</Type>}
          end={<Type variant="caption" numberOfLines={1} style={rowStyles.rowMeta}>{received}</Type>}
        />
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{where}</Type>
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowMeta}>
          <Type variant="caption" style={[rowStyles.rowStatus, { color: tone.text }]}>{status}</Type>
          {` · ${SOURCE_LABEL[item.kind]}`}
        </Type>
      </View>
    </Pressable>
  );
}

function InboxEmpty({ stage, narrowed, hasAny, onTenants }: { stage: Show; narrowed: boolean; hasAny: boolean; onTenants: () => void }) {
  if (narrowed) return <EmptyState icon="search-outline" title="No matching requests" hint="Try a different person, Property or Unit, or another source." />;
  if (!hasAny) {
    return (
      <EmptyState
        icon="document-text-outline"
        hero
        title="No tenancy requests yet"
        hint="People who apply to a listing, or ask with a Unit's access code, appear here."
        action={<View style={styles.emptyAction}><QuietAction icon="people-outline" label="Tenants" onPress={onTenants} /></View>}
      />
    );
  }
  if (stage === "action") return <EmptyState icon={ICON.action} title="Nothing needs a decision" hint="New applications and direct requests appear here." />;
  if (stage === "agreement") return <EmptyState icon={ICON.agreement} title="No agreements to prepare" hint="Accepted requests stay here until their agreement is sent." />;
  return <EmptyState icon={ICON.history} title="No request history yet" hint="Settled requests stay here as a record." />;
}

/** Shaped like the summary and the first rows, so nothing jumps when they arrive. */
function InboxSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading tenancy requests" style={styles.skeleton}>
      <Panel style={styles.skeletonPanel}>
        <Bone width="40%" height={11} />
        <Bone width="16%" height={30} />
        <Bone height={34} />
      </Panel>
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={36} height={36} round={18} />
            <View style={styles.skeletonLines}>
              <Bone width="44%" height={14} />
              <Bone width="72%" />
              <Bone width="50%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

function itemStage(item: RequestItem): Stage {
  if (item.kind === "application") { if (["submitted", "under_review"].includes(item.application.status)) return "action"; if (item.application.status === "accepted" && (!item.lease || item.lease.status === "draft")) return "agreement"; return "history"; }
  if (item.request.status === "pending") return "action";
  if (item.request.status === "approved" && (!item.request.lease_id || item.request.lease_status === "draft")) return "agreement";
  return "history";
}
/** Settled the provider's way in kola; a refusal, a withdrawal or an ending quietly. */
function toneOf(item: RequestItem): Tone {
  const stage = itemStage(item);
  if (stage === "action") return "attention";
  if (stage === "agreement") return "waiting";
  const settled = item.kind === "application" ? item.lease?.status ?? item.application.status : item.request.lease_status ?? item.request.status;
  return ["rejected", "withdrawn", "cancelled", "declined", "ended"].includes(settled) ? "neutral" : "good";
}
function statusLabel(item: RequestItem) { if (item.kind === "application") return item.lease ? agreementLabel(item.lease.status) : item.application.status_display; if (item.request.status === "pending") return "Decision needed"; return item.request.lease_status ? agreementLabel(item.request.lease_status) : "Agreement needed"; }
function agreementLabel(status: string) { return ({ draft: "Agreement ready to send", offered: "Waiting for tenant", awaiting_activation: "Waiting for activation", active: "Tenancy active", declined: "Agreement declined", cancelled: "Agreement cancelled", ended: "Tenancy ended" } as Record<string, string>)[status] ?? "Request settled"; }
function createdAt(item: RequestItem) { return item.kind === "application" ? item.application.created_at : item.request.created_at; }
function searchText(item: RequestItem) { return item.kind === "application" ? `${item.application.applicant_name} ${item.application.listing_headline} ${item.application.locality_name ?? ""}` : `${item.request.requester_display} ${item.request.property_title} ${item.request.unit_label} ${item.request.bed_label ?? ""}`; }

const styles = StyleSheet.create({
  group: {
    paddingBottom: space[2],
  },
  groupGap: {
    marginTop: space[5],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
    backgroundColor: RULE,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
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
  emptyAction: {
    marginTop: space[2],
  },
  skeleton: {
    gap: space[5],
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
  skeletonRow: {
    flexDirection: "row",
    gap: space[3],
    padding: 14,
  },
  skeletonLines: {
    flex: 1,
    justifyContent: "center",
    gap: space[2],
  },
});
