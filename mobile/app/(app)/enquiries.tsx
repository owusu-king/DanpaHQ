/**
 * Conversations about properties for sale — the twin of the web `/enquiries`.
 *
 * A buyer never sees a seller's phone number (owner, 2026-09-28); they send an
 * enquiry, and the conversation lives here. A provider can be on both sides —
 * selling one plot while asking about another — so theirs has both. A tenant
 * account owns no property, so it has only what it asked about (owner,
 * 2026-09-29): no Selling side to be empty.
 *
 * Read as conversations rather than records (owner, 2026-10-06): new replies
 * lead, then the conversations still open, and what closed or sold folds into
 * one line.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
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

type Side = "buyer" | "seller";
type InboxMode = "support" | "property";

export default function EnquiriesScreen() {
  const router = useRouter();
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { as } = useLocalSearchParams<{ as?: string }>();
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";
  // Selling needs property, and only a provider account holds any.
  const canSell = signedIn && state.me.capabilities.provider.workspace_access;
  const provider = canSell && state.me.capabilities.active_workspace === "provider";
  const [mode, setMode] = useState<InboxMode>("support");
  const [chosen, setSide] = useState<Side>(as === "seller" || as === "buyer" ? as : provider ? "seller" : "buyer");
  const side: Side = canSell ? chosen : "buyer";
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!signedIn || mode === "support") return;
    try {
      setRows(await listEnquiries(side));
      setError("");
    } catch (cause) {
      setRows([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load enquiries.");
    }
  }, [mode, side, signedIn]);

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
        {canSell ? (
          <PillSwitch
            label="Which side"
            value={side}
            options={[{ value: "seller", label: "Selling" }, { value: "buyer", label: "Buying" }]}
            onChange={setSide}
          />
        ) : null}
        {error ? <Notice tone="error" title={error} /> : null}

        {rows === null ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading enquiries" style={styles.skeleton}>
            <Bone width="52%" height={22} />
            <Bone height={84} />
            <Bone height={84} />
          </View>
        ) : rows.length === 0 ? (error ? null : side === "seller" ? (
          <Empty
            icon="chatbubbles-outline"
            title="No enquiries yet"
            hint="When a buyer asks about a property you are selling, it arrives here."
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
              <Section title="New" tone={KOLA_DEEP} rows={lanes.fresh} side={side} onOpen={openRow} />
            ) : live ? <Calm text={side === "seller" ? "You are up to date with every buyer." : "You are up to date with every seller."} /> : null}
            {lanes.open.length ? <Section title="Conversations" rows={lanes.open} side={side} onOpen={openRow} /> : null}
            {lanes.closed.length ? (
              <View>
                <Fold title="Closed or sold" icon="lock-closed-outline" summary="Kept so you can read them back" count={lanes.closed.length} open={closedOpen} onToggle={() => setClosedOpen((current) => !current)} />
                {closedOpen ? <View style={styles.foldBody}><Section rows={lanes.closed} side={side} onOpen={openRow} /></View> : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </IndexGround>
  );
}

function Section({ title, tone, rows, side, onOpen }: { title?: string; tone?: string; rows: Enquiry[]; side: Side; onOpen: (row: Enquiry) => void }) {
  return (
    <View style={styles.section}>
      {title ? <GroupLabel count={rows.length} tone={tone}>{title}</GroupLabel> : null}
      <Panel>
        {rows.map((row, index) => <EnquiryRow key={row.id} row={row} side={side} first={index === 0} onOpen={() => onOpen(row)} />)}
      </Panel>
    </View>
  );
}

/**
 * One conversation: who or what it is about, the last thing said, and when. A
 * seller sees the buyer's name on the face; a buyer sees the property's tag.
 */
function EnquiryRow({ row, side, first, onOpen }: { row: Enquiry; side: Side; first: boolean; onOpen: () => void }) {
  const closed = row.status === "closed" || row.sale.status === "sold";
  const headline = row.sale.headline || "Property for sale";
  const meta = [side === "seller" ? headline : null, row.sale.price_formatted, row.sale.locality_name].filter(Boolean).join(" · ");
  const title = side === "seller" ? row.buyer_name : headline;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta}. ${row.last_message}. ${row.unread ? "New reply." : ""}${closed ? (row.sale.status === "sold" ? " Sold." : " Closed.") : ""}`}
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
        {meta ? <Type variant="caption" numberOfLines={1} style={rowStyles.rowSub}>{meta}</Type> : null}
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
