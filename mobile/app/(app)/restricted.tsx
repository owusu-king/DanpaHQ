import { View } from "react-native";

import { Notice, Type, space } from "@/components/ui";

export default function RestrictedScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: space[5], gap: space[4] }}>
      <Type variant="display2">Account access is limited</Type>
      <Notice
        tone="warning"
        title="You cannot use the workspace right now"
        body="Your account is signed in, but access is restricted. Contact support before trying again."
      />
    </View>
  );
}
