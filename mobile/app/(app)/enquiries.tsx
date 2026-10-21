/**
 * Conversations about properties for sale — the twin of the web `/enquiries`.
 *
 * A buyer never sees a seller's phone number (owner, 2026-09-28); they send an
 * enquiry, and the conversation lives here. A provider can be on both sides —
 * selling one plot while asking about another — and reads both in one list,
 * each conversation named for whoever is on the other side: no Selling and
 * Buying split (owner, 2026-10-21). A tenant account owns no property, so it
 * has only what it asked about (owner, 2026-09-29).
 *
 * Read as conversations rather than records (owner, 2026-10-06): new replies
 * lead, then the conversations still open, and what closed or sold folds into
 * one line.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  FAINT,
  GroupLabel,
  HARMATTAN,
  INK,
  KOLA,
  KOLA_DEEP,
  MUTED,
  PRESSED,
  QuietAction,
  RULE,
  rowStyles,
} from "@/components/portfolio/PortfolioList";
import { PillSwitch } from "@/components/sales/PillSwitch";
import { SupportInbox } from "@/components/support/SupportInbox";
import { Briefing, Calm, Empty, Face, Fold } from "@/components/work/WorkParts";
import { Notice, Type, radius, space } from "@/components/ui";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { listEnquiries, type Enquiry } from "@/sales";
import { theme } from "@/theme";

type InboxMode = "support" | "property";

export default function EnquiriesScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";
  // Selling needs property, and only a provider account holds any.
  const canSell = signedIn && state.me.capabilities.provider.workspace_access;
  const [mode, setMode] = useState<InboxMode>("support");
  // One list: everything for somebody who can sell, what they asked about otherwise.
  const listing = canSell ? "all" : "buyer";
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!signedIn || mode === "support") return;
    try {
      setRows(await listEnquiries(listing));
      setError("");
    } catch (cause) {
      setRows([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load enquiries.");
    }
  }, [mode, listing, signedIn]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  const lanes = useMemo(() => {
    const all = rows ?? [];
    const closed = (row: Enquiry) => row.status === "closed" || row.sale.status === "sold";
    const latest = (a: Enquiry, b: Enquiry) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at);
    return {
      fresh: all.filter((row) => !closed(row) && row.unread).sort(latest),
      open: all.filter((row) => !closed(row) && !row.unread).sort(latest),
      closed: all.filter(closed).sort(latest),
    };
  }, [rows]);

  if (!signedIn) {
    return (
      <AuthPrompt
        title="Your enquiries"
        body="Sign in to see your conversations."
        next="/(app)/enquiries"
      />
    );
  }

  if (mode === "support") {
    return (
      <IndexGround>
        <ScrollView contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: space[5] }}>
          <PillSwitch label="Inbox" value={mode} options={[{ value: "support", label: "Support" }, { value: "property", label: "Properties" }]} onChange={setMode} />
          <SupportInbox />
        </ScrollView>
      </IndexGround>
    );
  }

  const openRow = (row: Enquiry) => router.push({ pathname: "/(app)/enquiry/[id]", params: { id: row.id } });
  const live = lanes.fresh.length + lanes.open.length;

  return (
    <IndexGround>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: space[5] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={KOLA} />}
      >
        <PillSwitch label="Inbox" value={mode} options={[{ value: "support", label: "Support" }, { value: "property", label: "Properties" }]} onChange={setMode} />
        {error ? <Notice tone="error" title={error} /> : null}

        {rows === null ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading enquiries" style={styles.skeleton}>
            <Bone width="52%" height={22} />
            <Bone height={84} />
            <Bone height={84} />
          </View>
        ) : rows.length === 0 ? (error ? null : canSell ? (
          <Empty
            icon="chatbubbles-outline"
            title="No enquiries yet"
            hint="Buyers asking about property you sell, and sellers you ask about theirs, all arrive here."
          />
        ) : (
          <Empty
            icon="pricetag-outline"
            title="You have not asked about anything yet"
            hint="Find a property under Buy on Explore and send the seller a message."
            action={<QuietAction icon="compass-outline" label="Browse properties for sale" onPress={() => router.push({ pathname: "/(app)/search", params: { mode: "buy" } })} />}
          />
        )) : (
          <>
            <Briefing
              title={lanes.fresh.length
                ? `${lanes.fresh.length} new ${lanes.fresh.length === 1 ? "reply" : "replies"}`
                : live ? "No new replies" : "No open conversations"}
              parts={live ? [{ text: `${live} ${live === 1 ? "conversation" : "conversations"} open`, tone: MUTED }] : []}
            />
            {lanes.fresh.length ? (
              <Section title="New" tone={KOLA_DEEP} rows={lanes.fresh} showSide={canSell} onOpen={openRow} />
            ) : live ? <Calm text="You are up to date with every conversation." /> : null}
            {lanes.open.length ? <Section title="Conversations" rows={lanes.open} showSide={canSell} onOpen={openRow} /> : null}
            {lanes.closed.length ? (
              <View>
                <Fold title="Closed or sold" icon="lock-closed-outline" summary="Kept so you can read them back" count={lanes.closed.length} open={closedOpen} onToggle={() => setClosedOpen((current) => !current)} />
                {closedOpen ? <View style={styles.foldBody}><Section rows={lanes.closed} showSide={canSell} onOpen={openRow} /></View> : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </IndexGround>
  );
}

function Section({ title, tone, rows, showSide, onOpen }: { title?: string; tone?: string; rows: Enquiry[]; showSide: boolean; onOpen: (row: Enquiry) => void }) {
  return (
    <View style={styles.section}>
      {title ? <GroupLabel count={rows.length} tone={tone}>{title}</GroupLabel> : null}
      <Panel>
        {rows.map((row, index) => <EnquiryRow key={row.id} row={row} showSide={showSide} first={index === 0} onOpen={() => onOpen(row)} />)}
      </Panel>
    </View>
  );
}

/**
 * One conversation: who or what it is about, the last thing said, and when. A
 * seller sees the buyer's name on the face; a buyer sees the property's tag.
 */
