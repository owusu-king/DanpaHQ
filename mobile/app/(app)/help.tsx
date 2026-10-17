import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";

import { Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { theme } from "@/theme";

const GUIDES = {
  services: {
    title: "Help with Services",
    introduction: "Your household accounts and purchases, in one place.",
    items: [
      { icon: "grid-outline", title: "Find a service", detail: "Browse by household need, then open a service to see what Danpa HQ can do for it today." },
      { icon: "bookmark-outline", title: "Save account details", detail: "A service being prepared may let you save its meter, decoder or account number for later." },
      { icon: "time-outline", title: "Not available yet", detail: "A service marked for later cannot take a payment. Danpa HQ will show when it is ready." },
    ],
  },
  payments: {
    title: "Help with Payments",
    introduction: "Understand what is due and keep a clear record of what you paid.",
    items: [
      { icon: "calendar-outline", title: "Rent due", detail: "Due now shows outstanding items from your rent accounts. Open an item to review its amount and due date before paying." },
      { icon: "shield-checkmark-outline", title: "Payment in progress", detail: "Wait for the payment status to be confirmed before retrying. Confirmed payments and receipts stay in History." },
      { icon: "cash-outline", title: "Paid outside Danpa HQ", detail: "If your provider records cash or a direct transfer, Payments lets you confirm or dispute that external record." },
    ],
  },
} as const;

export default function HelpScreen() {
  const pageBottom = useSafeBottom(space[12]);
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const guide = topic === "payments" ? GUIDES.payments : GUIDES.services;

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[6] }}>
      <View style={{ gap: space[2], paddingLeft: space[3], borderLeftWidth: 2, borderLeftColor: theme.color.kola["600"] }}>
        <Type variant="label" style={{ color: theme.color.kola["600"] }}>DANPA HQ GUIDE</Type>
        <Type variant="title1" accessibilityRole="header">{guide.title}</Type>
        <Type variant="body" style={{ color: theme.color.ink["700"] }}>{guide.introduction}</Type>
      </View>
      <View style={{ borderTopWidth: 1, borderColor: theme.color.field["200"] }}>
        {guide.items.map((item) => (
          <View key={item.title} style={{ flexDirection: "row", gap: space[3], paddingVertical: space[4], borderBottomWidth: 1, borderColor: theme.color.field["200"] }}>
            <Ionicons name={item.icon} size={19} color={theme.color.kola["600"]} />
            <View style={{ flex: 1, gap: space[1] }}>
              <Type variant="bodyStrong">{item.title}</Type>
              <Type variant="caption" style={{ color: theme.color.ink["700"] }}>{item.detail}</Type>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
