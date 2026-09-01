import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Field, Notice, Surface, Type, space } from "@/components/ui";
import { createOrganization, type Organization } from "@/organizations";
import { resolveEntryRoute } from "@/navigation";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

const TYPES: {
  value: Organization["organization_type"];
  title: string;
  body: string;
}[] = [
  { value: "individual_owner", title: "I own property", body: "For an individual landlord or family portfolio." },
  { value: "property_company", title: "Property company", body: "For a company that owns residential properties." },
  { value: "property_manager", title: "Professional management", body: "For managing properties on behalf of one or more owners." },
  { value: "hostel_operator", title: "Student hostel", body: "For rooms, beds and student occupancy." },
];

export default function OrganizationSetupScreen() {
  const router = useRouter();
  const { state, refreshMe, activeContext } = useAuth();
  const [name, setName] = useState("");
  const [type, setType] = useState<Organization["organization_type"]>("property_company");
  const [activities, setActivities] = useState<Organization["activities"]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canSetUpPortfolio = state.status === "signed_in"
    && state.me.capabilities.active_workspace === "provider"
    && state.me.capabilities.provider.can_create_property;

  useEffect(() => {
    if (state.status === "signed_in" && !canSetUpPortfolio) {
      router.replace(resolveEntryRoute(state.me, activeContext) as never);
    }
  }, [activeContext, canSetUpPortfolio, router, state]);

  if (!canSetUpPortfolio) {
    return (
      <View style={{ flex: 1, padding: space[5] }}>
        <Type variant="caption">Opening the right experience…</Type>
      </View>
    );
  }

  function toggleActivity(activity: Organization["activities"][number]) {
  setActivities((current) =>
    current.includes(activity)
      ? current.filter((item) => item !== activity)
      : [...current, activity]
  );
}


  async function submit() {
    setBusy(true);
    setError("");
    try {
      const organization = await createOrganization({
        name: name.trim(),
        organization_type: type,
        activities,
      });
      await refreshMe(`organization:${organization.id}`);
      router.replace("/(app)/(provider-tabs)" as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not create the Portfolio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], gap: space[5] }}>
      <View style={{ gap: space[2] }}>
        <Type variant="label">PORTFOLIO SETUP</Type>
        <Type variant="display2">Set up a property business</Type>
        <Type variant="body">Use this for a company, hostel operation, professional manager, or Team. Individual owners can create their first Property directly and Rooomly creates a personal Portfolio.</Type>
      </View>
      <Field label="Portfolio name" hint="For example: Ama Properties" value={name} onChangeText={setName} />
      <View style={{ gap: space[2] }}>
        {TYPES.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => setType(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: type === option.value }}
            {...pressableFeedback(theme.color.kola["50"])}
          >
            <Surface style={{ borderWidth: type === option.value ? 2 : 1, borderColor: type === option.value ? theme.color.kola["600"] : theme.color.field["200"] }}>
              <Type variant="bodyStrong">{option.title}</Type>
              <Type variant="caption">{option.body}</Type>
            </Surface>
          </Pressable>
        ))}
      </View>
      <View style={{ gap: space[2] }}>
        <Type variant="bodyStrong">Property activities</Type>
        {(["residential", "commercial", "hostel"] as const).map((activity) => {
          const selected = activities.includes(activity);

          return (
            
            <Button
              key={activity}
              label={`${selected ? "✓ " : ""}${
                activity === "residential"
                  ? "Residential property"
                  : activity === "commercial"
                    ? "Commercial property"
                    : "Student hostel"
              }`}
              variant="secondary"
              onPress={() => toggleActivity(activity)}
            />
          );
        })}
      </View>
      {error ? <Notice tone="error" title={error} /> : null}
      <Button label="Create Portfolio" onPress={submit} busy={busy} disabled={!name.trim() || activities.length === 0} />
      <Button
        label="Not now"
        variant="quiet"
        onPress={() => router.back()}
      />
    </ScrollView>
  );
}
