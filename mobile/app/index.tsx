import { View } from "react-native";

import { Type, space } from "@/components/ui";

export default function Index() {
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: space[5] }}>
      <Type variant="body">Loading your account…</Type>
    </View>
  );
}