function EnquiryRow({ row, showSide, first, onOpen }: { row: Enquiry; showSide: boolean; first: boolean; onOpen: () => void }) {
  // Each row knows which side this person is on, so one list needs no split.
  const side = row.role;
  const closed = row.status === "closed" || row.sale.status === "sold";
  const headline = row.sale.headline || "Property for sale";
  const meta = [side === "seller" ? headline : null, row.sale.price_formatted, row.sale.locality_name].filter(Boolean).join(" · ");
  const title = side === "seller" ? row.buyer_name : headline;
  // Both sides share one list now (owner, 2026-10-21): a word and a colour say which.
  const selling = side === "seller";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${showSide ? (selling ? "Selling. " : "Buying. ") : ""}${title}. ${meta}. ${row.last_message}. ${row.unread ? "New reply." : ""}${closed ? (row.sale.status === "sold" ? " Sold." : " Closed.") : ""}`}
      onPress={onOpen}
      {...pressableFeedback(PRESSED)}
      style={({ pressed }) => [rowStyles.row, first ? null : styles.ruled, pressed ? { backgroundColor: PRESSED } : null]}
    >
      {side === "seller" ? (
        <Face name={row.buyer_name} ink={closed ? theme.color.ink["700"] : KOLA_DEEP} wash={closed ? theme.color.field["100"] : theme.color.kola["50"]} fresh={row.unread && !closed} />
      ) : (
        <View style={[styles.tagWell, closed ? styles.tagWellClosed : null]}>
          <Ionicons name="pricetag-outline" size={17} color={closed ? theme.color.ink["700"] : HARMATTAN} />
          {row.unread && !closed ? <View style={styles.freshDot} /> : null}
        </View>
      )}
      <View style={[rowStyles.rowBody, styles.body]}>
        <View style={styles.top}>
          <Type variant="bodyStrong" numberOfLines={2} style={[styles.title, closed ? { color: MUTED } : null]}>{title}</Type>
          {row.last_message_at ? <Type variant="caption" style={[styles.when, row.unread ? { color: KOLA_DEEP, fontWeight: "600" } : null]}>{when(row.last_message_at)}</Type> : null}
        </View>
        {meta || showSide ? (
          <View style={styles.metaRow}>
            {showSide ? (
              <View style={[styles.sideTag, selling ? styles.sideSelling : styles.sideBuying]}>
                <Type variant="captionStrong" style={[styles.sideText, { color: selling ? KOLA_DEEP : theme.color.lagoon["600"] }]}>
                  {selling ? "Selling" : "Buying"}
                </Type>
              </View>
            ) : null}
            {meta ? <Type variant="caption" numberOfLines={1} style={[rowStyles.rowSub, { flexShrink: 1 }]}>{meta}</Type> : null}
          </View>
        ) : null}
        {row.last_message ? (
          <Type variant={row.unread ? "captionStrong" : "caption"} numberOfLines={2} style={[styles.last, row.unread ? { color: INK } : null]}>{row.last_message}</Type>
        ) : null}
        {closed ? (
          <View style={styles.closed}><Type variant="captionStrong" style={styles.closedText}>{row.sale.status === "sold" ? "Sold" : "Closed"}</Type></View>
        ) : null}
      </View>
    </Pressable>
  );
}

function when(value: string): string {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sideTag: { paddingVertical: 1, paddingHorizontal: 7, borderRadius: 999 },
  sideSelling: { backgroundColor: theme.color.kola["50"] },
  sideBuying: { backgroundColor: theme.color.lagoon["100"] },
  sideText: { fontSize: 11, lineHeight: 15 },
  section: { gap: space[2] },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  foldBody: { marginTop: space[3] },
  body: { gap: 2 },
  top: { flexDirection: "row", alignItems: "baseline", gap: space[2] },
  title: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, color: INK },
  when: { fontSize: 12, lineHeight: 16, color: FAINT },
  last: { marginTop: 2, fontSize: 13, lineHeight: 18, color: MUTED },
  tagWell: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.harmattan["100"] },
  tagWellClosed: { backgroundColor: theme.color.field["100"] },
  freshDot: { position: "absolute", top: -1, right: -1, width: 11, height: 11, borderRadius: 6, backgroundColor: KOLA, borderWidth: 2, borderColor: theme.color.field["0"] },
  closed: { alignSelf: "flex-start", marginTop: space[1], paddingHorizontal: space[2], paddingVertical: 1, borderRadius: radius.pill, backgroundColor: theme.color.field["100"] },
  closedText: { fontSize: 11.5, lineHeight: 15, color: theme.color.ink["700"] },
  skeleton: { gap: space[3] },
});
