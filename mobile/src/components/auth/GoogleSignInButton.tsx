import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { Type } from "@/components/ui";
import { getGoogleCredential, googleUnavailableReason } from "@/googleIdentity";
import { theme } from "@/theme";

export function GoogleSignInButton({ onCredential, disabled = false }: {
  onCredential: (credential: string) => Promise<void>; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const unavailable = googleUnavailableReason();
  async function press() {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true); setError("");
    try {
      const credential = await getGoogleCredential();
      if (credential && mounted.current) await onCredential(credential);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not continue with Google.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Continue with Google"
      aria-disabled={disabled || busy || Boolean(unavailable)} aria-busy={busy}
      disabled={disabled || busy || Boolean(unavailable)} onPress={() => void press()}
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: theme.color.field["100"] }, (busy || disabled || unavailable) && { opacity: .65 }]}>
      {busy ? <ActivityIndicator size="small" color={theme.color.kola["600"]} /> : <Svg width={20} height={20} viewBox="0 0 48 48" accessibilityElementsHidden>
        <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </Svg>}
      <Type variant="bodyStrong">{busy ? "Connecting…" : "Continue with Google"}</Type>
    </Pressable>
    {error || unavailable ? <Type variant="caption" accessibilityLiveRegion="polite">{error || unavailable}</Type> : null}
  </View>;
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12, minHeight: 48,
    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.color.field["0"], borderWidth: 1,
    borderColor: theme.color.field["200"], borderRadius: 12 },
});
