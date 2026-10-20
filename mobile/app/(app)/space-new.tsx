/**
 * Adding a Unit, on a phone.
 *
 * Opens as a modal and walks the Unit, its amenities, its photographs and the
 * review in `UnitWizard`, the twin of the web wizard. A half-finished Unit
 * reopens here with `unitId` (and `step`), so "Continue setup" lands where it
 * was left.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { UnitWizard } from "@/components/property/UnitWizard";
import { Notice, space } from "@/components/ui";

export default function NewSpaceScreen() {
  const router = useRouter();
  const { propertyId, unitId, step } = useLocalSearchParams<{ propertyId: string; unitId?: string; step?: string }>();

  if (!propertyId) {
    return (
      <View style={{ padding: space[4] }}>
        <Notice tone="info" title="Choose a property first" />
      </View>
    );
  }

  return (
    <UnitWizard
      propertyId={propertyId}
      unitId={unitId || null}
      startAt={step ?? null}
      onClose={() =>
        router.canGoBack() ? router.back() : router.replace({ pathname: "/(app)/provider-property", params: { propertyId } })
      }
      onFinished={(unit) => router.replace({ pathname: "/(app)/space", params: { unitId: unit.id } })}
    />
  );
}
