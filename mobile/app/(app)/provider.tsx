import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type ProviderVerificationStatus } from "@/auth";
import { ProviderTermsConsent, type AcceptedProviderTerms } from "@/components/auth/ProviderTermsConsent";
import { Button, Notice, Type, space } from "@/components/ui";
import { safeHeaderTop, useSafeBottom } from "@/platform";
import { chooseWorkspace } from "@/workspace";
import { SignInMethods } from "@/components/account/SignInMethods";
import { theme } from "@/theme";

type Standing = { verification_status: ProviderVerificationStatus | null; workspace_access: boolean; terms_accepted?: boolean; decision_note?: string };
export default function ProviderStandingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottom = useSafeBottom(space[4]);
  const { state, refreshMe } = useAuth();
  const [standing, setStanding] = useState<Standing | null>(null);
  const [terms, setTerms] = useState<AcceptedProviderTerms | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setStanding(await apiFetch<Standing>("/me/provider-verification/")); setError(""); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your approval status."); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); const timer = setInterval(() => void load(), 30000); return () => clearInterval(timer); }, [load]));
  async function submit() {
    if (!terms || busy) return;
    setBusy(true); setError("");
    try { setStanding(await apiFetch<Standing>("/me/provider-verification/", { method: "POST", body: { terms_accepted: true, accepted_terms_version: terms.version, accepted_terms_digest: terms.digest } })); await refreshMe(); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not request approval."); }
    finally { setBusy(false); }
  }
  const status = standing?.verification_status ?? "not_started";
  const approved = Boolean(standing?.workspace_access);
  const needsPhone = !approved && state.status === "signed_in" && !state.me.is_phone_verified;
  const pending = status === "pending" && !needsPhone;
  const title = needsPhone ? "Complete your provider application" : approved ? "Provider access approved" : pending ? "Pending Approval" : status === "rejected" ? "Provider application rejected" : status === "needs_more_info" ? "Management needs more information" : status === "revoked" ? "Approval withdrawn" : "Request provider approval";
  const canSubmit = standing && !approved && !needsPhone && !["pending", "needs_more_info"].includes(status);
  const { height } = useWindowDimensions();
  const compact = height < 700;
  return <ScrollView keyboardShouldPersistTaps="handled" style={styles.page} contentContainerStyle={[styles.layout, { paddingTop: safeHeaderTop(insets.top) + space[4], paddingBottom: Math.max(bottom, space[4]) }, compact && { gap: space[3] }]}>
    <Type variant="caption" style={styles.eyebrow}>DANPA HQ / PROVIDER ACCOUNT</Type>
    <View style={[styles.main, compact && { gap: space[3], paddingVertical: space[2] }]}>
      {height >= 480 ? <View style={[styles.mark, { backgroundColor: pending ? theme.color.gold["50"] : theme.color.field["0"] }]}><Ionicons name={approved ? "checkmark-circle-outline" : pending ? "time-outline" : "shield-checkmark-outline"} size={24} color={pending ? theme.color.gold["600"] : theme.color.kola["800"]} /></View> : null}
      <View style={styles.heading}>
        <Type variant="title1" accessibilityRole="header" style={styles.centered}>{standing ? title : "Provider approval"}</Type>
        <Type variant="body" style={styles.description}>{needsPhone ? "Verify your phone by OTP before submitting for review." : pending ? "Your application is with Management. Your provider tools will open once it is approved." : approved ? "Your provider workspace is ready." : status === "needs_more_info" ? "Review Management’s note and update your profile." : "Review the provider agreement, then submit your application."}</Type>
      </View>
      {error ? <><Notice tone="error" title={error} /><Button label="Try again" variant="quiet" onPress={() => void load()} /></> : null}
      {standing?.decision_note ? <Notice tone="info" title="From Management" body={standing.decision_note} /> : null}
      {needsPhone ? <SignInMethods /> : pending ? <View style={styles.progress} accessibilityLabel="Application progress: profile complete, phone verified, management review pending">
        {([['Profile', 'checkmark-circle-outline'], ['Phone', 'checkmark-circle-outline'], ['Review', 'time-outline']] as const).map(([label, icon]) => <View key={label} style={styles.step}><Ionicons name={icon} size={18} color={label === "Review" ? theme.color.gold["600"] : theme.color.kola["600"]} /><Type variant="caption">{label}</Type></View>)}
      </View> : null}
      {canSubmit ? <View style={{ gap: space[3] }}><ProviderTermsConsent value={terms} onChange={setTerms} /><Button label="Request approval" disabled={!terms} busy={busy} onPress={() => void submit()} /></View> : null}
      {approved ? <Button label="Open provider workspace" onPress={async () => { await chooseWorkspace("provider"); await refreshMe(); router.replace("/(app)/(provider-tabs)"); }} /> : null}
      {pending || approved ? <Type variant="caption" style={styles.note}>Each property is verified separately.</Type> : null}
    </View>
    <View style={styles.footer}><Button label="Your Profile" variant="quiet" onPress={() => router.push("/(app)/(tabs)/profile")} /></View>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.color.field["50"] },
  layout: { flexGrow: 1, paddingHorizontal: space[5], gap: space[5], width: "100%", maxWidth: 520, alignSelf: "center" },
  eyebrow: { color: theme.color.ink["500"], letterSpacing: 1, textAlign: "center" },
  main: { flexGrow: 1, flexShrink: 0, justifyContent: "center", gap: space[5], paddingVertical: space[4] },
  heading: { width: "100%", maxWidth: 360, alignSelf: "center", gap: space[3] },
  centered: { textAlign: "center" },
  mark: { alignSelf: "center", width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.color.field["200"] },
  description: { color: theme.color.ink["700"], textAlign: "center" },
  progress: { flexDirection: "row", flexWrap: "wrap", rowGap: space[3], paddingVertical: space[4], borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.field["200"] },
  step: { flexGrow: 1, flexShrink: 0, flexBasis: "auto", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2] },
  note: { color: theme.color.ink["500"], textAlign: "center" },
  footer: { borderTopWidth: 1, borderColor: theme.color.field["200"], paddingTop: space[2] },
});
