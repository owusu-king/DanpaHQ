import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth";
import { Button, Notice, Type, space } from "@/components/ui";
import { theme } from "@/theme";

/** A waiting account keeps its own Home; operational screens never mount. */
export function VerificationHome({ side }: { side: "provider" | "artisan" }) {
  const { state, refreshMe, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  if (state.status !== "signed_in") return null;
  const status = side === "provider" ? state.me.capabilities.provider.verification_status : state.me.capabilities.artisan.status;
  const pending = status === "pending";
  const title = side === "provider" ? "Provider" : "Artisan";
  return <View style={{ flex: 1, backgroundColor: theme.color.field["50"], paddingTop: insets.top }}>
    <ScrollView contentContainerStyle={{ padding: space[6], gap: space[5], flexGrow: 1 }}>
      <Type variant="caption">{title} account</Type>
      <Ionicons name="shield-checkmark-outline" size={40} color={theme.color.kola["600"]} />
      <Type variant="display3">{pending ? "Your verification is under review" : "Complete your verification"}</Type>
      <Type variant="body">{pending ? "Our team is reviewing your details. We’ll notify you when there is an update. You can manage your profile while you wait." : "Review your verification details and any feedback from our team to continue."}</Type>
      {!pending ? <Button label="Review verification" onPress={() => router.push((side === "provider" ? "/(app)/provider" : "/(app)/artisan-application") as never)} /> : null}
      <Button variant="quiet" label="Refresh status" busy={refreshing} onPress={async () => {
        setRefreshing(true); setError("");
        try { await refreshMe(); } catch { setError("We couldn’t refresh your status. Please try again."); }
        finally { setRefreshing(false); }
      }} />
      {error ? <Notice tone="error" title={error} /> : null}
      <Button variant="secondary" label="Profile settings" onPress={() => router.push("/(app)/profile-edit")} />
      <Button variant="quiet" label="Sign out" onPress={() => void signOut()} />
    </ScrollView>
    <View accessibilityRole="tablist" style={{ flexDirection: "row", paddingVertical: space[3], paddingBottom: Math.max(insets.bottom, space[3]), backgroundColor: theme.color.field["0"] }}>
      {["Home", ...(side === "provider" ? ["Properties", "Tenants", "Finance"] : ["Requests", "Jobs"]), "Profile"].map(label => {
        const locked = label !== "Home" && label !== "Profile";
        return <Pressable key={label} accessibilityRole="tab" accessibilityLabel={locked ? `${label}, available after approval` : label} aria-disabled={locked} aria-selected={label === "Home"} disabled={locked} onPress={() => label === "Profile" && router.push("/(app)/profile-edit")} style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", gap: space[1] }}>
          <Ionicons name={locked ? "lock-closed-outline" : label === "Home" ? "home" : "person-circle-outline"} size={22} color={locked ? theme.color.ink["300"] : theme.color.kola["600"]} />
          <Type variant="caption" numberOfLines={1} style={{ fontSize: 10, color: locked ? theme.color.ink["500"] : theme.color.kola["600"] }}>{label}</Type>
        </Pressable>;
      })}
    </View>
  </View>;
}
