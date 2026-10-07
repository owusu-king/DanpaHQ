import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  FAINT,
  GroupLabel,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  MUTED,
  PRESSED,
  RULE,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { Briefing, Empty } from "@/components/work/WorkParts";
import { Notice, Type, radius, space } from "@/components/ui";
import {
  destination,
  needsYou,
  notificationSource,
  notificationTone,
  type NotificationTone,
} from "@/notificationMeaning";
import { listNotifications, markRead, timeAgo, type Notification } from "@/notifications";
import { isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/** How much activity a person keeps; the server prunes to the same number. */
const RECENT_KEPT = 10;
/** Unread activity older than this is shown as past, not new — the web's rule. */
const STALE_DAYS = 14;

type Day = { key: string; title: string; items: Notification[] };

/**
 * Updates: what wants an answer, then what happened — never a log.
 *
 * A reminder (rent due, a viewing about to start, a lease nearing its end) is
 * informational: once read it has done its job and the server deletes it, so
 * it leaves this screen the moment it is read. Activity — something that
 * happened to a record — is kept, the ten most recent. Nothing pages back
 * through history here; Home stays the live source of outstanding work. Same
 * rules as web Updates.
 *
 * Read as work (owner, 2026-10-06): what is waiting on the reader leads as a
 * row of cards to swipe through, each with its one step; everything else is a
 * timeline by day, unread first in weight, with a dot rather than a rule.
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

  // What needs an answer, then the rest unread, then the recent activity that
  // has been read. Read reminders are never here.
  const { waiting, timeline, listedNew } = useMemo(() => {
    const source = items ?? [];
    // A record does not know when the thing it is about was dealt with, so an
    // unread one weeks old is past, not new: it joins the recent pool rather
    // than waiting forever. Repeats about the same thing keep only the newest.
    const staleBefore = Date.now() - STALE_DAYS * 86_400_000;
    const stale = (item: Notification) => new Date(item.created_at).getTime() < staleBefore;
    const seen = new Set<string>();
    const latest = source.filter((item) => {
      const key = `${item.kind}:${item.target_type}:${item.target_id}`;
      if (!item.target_id || !seen.has(key)) { seen.add(key); return true; }
      return false;
    });
    const fresh = latest.filter((item) => !item.is_read && !stale(item));
    const nowWaiting = fresh.filter(needsYou);
    const other = fresh.filter((item) => !needsYou(item)).slice(0, RECENT_KEPT);
    const recent = latest
      .filter((item) => item.record === "activity" && (item.is_read || stale(item)))
      .slice(0, RECENT_KEPT);
    return {
      waiting: nowWaiting,
      timeline: byDay([...other, ...recent].sort((a, b) => b.created_at.localeCompare(a.created_at))),
      listedNew: nowWaiting.length + other.length,
    };
  }, [items]);
  const shown = waiting.length + timeline.reduce((sum, day) => sum + day.items.length, 0);

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
      <ScrollView
        contentContainerStyle={{ paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom }}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            tintColor={KOLA}
          />
        )}
      >
        <View style={[styles.pad, { paddingHorizontal: density.pagePadding }]}>
          {error ? <Notice tone="error" title={error} /> : null}
          {items === null ? <UpdatesSkeleton /> : null}
        </View>

        {items !== null && !shown && !(error && !items.length) ? (
          <Empty
            icon="notifications-off-outline"
            crossed={false}
            title="You’re all caught up"
            hint="Rental, application, agreement and payment updates appear here. Reminders clear once read; your ten most recent activities stay."
          />
        ) : null}

        {items !== null && shown ? (
          <>
            <View style={[styles.pad, { paddingHorizontal: density.pagePadding }]}>
              <Briefing
                title={listedNew ? `${listedNew} new ${listedNew === 1 ? "update" : "updates"}` : "You’re all caught up"}
                parts={[
                  waiting.length ? { text: `${waiting.length} ${waiting.length === 1 ? "wants" : "want"} an answer`, tone: LATERITE, strong: true } : null,
                  { text: "Reminders clear once read", tone: MUTED },
                ].filter((part): part is NonNullable<typeof part> => part !== null)}
                trailing={unread > 0 ? (
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
                    {markingAll ? <ActivityIndicator size="small" color={KOLA} /> : <Ionicons name="checkmark-done" size={16} color={KOLA} />}
                    {density.veryCompact ? null : <Type variant="captionStrong" style={styles.readAllText}>Read all</Type>}
                  </Pressable>
                ) : undefined}
              />
            </View>

            {waiting.length ? (
              <View style={styles.block}>
                <View style={{ paddingHorizontal: density.pagePadding }}>
                  <GroupLabel count={waiting.length} tone={LATERITE}>Wants an answer</GroupLabel>
                </View>
                <AnswerCards items={waiting} gutter={density.pagePadding} onOpen={open} />
              </View>
            ) : null}

            {timeline.map((day) => (
              <View key={day.key} style={[styles.block, { paddingHorizontal: density.pagePadding }]}>
                <GroupLabel>{day.title}</GroupLabel>
                <View style={styles.timeline}>
                  {day.items.map((item, index) => (
                    <TimelineRow key={item.id} item={item} last={index === day.items.length - 1} onPress={() => open(item)} />
                  ))}
                </View>
              </View>
            ))}

            <Type variant="caption" style={[styles.footnote, { paddingHorizontal: density.pagePadding }]}>
              {`Your ${RECENT_KEPT} most recent activities stay. Older ones clear on their own.`}
            </Type>
          </>
        ) : null}
      </ScrollView>
    </IndexGround>
  );
}

/**
 * What wants an answer, as cards to swipe through: what it is about, what
 * happened, a line of it, and the one step. Each is the size of a decision, not
 * of a row, so three of them never read as a list of chores.
 */
function AnswerCards({ items, gutter, onOpen }: { items: Notification[]; gutter: number; onOpen: (item: Notification) => void }) {
  const { width } = useWindowDimensions();
  const cardWidth = items.length === 1 ? width - gutter * 2 : Math.min(300, Math.round(width * 0.78));
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + space[3]}
      decelerationRate="fast"
      contentContainerStyle={{ paddingHorizontal: gutter, gap: space[3] }}
    >
      {items.map((item) => {
        const palette = tonePalette(notificationTone(item));
        return (
          <Pressable
            key={item.id}
            onPress={() => onOpen(item)}
            accessibilityRole="button"
            accessibilityLabel={`${notificationSource(item.kind)}. ${item.title}. ${item.body}. ${timeAgo(item.created_at)}. Review.`}
            {...pressableFeedback(PRESSED)}
            style={({ pressed }) => [styles.card, { width: cardWidth }, isAndroid ? null : styles.lift, pressed ? { opacity: 0.92 } : null]}
          >
            <View style={styles.cardTop}>
              <View style={[styles.well, { backgroundColor: palette.bg }]}>
                <Ionicons name={iconFor(item.kind)} size={18} color={palette.fg} />
              </View>
              <View style={styles.cardSource}>
                <Type variant="label" numberOfLines={1} style={[styles.source, { color: palette.fg }]}>{notificationSource(item.kind).toUpperCase()}</Type>
                <Type variant="caption" numberOfLines={1} style={styles.time}>{timeAgo(item.created_at)}</Type>
              </View>
            </View>
            <Type variant="bodyStrong" numberOfLines={2} style={styles.cardTitle}>{item.title}</Type>
            <Type variant="caption" numberOfLines={2} style={styles.cardBody}>{item.body}</Type>
            <View style={styles.cardAct}>
              <Type variant="captionStrong" style={styles.cardActText}>Review</Type>
              <Ionicons name="arrow-forward" size={14} color={theme.color.field["0"]} />
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * One thing that happened, on a rail: its kind as a glyph, what happened and a
 * line of it, and when. Unread is heavier, with a kola dot.
 */
function TimelineRow({ item, last, onPress }: { item: Notification; last: boolean; onPress: () => void }) {
  const palette = tonePalette(notificationTone(item));
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${notificationSource(item.kind)}. ${item.title}. ${item.body}. ${item.is_read ? "Read" : "Unread"}. ${timeAgo(item.created_at)}`}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [styles.event, pressed ? { backgroundColor: PRESSED } : null]}
    >
      <View style={styles.railColumn}>
        <View style={[styles.node, { backgroundColor: palette.bg }]}>
          <Ionicons name={iconFor(item.kind)} size={15} color={palette.fg} />
        </View>
        {last ? null : <View style={styles.rail} />}
      </View>
      <View style={styles.eventBody}>
        <View style={styles.eventTop}>
          <Type variant={item.is_read ? "body" : "bodyStrong"} numberOfLines={2} style={[styles.eventTitle, item.is_read ? styles.read : null]}>{item.title}</Type>
          <View style={styles.eventMeta}>
            {item.is_read ? null : <View style={styles.unreadDot} />}
            <Type variant="caption" style={styles.time}>{shortTime(item.created_at)}</Type>
          </View>
        </View>
        <Type variant="caption" numberOfLines={2} style={styles.eventText}>{item.body}</Type>
      </View>
    </Pressable>
  );
}

/** Shaped like the briefing, the cards and the first events, so nothing jumps when they arrive. */
function UpdatesSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading updates" style={styles.skeleton}>
      <Bone width="44%" height={22} />
      <Bone width="60%" height={12} />
      <Bone height={150} round={18} />
      <Panel>
        {[0, 1, 2].map((key) => (
          <View key={key} style={[styles.skeletonRow, key ? styles.ruled : null]}>
            <Bone width={32} height={32} round={16} />
            <View style={styles.skeletonLines}>
              <Bone width="70%" height={14} />
              <Bone width="90%" />
            </View>
          </View>
        ))}
      </Panel>
    </View>
  );
}

/** Today, Yesterday, this week by weekday, then Earlier. */
function byDay(items: Notification[]): Day[] {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = new Map<string, Day>();
  for (const item of items) {
    const at = new Date(item.created_at);
    const daysAgo = Math.floor((midnight - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86_400_000);
    const key = daysAgo <= 0 ? "today" : daysAgo === 1 ? "yesterday" : daysAgo < 7 ? `d${daysAgo}` : "earlier";
    const title = key === "today" ? "Today" : key === "yesterday" ? "Yesterday" : key === "earlier" ? "Earlier" : at.toLocaleDateString("en-GH", { weekday: "long" });
    if (!days.has(key)) days.set(key, { key, title, items: [] });
    days.get(key)!.items.push(item);
  }
  return [...days.values()];
}

/** The time for today's, the day and month for anything older: the day heading says the rest. */
function shortTime(iso: string) {
  const at = new Date(iso);
  const today = new Date();
  if (at.toDateString() === today.toDateString()) return at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" });
  return at.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

function iconFor(kind: string): IconName {
  if (kind.startsWith("payment.") || kind.startsWith("rent.") || kind.startsWith("billing.")) return "wallet-outline";
  if (kind.startsWith("application.") || kind.startsWith("tenancy_request.") || kind.startsWith("property_invitation.")) return "document-text-outline";
  if (kind.startsWith("viewing.")) return "calendar-outline";
  if (kind.startsWith("lease.")) return "reader-outline";
  if (kind.startsWith("maintenance.")) return "construct-outline";
  if (kind.startsWith("organization.")) return "people-outline";
  if (kind.startsWith("sale")) return "pricetags-outline";
  return "notifications-outline";
}

/** Each tone's ink and the well its glyph sits in. */
function tonePalette(tone: NotificationTone) {
  return {
    success: { fg: theme.color.kola["600"], bg: theme.color.kola["50"] },
    action: { fg: theme.color.harmattan["600"], bg: theme.color.harmattan["100"] },
    warning: { fg: theme.color.harmattan["600"], bg: theme.color.harmattan["100"] },
    critical: { fg: theme.color.laterite["600"], bg: theme.color.laterite["100"] },
    info: { fg: theme.color.lagoon["600"], bg: theme.color.lagoon["100"] },
    neutral: { fg: theme.color.ink["500"], bg: theme.color.field["100"] },
  }[tone];
}

const styles = StyleSheet.create({
  pad: {
    gap: space[3],
  },
  block: {
    gap: space[2],
    marginTop: space[6],
  },
  readAll: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RULE,
    backgroundColor: theme.color.field["0"],
  },
  readAllText: {
    fontSize: 13.5,
    lineHeight: 18,
    color: KOLA_DEEP,
  },
  pressed: {
    opacity: 0.72,
  },
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: 18,
    backgroundColor: theme.color.field["0"],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RULE,
  },
  lift: {
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  well: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  cardSource: {
    flex: 1,
    minWidth: 0,
  },
  source: {
    letterSpacing: 0.4,
  },
  time: {
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 21,
    color: INK,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  cardAct: {
    alignSelf: "flex-start",
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["800"],
  },
  cardActText: {
    color: theme.color.field["0"],
  },
  timeline: {
    marginTop: space[1],
  },
  event: {
    flexDirection: "row",
    gap: space[3],
    paddingRight: space[1],
    borderRadius: 12,
  },
  railColumn: {
    width: 32,
    alignItems: "center",
  },
  node: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  rail: {
    flex: 1,
    width: 2,
    marginVertical: 3,
    borderRadius: 1,
    backgroundColor: alpha(theme.color.kola["900"], 0.1),
  },
  eventBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingTop: 5,
    paddingBottom: space[4],
  },
  eventTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2],
  },
  eventTitle: {
    flex: 1,
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
  },
  read: {
    color: theme.color.ink["700"],
  },
  eventMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: KOLA,
  },
  eventText: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  footnote: {
    marginTop: space[2],
    fontSize: 12,
    lineHeight: 17,
    color: FAINT,
  },
  skeleton: {
    gap: space[3],
  },
  skeletonRow: {
    flexDirection: "row",
    gap: space[3],
    padding: 14,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  skeletonLines: {
    flex: 1,
    justifyContent: "center",
    gap: space[2],
  },
});
