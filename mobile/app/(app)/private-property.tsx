/**
 * Creating a property, on a phone.
 *
 * Opens as a modal (owner, 2026-10-20: creation in a modal, like agreement
 * creation) and walks the whole journey in it — the property, its details,
 * documents, amenities, photos and review — through `PropertyWizard`, the twin
 * of the web wizard. The route name is kept so every "Create property" link in
 * the app still lands here.
 */

import { useLocalSearchParams, useRouter } from "expo-router";

import { PropertyWizard } from "@/components/property/PropertyWizard";

export default function PrivatePropertyScreen() {
  const router = useRouter();
  const { organizationId, purpose } = useLocalSearchParams<{ organizationId?: string; purpose?: string }>();

  return (
    <PropertyWizard
      purpose={purpose === "sale" ? "sale" : "letting"}
      organizationId={organizationId || null}
      onClose={() => (router.canGoBack() ? router.back() : router.replace("/(app)/(provider-tabs)/properties" as never))}
      onFinished={(propertyId) =>
        router.replace({ pathname: "/(app)/provider-property", params: { propertyId, created: "1" } })
      }
    />
  );
}
