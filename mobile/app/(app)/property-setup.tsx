/**
 * Carrying on with a property's setup, on a phone.
 *
 * The same modal wizard as creating one, opened on the property that exists —
 * on the step a link names (`?step=amenities` from the property screen), or on
 * the first thing still outstanding. See `PropertyWizard`.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { PropertyWizard } from "@/components/property/PropertyWizard";
import { Notice, space } from "@/components/ui";

export default function PropertySetupScreen() {
  const router = useRouter();
  const { propertyId, step } = useLocalSearchParams<{ propertyId: string; step?: string }>();

  if (!propertyId) {
    return (
      <View style={{ padding: space[4] }}>
        <Notice tone="info" title="Choose a property first" />
      </View>
    );
  }

  const leave = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({ pathname: "/(app)/provider-property", params: { propertyId } });

  return (
    <PropertyWizard
      propertyId={propertyId}
      startAt={step ?? null}
      onClose={leave}
      onFinished={(id) => router.replace({ pathname: "/(app)/provider-property", params: { propertyId: id, created: "1" } })}
    />
  );
}
