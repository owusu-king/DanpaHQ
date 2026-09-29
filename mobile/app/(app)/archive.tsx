import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Fact, Panel } from "@/components/billing/BillingSurfaces";
import { SheetPrimaryButton } from "@/components/sheet/SheetParts";
import { useHomeDensity } from "@/components/home/plinth";
import {
  EmptyState,
  Footnote,
  GroupLabel,
  HARMATTAN,
  InfoNote,
  KOLA,
  KOLA_DEEP,
  ListRow,
  MUTED,
  PRESSED,
  RULE,
  RowLine,
  SummaryPanel,
  rowStyles,
  type IconName,
  type SummaryNote,
} from "@/components/portfolio/PortfolioList";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Notice, Type, space } from "@/components/ui";
import { pressableFeedback, useSafeBottom } from "@/platform";
import {
  listMyArchive,
  restoreProperty,
  restoreSpace,
  type ArchiveSummary,
  type ArchivedProperty,
  type ArchivedSpace,
} from "@/provider";
import { theme } from "@/theme";

type Item = ArchivedProperty | ArchivedSpace;
type Entry =
  | { kind: "group"; key: string; title: string; count: number; first: boolean }
  | { kind: "row"; key: string; item: Item; first: boolean; last: boolean };

/**
 * What was taken out of the working portfolio, and what can come back.
 *
 * Archiving is not deleting: the history stays, and so does the possibility of
 * restoring — but only while the current lifecycle allows it, which the server
 * decides per resource. That answer is the whole point of the screen.
 *
 * Refined on review (2026-09-15): how much is archived leads, with how much of
 * it can be restored right now. Each row then says only what it is and whether
 * it can come back; the reason it was archived, the blockers behind a refusal
 * and the restore itself open on the row, so a rarely-visited recovery list
 * stays a list rather than a stack of paragraphs.
 */
export default function ArchiveScreen() {
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const [archive, setArchive] = useState<ArchiveSummary | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setArchive(await listMyArchive());
      setError("");
    } catch (cause) {
      setArchive({ properties: [], spaces: [] });
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your archive.");
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function restore(resource: Item) {
    setBusy(resource.id);
    setError("");
    setMessage("");
    try {
      if (resource.resource_type === "property") await restoreProperty(resource.id);
      else await restoreSpace(resource.id);
      // The row it was opened from is about to disappear from the list.
      setSelected(null);
      setMessage(`${resource.label} was restored to your working portfolio.`);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That resource could not be restored.");
      setSelected(null);
      await load();
    } finally {
      setBusy("");
    }
  }

  const properties = archive?.properties ?? [];
  const spaces = archive?.spaces ?? [];
  const total = properties.length + spaces.length;
  const ready = [...properties, ...spaces].filter((item) => item.restore.allowed).length;
  const entries = useMemo(() => entriesFor(archive?.properties ?? [], archive?.spaces ?? []), [archive]);

  const note: SummaryNote = total === 0
    ? { text: "Nothing archived", tone: "calm" }
    : ready === 0
      ? { text: "None can be restored yet", tone: "alert" }
      : { text: `${ready} of ${total} can be restored now`, tone: "calm" };

  return (
    <IndexGround>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.key}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={KOLA}
          />
        }
        ListHeaderComponent={(
          <View style={{ gap: density.sectionGap + space[2], marginBottom: space[4] }}>
            {message ? <Notice tone="success" title={message} /> : null}
            {error ? <Notice tone="error" title={error} /> : null}
            {total ? (
              <SummaryPanel
                label="In archive"
                value={String(total)}
                note={note}
                facts={[
                  { label: "Properties", value: String(properties.length) },
                  { label: "Units", value: String(spaces.length) },
                ]}
              />
            ) : null}
          </View>
        )}
        renderItem={({ item: entry }) => {
          if (entry.kind === "group") {
            return (
              <View style={[styles.group, entry.first ? null : styles.groupGap]}>
                <GroupLabel count={entry.count}>{entry.title}</GroupLabel>
              </View>
            );
          }
          return (
            <ListRow first={entry.first} last={entry.last}>
              {entry.first ? null : <View style={styles.rule} />}
              <ArchiveRow item={entry.item} onPress={() => setSelected(entry.item)} />
            </ListRow>
          );
        }}
        ListEmptyComponent={
          archive === null ? (
            <ArchiveSkeleton />
          ) : error ? null : (
            <EmptyState
              icon="file-tray-outline"
              hero
              title="Your archive is empty"
              hint="A Property or Unit you take out of your working portfolio waits here with its history, ready to restore."
            />
          )
        }
        ListFooterComponent={total ? (
          <Footnote>Archiving keeps a resource and its history. Restoring is possible only while its current lifecycle allows it.</Footnote>
        ) : null}
      />

      <BottomSheet
        visible={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.label ?? "Archived"}
        closeLabel="Close details"
        footer={selected?.restore.allowed ? (
          <SheetPrimaryButton
            label="Restore"
            icon="arrow-undo-outline"
            busy={busy === selected.id}
            busyLabel="Restoring…"
            onPress={() => void restore(selected)}
          />
        ) : null}
      >
        {selected ? <ArchiveDetail item={selected} /> : null}
      </BottomSheet>
    </IndexGround>
  );
}

