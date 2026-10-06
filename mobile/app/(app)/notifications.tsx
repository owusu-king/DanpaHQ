import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
} from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  CHEVRON,
  EDGE,
  EmptyState,
  GLASS,
  GroupLabel,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  ListRow,
  MUTED,
  PRESSED,
  RULE,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { Notice, Type, radius, space } from "@/components/ui";
import {
  destination,
  needsYou,
  notificationSource,
  notificationStatus,
  notificationTone,
  type NotificationTone,
} from "@/notificationMeaning";
import { listNotifications, markRead, timeAgo, type Notification } from "@/notifications";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

type UpdateSection = { key: string; title: string; urgent?: boolean; note?: string; data: Notification[] };

/** How much activity a person keeps; the server prunes to the same number. */
const RECENT_KEPT = 10;
/** Unread activity older than this is shown as past, not new — the web's rule. */
const STALE_DAYS = 14;

/**
 * Updates: what is new, and what happened recently — never a log.
 *
 * A reminder (rent due, a viewing about to start, a lease nearing its end) is
 * informational: once read it has done its job and the server deletes it, so
 * it leaves this screen the moment it is read. Activity — something that
 * happened to a record — is kept, the ten most recent. Nothing pages back
 * through history here; management reads the full record in the audit log, and
 * Home stays the live source of outstanding work. Same rules as web Updates.
 *
 * The feed keeps its review-era shape (2026-09-15): glass on the hub ground,
 * unread as a coloured rule, and one toolbar with Read all — the filter sheet
 * and the pages went with the log they served.
 */
