import { ScrollView, View } from "react-native";
import { Type, Button, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";

/** Stable entry point reserved for the electronic Ghana Card integration. */
export default function IdentityVerificationScreen() {
  const bottom = useSafeBottom(space[8]);
  return <ScrollView contentContainerStyle={{ paddingBottom: bottom }}><View style={{ padding: space[5], gap: space[4] }}>
    <Type variant="title1">Biometric Identity Verification — Coming Soon</Type>
    <Type variant="body">Electronic Ghana Card verification will be available here once the integration is ready.</Type>
    <Button label="Verify · Coming soon" disabled onPress={() => {}} />
  </View></ScrollView>;
}
