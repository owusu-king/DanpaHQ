import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";

import { Button, Notice, Surface, Type, space } from "@/components/ui";
import { theme } from "@/theme";

export default function ProviderActionsScreen() {
  const router = useRouter();
  return (
    <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4] }}>
      <View style={{ gap: space[2] }}>
        <Type variant="label">QUICK ACTIONS</Type>
        <Type variant="display2">What do you want to do?</Type>
      </View>
      <Surface style={{ gap: space[3] }}>
        <Action icon="business-outline" label="Create property" onPress={() => router.push("/(app)/private-property" as never)} />
        <Action icon="add-circle-outline" label="Add a unit, room or bed" onPress={() => router.push("/(app)/unit-new" as never)} />
        <Action icon="person-add-outline" label="Review tenancy requests" onPress={() => router.push("/(app)/provider-applications" as never)} />
        <Action icon="document-text-outline" label="Create a listing draft" onPress={() => router.push("/(app)/(provider-tabs)/properties" as never)} />
        <Action icon="receipt-outline" label="Record an expense" onPress={() => router.push({ pathname: "/(app)/(provider-tabs)/payments", params: { action: "expense" } })} />
      </Surface>
      <Notice
        tone="info"
        title="Trust-sensitive actions may ask for verification"
        body="Private setup is immediate. Tenant access, leases, payment receiving and public advertising unlock only after their required checks."
      />
      <Button label="Close" variant="quiet" onPress={() => router.back()} />
    </ScrollView>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Button
      label={label}
      variant="secondary"
      icon={<Ionicons name={icon} size={22} color={theme.color.kola["600"]} />}
      onPress={onPress}
    />
  );
}