/** The archive as rows the list can virtualise, each kind under its own name. */
function entriesFor(properties: ArchivedProperty[], spaces: ArchivedSpace[]): Entry[] {
  const out: Entry[] = [];
  for (const group of [
    { key: "properties", title: "Properties", items: properties as Item[] },
    { key: "units", title: "Units", items: spaces as Item[] },
  ]) {
    if (!group.items.length) continue;
    out.push({ kind: "group", key: `group:${group.key}`, title: group.title, count: group.items.length, first: out.length === 0 });
    group.items.forEach((item, index) => out.push({
      kind: "row",
      key: `${item.resource_type}:${item.id}`,
      item,
      first: index === 0,
      last: index === group.items.length - 1,
    }));
  }
  return out;
}

/** One archived resource: what it is, where it was, when it went, and whether it can come back. */
function ArchiveRow({ item, onPress }: { item: Item; onPress: () => void }) {
  const restorable = item.restore.allowed;
  const standing = restorable ? "Can restore" : "Held";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.label}. ${placeOf(item)}. Archived ${formatDate(item.archived_at)}. ${standing}.`}
      accessibilityHint="Opens this archived record"
      onPress={onPress}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={[rowStyles.well, { backgroundColor: restorable ? theme.color.kola["50"] : theme.color.field["100"] }]}>
        <Ionicons name={iconOf(item)} size={16} color={restorable ? KOLA_DEEP : MUTED} />
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{item.label}</Type>}
          end={(
            <Type variant="captionStrong" numberOfLines={1} style={[styles.standing, { color: restorable ? KOLA : HARMATTAN }]}>
              {standing}
            </Type>
          )}
        />
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{placeOf(item)}</Type>
        <Type variant="caption" numberOfLines={1} style={rowStyles.rowMeta}>Archived {formatDate(item.archived_at)}</Type>
      </View>
    </Pressable>
  );
}

/** An archived record, opened: its facts, why it went, and what stands in the way of its return. */
function ArchiveDetail({ item }: { item: Item }) {
  return (
    <View style={styles.sheetBody}>
      <Panel>
        <Fact first icon={iconOf(item)} label="Kind" value={kindOf(item)} />
        <Fact
          icon="location-outline"
          label={item.resource_type === "property" ? "Where" : "Property"}
          value={item.resource_type === "property" ? `${item.locality}, ${item.district}` : item.property_title}
        />
        <Fact icon="grid-outline" label="Holds" value={holdingOf(item)} />
        <Fact icon="time-outline" label="Archived" value={formatDate(item.archived_at)} />
      </Panel>

      <View style={{ gap: space[2] }}>
        <GroupLabel>Why it was archived</GroupLabel>
        <Type variant="caption" style={styles.reason}>
          {item.archived_reason || "No reason was recorded for this older archive entry."}
        </Type>
      </View>

      {item.restore.allowed ? null : (
        <InfoNote
          tone="laterite"
          icon="lock-closed-outline"
          title="Cannot restore yet"
          body={[item.restore.message, ...item.restore.blockers.map((blocker) => blocker.message)].join(" ")}
        />
      )}
    </View>
  );
}

/** Shaped like the summary and the first rows, so nothing jumps when they arrive. */
function ArchiveSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your archive" style={styles.skeleton}>
      <Panel style={styles.skeletonPanel}>
        <Bone width="34%" height={11} />
        <Bone width="16%" height={30} />
        <Bone height={34} />
      </Panel>
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={32} height={32} round={10} />
            <View style={styles.skeletonLines}>
              <Bone width="52%" height={14} />
              <Bone width="70%" />
              <Bone width="40%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

function iconOf(item: Item): IconName {
  return item.resource_type === "property" ? "business-outline" : "bed-outline";
}

function kindOf(item: Item) {
  return item.resource_type === "property" ? item.property_type_label : item.space_type_label;
}

function placeOf(item: Item) {
  return item.resource_type === "property"
    ? `${item.property_type_label} · ${item.locality}, ${item.district}`
    : `${item.property_title} · ${item.space_type_label}${item.property_archived ? " · parent archived" : ""}`;
}

function holdingOf(item: Item) {
  if (item.resource_type === "property") {
    const units = `${item.unit_count} ${item.unit_count === 1 ? "Unit" : "Units"}`;
    return item.bed_count ? `${units} · ${item.bed_count} beds` : units;
  }
  return `${item.bed_count} ${item.bed_count === 1 ? "bed" : "beds"}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

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
  standing: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  sheetBody: {
    gap: space[4],
  },
  reason: {
    color: MUTED,
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
