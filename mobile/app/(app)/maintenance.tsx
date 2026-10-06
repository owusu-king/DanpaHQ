import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import { RequestRow } from "@/components/maintenance/MaintenanceParts";
import {
  ChoiceRow,
  EmptyState,
  FilterGroup,
  GroupLabel,
  HARMATTAN,
  KOLA,
  LATERITE,
  ListHead,
  ListRow,
  RULE,
  SheetFooter,
  SummaryPanel,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { ActionBar, Pill } from "@/components/record/RecordSurfaces";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, space } from "@/components/ui";
import {
  listMyMaintenance,
  listOrganizationMaintenance,
  type MaintenanceRequest,
  type MaintenanceStatus,
} from "@/maintenance";
import { listOrganizations } from "@/organizations";
import { useSafeBottom } from "@/platform";
import { listMyTenancies, type Tenancy } from "@/tenancy";

type Side = "tenant" | "provider";
type Stage = "new" | "working" | "asking" | "completed";
type Show = "all" | Stage;
type Entry =
  | { kind: "group"; key: string; stage: Stage; count: number; first: boolean }
  | { kind: "row"; key: string; request: MaintenanceRequest; first: boolean; last: boolean };

const STAGES: Record<Stage, MaintenanceStatus[]> = {
  new: ["submitted", "reopened"],
  working: ["in_progress"],
  asking: ["awaiting_tenant_confirmation"],
  completed: ["completed"],
};

/** The same stage, named from the side reading it — and ordered by what to do first. */
const TITLE: Record<Side, Record<Show, string>> = {
  tenant: { all: "All requests", asking: "Confirm the fix", new: "Sent", working: "In progress", completed: "Completed" },
  provider: { all: "All requests", new: "New", working: "In progress", asking: "Waiting for tenant", completed: "Completed" },
};
const ORDER: Record<Side, Stage[]> = {
  tenant: ["asking", "new", "working", "completed"],
  provider: ["new", "working", "asking", "completed"],
};
const ICON: Record<Show, IconName> = {
  all: "albums-outline",
  new: "time-outline",
  working: "construct-outline",
  asking: "help-circle-outline",
  completed: "checkmark-done-outline",
};

const stageOf = (request: MaintenanceRequest) =>
  (Object.keys(STAGES) as Stage[]).find((stage) => STAGES[stage].includes(request.status)) ?? "new";

/**
 * Maintenance, for whichever side is reading — one screen, as on the web.
 *
 * A **tenant** sees what they reported, with anything that waits on them (a fix
 * to confirm) first, and reports a new problem from the bar at the foot. A
 * **provider** sees the requests on the Portfolio being operated, new work
 * first, oldest first within it — what has waited longest is what to start.
 * Each request opens its own record.
 */
export default function MaintenanceScreen() {
  const { state } = useAuth();
  const side: Side = state.status === "signed_in"
    && state.me.capabilities.active_workspace === "provider"
    && state.me.capabilities.provider.workspace_access ? "provider" : "tenant";
  return <MaintenanceList key={side} side={side} />;
}

