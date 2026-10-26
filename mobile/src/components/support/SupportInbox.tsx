import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { ApiFailure } from "@/api";
import { Panel } from "@/components/billing/BillingSurfaces";
import { Select } from "@/components/form/Select";
import { INK, KOLA, MUTED, PRESSED, RULE, rowStyles } from "@/components/portfolio/PortfolioList";
import { Empty } from "@/components/work/WorkParts";
import { Notice, Type, radius, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { createSupportCase, listSupportCases, type SupportCase, type SupportCategory } from "@/support";
import { theme } from "@/theme";

const categories: { value: SupportCategory; label: string }[] = [
  { value: "account", label: "Account access" }, { value: "verification", label: "Verification" },
  { value: "application", label: "Application" }, { value: "lease", label: "Lease" },
  { value: "payment", label: "Payment" }, { value: "property", label: "Property or listing" },
  { value: "other", label: "Something else" },
];

export function SupportInbox() {
  const router = useRouter();
  const [rows, setRows] = useState<SupportCase[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState<SupportCategory>("other");
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setRows(await listSupportCases()); setError(""); }
    catch (cause) { setRows([]); setError(cause instanceof ApiFailure ? cause.error.message : "Could not load support tickets."); }
  }, []);
  useEffect(() => {
    let live = true;
    void listSupportCases()
      .then((result) => { if (live) { setRows(result); setError(""); } })
      .catch((cause) => { if (live) { setRows([]); setError(cause instanceof ApiFailure ? cause.error.message : "Could not load support tickets."); } });
    return () => { live = false; };
  }, []);

  async function submit() {
    if (!summary.trim() || !message.trim()) return;
    setBusy(true);
    try {
      const created = await createSupportCase({ category, summary: summary.trim(), message: message.trim() });
      setCreating(false); setSummary(""); setMessage("");
      await load();
      router.push({ pathname: "/(app)/support/[id]", params: { id: created.id } });
    } catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not create the ticket."); }
    finally { setBusy(false); }
  }

  if (creating) return <View style={styles.stack}>
    {error ? <Notice tone="error" title={error} /> : null}
    <Panel><View style={styles.form}>
      <Select label="What do you need help with?" value={category} options={categories} onChange={setCategory} />
      <Field label="Summary" value={summary} onChangeText={setSummary} maxLength={180} placeholder="A short title for your issue" />
      <Field label="Message" value={message} onChangeText={setMessage} maxLength={2000} placeholder="Tell Management what happened" multiline />
      <View style={styles.actions}><Pressable accessibilityRole="button" onPress={() => void submit()} disabled={busy || !summary.trim() || !message.trim()} style={[styles.primary, busy || !summary.trim() || !message.trim() ? styles.dim : null]}><Type variant="bodyStrong" style={styles.primaryText}>{busy ? "Sending…" : "Create ticket"}</Type></Pressable><Pressable accessibilityRole="button" onPress={() => setCreating(false)} style={styles.secondary}><Type variant="bodyStrong">Cancel</Type></Pressable></View>
    </View></Panel>
  </View>;

  return <View style={styles.stack}>
    {error ? <Notice tone="error" title={error} /> : null}
    <View style={styles.heading}><View style={rowStyles.rowBody}><Type variant="title2">Support</Type><Type variant="caption" style={styles.muted}>Create a ticket and keep the conversation with Management in one place.</Type></View><Pressable accessibilityRole="button" accessibilityLabel="New support ticket" onPress={() => setCreating(true)} style={styles.add}><Ionicons name="add" size={20} color="white" /></Pressable></View>
    {rows === null ? <Type variant="caption" style={styles.muted}>Loading support tickets…</Type> : rows.length === 0 ? <Empty icon="help-circle-outline" title="No support tickets" hint="If you need help with your account, rental, payment or property, start here." /> : <Panel>{rows.map((row, index) => <Pressable key={row.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/(app)/support/[id]", params: { id: row.id } })} {...pressableFeedback(PRESSED)} style={[rowStyles.row, index ? styles.ruled : null]}><View style={styles.icon}><Ionicons name="help-buoy-outline" size={18} color={KOLA} /></View><View style={rowStyles.rowBody}><View style={styles.line}><Type variant="bodyStrong" numberOfLines={1} style={styles.title}>{row.summary}</Type>{row.unread ? <View style={styles.dot} /> : null}</View><Type variant="caption" numberOfLines={2} style={styles.muted}>{row.last_message || row.details}</Type><Type variant="caption" style={styles.meta}>{row.status.replace("_", " ")} · {when(row.last_message_at || row.created_at)}</Type></View></Pressable>)}</Panel>}
  </View>;
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return <View style={styles.field}><Type variant="caption" style={styles.label}>{label}</Type><TextInput {...props} placeholderTextColor={theme.color.ink["300"]} style={[styles.input, props.multiline ? styles.multiline : null]} /></View>;
}

function when(value: string) { const date = new Date(value); return date.toLocaleDateString("en-GH", { day: "numeric", month: "short" }); }

const styles = StyleSheet.create({
  stack: { gap: space[4] }, heading: { flexDirection: "row", alignItems: "center", gap: space[3] },
  add: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: KOLA },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.kola["50"] },
  line: { flexDirection: "row", alignItems: "center", gap: space[2] }, title: { flex: 1, minWidth: 0, color: INK },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: KOLA }, muted: { color: MUTED },
  meta: { marginTop: 2, color: theme.color.ink["500"], textTransform: "capitalize" }, form: { gap: space[4], padding: space[4] },
  field: { gap: space[2] }, label: { color: theme.color.ink["700"] }, input: { minHeight: 52, paddingHorizontal: space[4], borderWidth: 1, borderColor: theme.color.field["300"], borderRadius: radius.md, backgroundColor: theme.color.field["0"], color: INK, fontSize: 16 },
  multiline: { minHeight: 120, paddingTop: space[3], textAlignVertical: "top" }, actions: { flexDirection: "row", gap: space[2] },
  primary: { minHeight: 44, justifyContent: "center", paddingHorizontal: space[4], borderRadius: radius.pill, backgroundColor: KOLA }, primaryText: { color: "white" },
  secondary: { minHeight: 44, justifyContent: "center", paddingHorizontal: space[4] }, dim: { opacity: .5 },
});
