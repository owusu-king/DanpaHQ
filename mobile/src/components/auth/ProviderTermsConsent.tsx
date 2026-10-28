import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiFetch } from "@/api";
import { ModalSafeArea } from "@/components/sheet/ModalSafeArea";
import { Button, Type, space } from "@/components/ui";
import { safeHeaderTop } from "@/platform";
import { theme } from "@/theme";

export type AcceptedProviderTerms = { version: string; digest: string };
type Policy = AcceptedProviderTerms & { text: string; available: boolean };
export function ProviderTermsConsent({ value, onChange, presentation = "modal" }: {
  value: AcceptedProviderTerms | null; onChange: (value: AcceptedProviderTerms | null) => void;
  presentation?: "modal" | "inline";
}) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [viewed, setViewed] = useState("");
  const { height } = useWindowDimensions();
  const sizes = useRef({ viewport: 0, content: 0 });
  const load = useCallback(() => apiFetch<Policy>("/provider-registration-policy/", { anonymous: true }).then((next) => {
    setPolicy(next); setViewed(""); onChange(null);
    setError(next.available ? "" : "Provider terms are being updated.");
  }).catch(() => { setPolicy(null); onChange(null); setError("Could not load provider terms."); }), [onChange]);
  useEffect(() => { void load(); }, [load]);
  const key = policy ? `${policy.version}:${policy.digest}` : "";
  const ready = Boolean(key && viewed === key);
  const checked = Boolean(ready && policy && value?.digest === policy.digest && value.version === policy.version);
  function checkFit() { if (sizes.current.viewport > 0 && sizes.current.content > 0 && sizes.current.content <= sizes.current.viewport + 2) setViewed(key); }
  return <View style={{ gap: space[2] }}>
    {policy?.available ? <>
      {presentation === "inline" ? <>
        <Type variant="caption" style={styles.muted}>Terms and Conditions · Version {policy.version}</Type>
        <ScrollView key={key} accessibilityLabel="Provider agreement text" nestedScrollEnabled style={[styles.inlineReader, { height: Math.min(280, height * 0.35) }]} contentContainerStyle={{ padding: space[4] }} scrollEventThrottle={16}
          onLayout={event => { sizes.current.viewport = event.nativeEvent.layout.height; checkFit(); }}
          onContentSizeChange={(_, content) => { sizes.current.content = content; checkFit(); }}
          onScroll={({ nativeEvent: e }) => { if (e.layoutMeasurement.height > 0 && e.contentSize.height > 0 && e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 8) setViewed(key); }}>
          <Type variant="body" selectable style={{ lineHeight: 26 }}>{policy.text}</Type>
        </ScrollView>
        <Type variant="caption" style={styles.muted}>{ready ? "Agreement viewed. You can now accept it." : "Read to the end of the agreement to enable acceptance."}</Type>
        <Button label="Refresh terms" variant="quiet" onPress={() => void load()} />
      </> : <Pressable accessibilityRole="button" accessibilityLabel="Read Provider Terms and Conditions" onPress={() => setReading(true)} style={styles.read}>
        <View style={{ flex: 1, gap: 2 }}><Type variant="bodyStrong">Provider agreement</Type><Type variant="caption" style={styles.muted}>{ready ? "Agreement viewed" : "Read the full agreement to continue"}</Type></View>
        <Ionicons name={ready ? "checkmark-circle-outline" : "arrow-forward"} size={20} color={theme.color.kola["800"]} />
      </Pressable>}
      <Pressable accessibilityRole="checkbox" aria-disabled={!ready} aria-checked={checked} disabled={!ready} accessibilityLabel="I accept the Provider Terms and Conditions" onPress={() => onChange(checked ? null : { version: policy.version, digest: policy.digest })} style={[styles.check, !ready && { opacity: 0.5 }]}>
        <Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={theme.color.kola["800"]} /><Type variant="caption" style={{ flex: 1 }}>I accept the Provider Terms and Conditions.</Type>
      </Pressable>
      <Modal visible={reading} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setReading(false)}>
        <ModalSafeArea><AgreementReader key={key} onReload={() => { setReading(false); void load(); }} policy={policy} ready={ready} onViewed={() => setViewed(key)} onClose={() => setReading(false)} /></ModalSafeArea>
      </Modal>
    </> : !error ? <Type variant="caption">Loading provider agreement…</Type> : null}
    {error ? <><Type variant="caption" accessibilityRole="alert">{error}</Type><Button label="Try again" variant="quiet" onPress={() => void load()} /></> : null}
  </View>;
}

function AgreementReader({ policy, ready, onViewed, onClose, onReload }: { policy: Policy; ready: boolean; onViewed: () => void; onClose: () => void; onReload: () => void }) {
  const insets = useSafeAreaInsets();
  const sizes = useRef({ viewport: 0, content: 0 });
  function checkFit() { if (sizes.current.viewport > 0 && sizes.current.content > 0 && sizes.current.content <= sizes.current.viewport + 2) onViewed(); }
  return <View style={{ flex: 1, backgroundColor: theme.color.field["50"], paddingTop: safeHeaderTop(insets.top) }}>
    <View style={styles.readerHead}><View style={{ flex: 1, gap: 2 }}><Type variant="bodyStrong" accessibilityRole="header">Provider agreement</Type><Type variant="caption" style={styles.muted}>Version {policy.version}</Type></View><Pressable accessibilityRole="button" accessibilityLabel="Close agreement" onPress={onClose} style={styles.close}><Ionicons name="close" size={24} color={theme.color.ink["900"]} /></Pressable></View>
    <ScrollView accessibilityLabel="Provider agreement text" contentContainerStyle={{ padding: space[5] }} scrollEventThrottle={16}
      onLayout={(event) => { sizes.current.viewport = event.nativeEvent.layout.height; checkFit(); }}
      onContentSizeChange={(_, height) => { sizes.current.content = height; checkFit(); }}
      onScroll={({ nativeEvent: e }) => { if (e.contentSize.height > 0 && e.layoutMeasurement.height > 0 && e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 8) onViewed(); }}>
      <Type variant="body" selectable style={{ lineHeight: 27 }}>{policy.text}</Type>
    </ScrollView>
    <View style={[styles.readerFoot, { paddingBottom: Math.max(insets.bottom, space[4]) }]}><Type variant="caption" style={styles.muted}>{ready ? "You can now accept the agreement." : "Scroll to the end to enable acceptance."}</Type><Button label="Return to application" disabled={!ready} onPress={onClose} /><Button label="Refresh terms" variant="quiet" onPress={onReload} /></View>
  </View>;
}
const styles = StyleSheet.create({
  muted: { color: theme.color.ink["500"] },
  inlineReader: { borderWidth: 1, borderColor: theme.color.field["200"], borderRadius: 8, backgroundColor: theme.color.field["50"] },
  read: { flexDirection: "row", alignItems: "center", minHeight: 64, gap: space[3], borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.field["200"], paddingVertical: space[3] },
  check: { flexDirection: "row", alignItems: "center", minHeight: 48, gap: space[3] },
  readerHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: space[5], paddingVertical: space[3], borderBottomWidth: 1, borderColor: theme.color.field["200"] },
  close: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  readerFoot: { padding: space[5], gap: space[3], borderTopWidth: 1, borderColor: theme.color.field["200"] },
});