function MaintenanceList({ side }: { side: Side }) {
  const router = useRouter();
  const density = useHomeDensity();
  const params = useLocalSearchParams<{ report?: string }>();
  const { activeContext } = useAuth();
  const list = useRef<FlatList<Entry>>(null);
  const [requests, setRequests] = useState<MaintenanceRequest[] | null>(null);
  const [tenancies, setTenancies] = useState<Tenancy[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [show, setShow] = useState<Show>("all");
  const [filtering, setFiltering] = useState(false);
  const canReport = side === "tenant" && tenancies.length > 0;
  const pageBottom = useSafeBottom(canReport ? space[6] : space[12]);

  const load = useCallback(async () => {
    try {
      if (side === "tenant") {
        const [rows, homes] = await Promise.all([listMyMaintenance(), listMyTenancies()]);
        setRequests(rows);
        setTenancies(homes.filter((row) => row.status === "active"));
      } else {
        // The Portfolio being operated; the first one when none is chosen yet.
        const preferred = activeContext?.startsWith("organization:") ? activeContext.slice("organization:".length) : "";
        const organization = preferred || (await listOrganizations())[0]?.id;
        setRequests(organization ? await listOrganizationMaintenance({ organization }) : []);
      }
      setError("");
    } catch (cause) {
      setRequests((current) => current ?? []);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load maintenance requests.");
    }
  }, [activeContext, side]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const all = useMemo(() => requests ?? [], [requests]);
  const counts = useMemo(() => {
    const result = { all: all.length } as Record<Show, number>;
    for (const stage of Object.keys(STAGES) as Stage[]) result[stage] = all.filter((row) => stageOf(row) === stage).length;
    return result;
  }, [all]);
  const entries = useMemo(() => entriesFor(all, show, side), [all, show, side]);

  const open = (request: MaintenanceRequest) =>
    router.push({ pathname: "/(app)/maintenance-request", params: { id: request.id } } as never);
  const report = () =>
    router.push({ pathname: "/(app)/maintenance-report", params: params.report ? { tenancy: params.report } : {} } as never);
  const choose = (next: Show) => {
    setShow(next);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };

  const waiting = side === "tenant" ? counts.asking : counts.new;
  const unfinished = all.length - counts.completed;

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
            {all.length ? (
              <SummaryPanel
                label={side === "tenant" ? "Open requests" : "Open repairs"}
                value={String(unfinished)}
                note={waiting
                  ? { text: side === "tenant" ? `${waiting} to confirm` : `${waiting} not started`, tone: "alert" }
                  : { text: "Nothing waits on you", tone: "calm" }}
                facts={[
                  { label: "In progress", value: String(counts.working) },
                  { label: side === "tenant" ? "Completed" : "Waiting for tenant", value: String(side === "tenant" ? counts.completed : counts.asking) },
                ]}
              />
            ) : null}
            {all.length ? (
              <ListHead title={TITLE[side][show]} count={show === "all" ? all.length : counts[show]} filters={show === "all" ? 0 : 1} filterTone="kola" onFilter={() => setFiltering(true)} />
            ) : null}
          </View>
        )}
        renderItem={({ item: entry }) => entry.kind === "group" ? (
          <View style={[styles.group, entry.first ? null : styles.groupGap]}>
            <GroupLabel count={entry.count} tone={toneOf(entry.stage, side)}>{TITLE[side][entry.stage]}</GroupLabel>
          </View>
        ) : (
          <ListRow first={entry.first} last={entry.last}>
            {entry.first ? null : <View style={styles.rule} />}
            <RequestRow request={entry.request} side={side} onPress={() => open(entry.request)} />
          </ListRow>
        )}
        ListEmptyComponent={requests === null ? <ListSkeleton /> : error ? null : (
          all.length ? (
            <EmptyState icon={ICON[show]} title={`Nothing ${TITLE[side][show].toLowerCase()}`} hint="Other requests are under All." />
          ) : side === "tenant" ? (
            <EmptyState
              icon="construct-outline"
              hero
              title="Nothing reported"
              hint={canReport ? "A leak, a fault, a broken lock — report it with a photo and your landlord is told at once." : "Once your tenancy is active you can report problems here."}
            />
          ) : (
            <EmptyState icon="construct-outline" hero title="No maintenance requests" hint="When a tenant reports a problem it arrives here with their photo, and you are notified." />
          )
        )}
      />

      {canReport ? (
        <ActionBar>
          <Pill grow icon="add-circle-outline" label="Report a problem" onPress={report} />
        </ActionBar>
      ) : null}

      <BottomSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        title="Filter"
        hideTitle
        closeLabel="Close filter"
        footer={<SheetFooter canReset={show !== "all"} onReset={() => choose("all")} results={show === "all" ? all.length : counts[show]} onShow={() => setFiltering(false)} />}
      >
        <FilterGroup title="Show">
          {(["all", ...ORDER[side]] as Show[]).map((key, index) => (
            <ChoiceRow key={key} first={index === 0} icon={ICON[key]} label={TITLE[side][key]} count={counts[key]} selected={show === key} onPress={() => choose(key)} />
          ))}
        </FilterGroup>
      </BottomSheet>
    </IndexGround>
  );
}

function toneOf(stage: Stage, side: Side) {
  if (side === "tenant" && stage === "asking") return KOLA;
  if (side === "provider" && stage === "new") return LATERITE;
  if (stage === "new") return HARMATTAN;
  return undefined;
}

function entriesFor(rows: MaintenanceRequest[], show: Show, side: Side): Entry[] {
  const out: Entry[] = [];
  for (const stage of show === "all" ? ORDER[side] : [show]) {
    const group = rows
      .filter((row) => stageOf(row) === stage)
      // New work oldest first for the provider; everything else most recent first.
      .sort((a, b) => side === "provider" && stage === "new"
        ? a.status_changed_at.localeCompare(b.status_changed_at)
        : b.status_changed_at.localeCompare(a.status_changed_at));
    if (!group.length) continue;
    if (show === "all") out.push({ kind: "group", key: `group:${stage}`, stage, count: group.length, first: out.length === 0 });
    group.forEach((request, index) => out.push({ kind: "row", key: request.id, request, first: index === 0, last: index === group.length - 1 }));
  }
  return out;
}

function ListSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading maintenance" style={styles.skeleton}>
      <Panel style={styles.skeletonPanel}>
        <Bone width="30%" height={11} />
        <Bone width="18%" height={30} />
        <Bone height={34} />
      </Panel>
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={52} height={52} round={14} />
            <View style={styles.skeletonLines}>
              <Bone width="46%" height={14} />
              <Bone width="70%" />
              <Bone width="30%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { paddingBottom: space[2] },
  groupGap: { marginTop: space[5] },
  rule: { height: StyleSheet.hairlineWidth, marginLeft: 14, backgroundColor: RULE },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  skeleton: { gap: space[5] },
  skeletonPanel: { gap: space[3], padding: space[4] },
  skeletonRow: { flexDirection: "row", gap: space[3], padding: 14 },
  skeletonLines: { flex: 1, justifyContent: "center", gap: space[2] },
});