export default function NotificationsScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { state } = useAuth();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  // A reload keeps what is on screen; a failed refresh says so above it.
  const load = useCallback(async () => {
    try {
      const page = await listNotifications();
      setItems(page.results);
      setUnread(page.unread_count);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not load your updates.");
      setItems((current) => current ?? []);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const isProvider = state.status === "signed_in"
    && state.me.capabilities.active_workspace === "provider"
    && state.me.capabilities.provider.workspace_access;

  // New first — what needs an answer, then the rest unread — then the recent
  // activity that has been read. Read reminders are never here.
  const sections = useMemo<UpdateSection[]>(() => {
    const source = items ?? [];
    // A record does not know when the thing it is about was dealt with, so an
    // unread one weeks old — even "an agreement to look at" — is past, not new:
    // it joins the recent pool rather than waiting forever (a tenant had 72
    // unread rows, 18 of them "needing" answers long since given). Repeats about
    // the same thing keep only the newest. Home's own attention list reads live
    // state, so nothing truly outstanding is lost.
    const staleBefore = Date.now() - STALE_DAYS * 86_400_000;
    const stale = (item: Notification) => new Date(item.created_at).getTime() < staleBefore;
    const seen = new Set<string>();
    const latest = source.filter((item) => {
      const key = `${item.kind}:${item.target_type}:${item.target_id}`;
      if (!item.target_id || !seen.has(key)) { seen.add(key); return true; }
      return false;
    });
    const fresh = latest.filter((item) => !item.is_read && !stale(item));
    const waiting = fresh.filter(needsYou);
    const other = fresh.filter((item) => !needsYou(item)).slice(0, RECENT_KEPT);
    const recent = latest
      .filter((item) => item.record === "activity" && (item.is_read || stale(item)))
      .slice(0, RECENT_KEPT);
    const result: UpdateSection[] = [];
    if (waiting.length) result.push({ key: "attention", title: "Needs your attention", urgent: true, data: waiting });
    if (other.length) result.push({ key: "new", title: "New", data: other });
    if (recent.length) {
      result.push({
        key: "recent",
        title: "Recent activity",
        note: `Your ${RECENT_KEPT} most recent. Older activity clears on its own, and reminders clear once read.`,
        data: recent,
      });
    }
    return result;
  }, [items]);
  // What is listed as new — weeks-old records sit in Recent, so the server's
  // unread total would overstate it.
  const listedNew = sections
    .filter((section) => section.key !== "recent")
    .reduce((sum, section) => sum + section.data.length, 0);

  const shown = sections.reduce((sum, section) => sum + section.data.length, 0);

  /** Read: a reminder leaves the screen (the server deletes it); activity stays. */
  function open(item: Notification) {
    if (!item.is_read) {
      setItems((current) => current
        ?.filter((row) => !(row.id === item.id && row.record === "informational"))
        .map((row) => row.id === item.id ? { ...row, is_read: true } : row) ?? null);
      setUnread((current) => Math.max(0, current - 1));
      void markRead([item.id]).catch(() => void load());
    }
    router.push(destination(item, isProvider) as never);
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await markRead();
      setItems((current) => current
        ?.filter((item) => item.record !== "informational")
        .map((item) => ({ ...item, is_read: true })) ?? null);
      setUnread(0);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not mark these as read.");
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <IndexGround>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={KOLA}
          />
        )}
        ListHeaderComponent={(
          <View style={styles.header}>
            {error ? <Notice tone="error" title={error} /> : null}

            {shown ? (
              <View style={styles.toolbar} accessibilityRole="toolbar" accessibilityLabel="Updates">
                <View style={styles.toolbarTitle}>
                  {listedNew > 0 ? (
                    <>
                      <Type variant="title2" accessibilityRole="header" numberOfLines={1} style={styles.toolbarTitleText}>Unread</Type>
                      <Type variant="caption" style={styles.toolbarCount}>{listedNew}</Type>
                    </>
                  ) : (
                    <View style={styles.caughtUp}>
                      <Ionicons name="checkmark-done" size={17} color={KOLA} />
                      <Type variant="bodyStrong" accessibilityRole="header" numberOfLines={1} style={styles.caughtUpText}>You’re all caught up</Type>
                    </View>
                  )}
                </View>
                {unread > 0 ? (
                  <Pressable
                    onPress={() => void markAllRead()}
                    disabled={markingAll}
                    accessibilityRole="button"
                    accessibilityLabel="Mark all updates as read"
                    aria-disabled={markingAll} aria-busy={markingAll}
                    hitSlop={space[1]}
                    {...pressableFeedback(theme.color.kola["50"])}
                    style={({ pressed }) => [styles.readAll, pressed ? styles.pressed : null]}
                  >
                    {markingAll ? (
                      <ActivityIndicator size="small" color={KOLA} />
                    ) : (
                      <Ionicons name="checkmark-done" size={16} color={KOLA} />
                    )}
                    {density.veryCompact ? null : <Type variant="captionStrong" style={styles.readAllText}>Read all</Type>}
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        )}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeading}>
            <GroupLabel count={section.data.length} tone={section.urgent ? LATERITE : undefined}>{section.title}</GroupLabel>
            {section.note ? <Type variant="caption" style={styles.sectionNote}>{section.note}</Type> : null}
          </View>
        )}
        renderSectionFooter={() => <View style={styles.sectionFooter} />}
        renderItem={({ item, index, section }) => (
          <ListRow first={index === 0} last={index === section.data.length - 1}>
            <UpdateRow item={item} past={section.key === "recent"} onPress={() => open(item)} />
            {/* Drawn over the row rather than between rows, so an unread rule runs unbroken. */}
            {index === 0 ? null : <View pointerEvents="none" style={styles.rule} />}
          </ListRow>
        )}
        ListEmptyComponent={(
          items === null ? (
            <UpdatesSkeleton />
          ) : error && !items.length ? null : (
            <EmptyState
              icon="checkmark-done-outline"
              hero
              title="You’re all caught up"
              hint="New rental, application, agreement and payment updates appear here. Reminders clear once read; your ten most recent activities stay."
            />
          )
        )}
      />
    </IndexGround>
  );
}

/**
 * One update: where it came from and when, what happened, a line of it, and how
 * it stands in words. Unread keeps its left rule in the update's colour — never a
 * dot — and a heavier title; what wants a reply says so beside its status.
 */
function UpdateRow({ item, past = false, onPress }: { item: Notification; past?: boolean; onPress: () => void }) {
  const tone = notificationTone(item);
  const palette = tonePalette(tone);
  // A weeks-old prompt in Recent is history: no "Review now" on it.
  const actionable = needsYou(item) && !past;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${notificationSource(item.kind)}. ${item.title}. ${item.body}. ${notificationStatus(item)}. ${timeAgo(item.created_at)}`}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [
        styles.row,
        !item.is_read && { borderLeftColor: palette.fg, backgroundColor: palette.wash },
        pressed ? { backgroundColor: PRESSED } : null,
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: palette.bg }]}>
        <Ionicons name={iconFor(item.kind, tone)} size={17} color={palette.fg} />
      </View>
      <View style={rowStyles.rowBody}>
        <View style={styles.metaRow}>
          <Type variant="label" numberOfLines={1} style={[styles.source, { color: palette.fg }]}>{notificationSource(item.kind).toUpperCase()}</Type>
          <Type variant="caption" numberOfLines={1} style={styles.time}>{`· ${timeAgo(item.created_at)}`}</Type>
        </View>
        <Type variant={item.is_read ? "body" : "bodyStrong"} style={styles.title}>{item.title}</Type>
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>{item.body}</Type>
        <View style={styles.rowFooter}>
          <Type variant="captionStrong" style={[styles.status, { color: palette.fg }]}>{notificationStatus(item)}</Type>
          {actionable ? (
            <View style={styles.review}>
              <Type variant="captionStrong" style={styles.reviewText}>Review now</Type>
              <Ionicons name="arrow-forward" size={13} color={KOLA_DEEP} />
            </View>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={15} color={CHEVRON} style={styles.chevron} />
    </Pressable>
  );
}

/** Shaped like the toolbar and the first rows, so nothing jumps when they arrive. */
function UpdatesSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading updates" style={styles.skeleton}>
      <Bone width="34%" height={20} />
      <Panel>
        {[0, 1, 2, 3].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={36} height={36} round={11} />
            <View style={styles.skeletonLines}>
              <Bone width="30%" height={10} />
              <Bone width="76%" height={14} />
              <Bone width="92%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

function iconFor(kind: string, tone: NotificationTone): IconName {
  if (tone === "critical" || tone === "warning" || tone === "action") return "alert-circle-outline";
  if (kind.startsWith("payment.") || kind.startsWith("rent.") || kind.startsWith("billing.")) return "wallet-outline";
  if (kind.startsWith("application.") || kind.startsWith("tenancy_request.")) return "document-text-outline";
  if (kind.startsWith("viewing.")) return "calendar-outline";
  if (kind.startsWith("lease.")) return "reader-outline";
  if (tone === "success") return "checkmark-circle-outline";
  return "notifications-outline";
}

/** Each tone's ink, the well its glyph sits in, and the faint wash of an unread row on glass. */
function tonePalette(tone: NotificationTone) {
  return {
    success: { fg: theme.color.kola["600"], bg: theme.color.kola["50"], wash: alpha(theme.color.kola["600"], 0.05) },
    action: { fg: theme.color.harmattan["600"], bg: theme.color.harmattan["100"], wash: alpha(theme.color.harmattan["600"], 0.06) },
    warning: { fg: theme.color.harmattan["600"], bg: theme.color.harmattan["100"], wash: alpha(theme.color.harmattan["600"], 0.06) },
    critical: { fg: theme.color.laterite["600"], bg: theme.color.laterite["100"], wash: alpha(theme.color.laterite["600"], 0.05) },
    info: { fg: theme.color.lagoon["600"], bg: theme.color.lagoon["100"], wash: alpha(theme.color.lagoon["600"], 0.05) },
    neutral: { fg: theme.color.ink["500"], bg: theme.color.field["100"], wash: alpha(INK, 0.03) },
  }[tone];
}

const styles = StyleSheet.create({
  header: {
    gap: space[3],
    marginBottom: space[4],
  },
  toolbar: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingLeft: space[1],
  },
  toolbarTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[2],
  },
  toolbarTitleText: {
    flexShrink: 1,
    fontSize: 17.5,
    lineHeight: 23,
    letterSpacing: -0.2,
    color: INK,
  },
  toolbarCount: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  readAll: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  readAllText: {
    fontSize: 13.5,
    lineHeight: 18,
    color: KOLA_DEEP,
  },
  sectionHeading: {
    gap: space[1],
    paddingBottom: space[2],
  },
  sectionNote: {
    paddingHorizontal: space[1],
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  caughtUp: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  caughtUpText: {
    flexShrink: 1,
    color: KOLA_DEEP,
  },
  sectionFooter: {
    height: space[5],
  },
  rule: {
    position: "absolute",
    top: 0,
    left: 14,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: RULE,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingLeft: 11,
    paddingRight: 14,
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  source: {
    flexShrink: 1,
    letterSpacing: 0.4,
  },
  time: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
  title: {
    marginTop: 2,
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  rowFooter: {
    marginTop: space[2],
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space[3],
    rowGap: space[1],
  },
  status: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  review: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["50"],
  },
  reviewText: {
    fontSize: 12.5,
    lineHeight: 17,
    color: KOLA_DEEP,
  },
  chevron: {
    alignSelf: "center",
  },
  pressed: {
    opacity: 0.72,
  },
  skeleton: {
    gap: space[4],
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
