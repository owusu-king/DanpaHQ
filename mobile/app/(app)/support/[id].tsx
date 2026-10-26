import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { ApiFailure } from "@/api";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { useStackHeaderHeight } from "@/components/nav/StackHeader";
import { EDGE, INK, KOLA, MUTED } from "@/components/portfolio/PortfolioList";
import { Notice, Type, space } from "@/components/ui";
import { isIOS, maxFontSizeMultiplier, useSafeBottom } from "@/platform";
import { shell } from "@/shell";
import { getSupportCase, replyToSupportCase, type SupportCaseDetail } from "@/support";
import { theme } from "@/theme";

export default function SupportCaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const headerHeight = useStackHeaderHeight();
  const composerBottom = useSafeBottom(space[3]);
  const [ticket, setTicket] = useState<SupportCaseDetail | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    void getSupportCase(id)
      .then((result) => { if (live) { setTicket(result); setError(""); } })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this ticket."); });
    return () => { live = false; };
  }, [id]);

  async function send() {
    if (!id || !draft.trim()) return;
    setBusy(true);
    try { setTicket(await replyToSupportCase(id, draft.trim())); setDraft(""); setError(""); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "That reply did not send."); }
    finally { setBusy(false); }
  }

  if (!ticket) return <IndexGround><View style={styles.page}>{error ? <Notice tone="error" title={error} /> : <><Bone height={60} /><Bone width="70%" height={48} /></>}</View></IndexGround>;

  return <IndexGround>
    <Stack.Screen options={{ title: "Support" }} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={isIOS ? "padding" : undefined} keyboardVerticalOffset={isIOS ? headerHeight : 0}>
      <ScrollView ref={scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        <View style={styles.ticket}><Type variant="title2">{ticket.summary}</Type><Type variant="caption" style={styles.meta}>{ticket.category.replace("_", " ")} · {ticket.status.replace("_", " ")}</Type></View>
        <View accessibilityLabel="Support messages" style={styles.thread}>
          {ticket.messages.length ? ticket.messages.map((message) => <View key={message.id} style={[styles.message, message.mine ? styles.mine : null]}><View style={[styles.bubble, message.mine ? styles.bubbleMine : null]}><Type variant="body" style={[styles.body, message.mine ? styles.bodyMine : null]}>{message.body}</Type></View><Type variant="caption" style={styles.stamp}>{message.mine ? "You" : "Management"} · {new Date(message.created_at).toLocaleString("en-GH", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Type></View>) : <Notice tone="info" title={ticket.legacy_message || ticket.details} />}
        </View>
        {error ? <Notice tone="error" title={error} /> : null}
        {ticket.status === "resolved" || ticket.status === "dismissed" ? <Notice tone="info" title="This ticket is closed" body="Sending another message will reopen it for Management." /> : null}
      </ScrollView>
      <View style={[styles.composer, { paddingBottom: composerBottom }]}><TextInput value={draft} onChangeText={setDraft} placeholder="Write to Management" placeholderTextColor={theme.color.ink["300"]} accessibilityLabel="Your reply" multiline maxLength={2000} maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!draft.trim() || busy} onPress={() => void send()} style={[styles.send, !draft.trim() || busy ? styles.sendIdle : null]}><Ionicons name={busy ? "hourglass-outline" : "arrow-up"} size={20} color="white" /></Pressable></View>
    </KeyboardAvoidingView>
  </IndexGround>;
}

const styles = StyleSheet.create({
  page: { padding: space[4], gap: space[4] }, ticket: { gap: space[1], padding: space[4], borderWidth: 1, borderColor: EDGE, borderRadius: 16, backgroundColor: "white" }, meta: { color: MUTED, textTransform: "capitalize" }, thread: { gap: space[3] },
  message: { maxWidth: "82%", alignSelf: "flex-start", alignItems: "flex-start", gap: 4 }, mine: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubble: { paddingVertical: space[2] + 2, paddingHorizontal: space[3] + 2, borderRadius: 18, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: EDGE, backgroundColor: "white" }, bubbleMine: { borderBottomLeftRadius: 18, borderBottomRightRadius: 6, borderColor: KOLA, backgroundColor: KOLA },
  body: { fontSize: 15, lineHeight: 21, color: INK }, bodyMine: { color: "white" }, stamp: { fontSize: 11.5, color: MUTED },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space[2], paddingTop: space[2], paddingHorizontal: space[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: EDGE, backgroundColor: "white" },
  input: { flex: 1, minHeight: 44, maxHeight: 132, paddingHorizontal: space[4], paddingVertical: 11, borderRadius: 22, borderWidth: 1, borderColor: theme.color.field["300"], backgroundColor: shell.record, color: INK, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: KOLA }, sendIdle: { backgroundColor: theme.color.kola["300"] },
});
