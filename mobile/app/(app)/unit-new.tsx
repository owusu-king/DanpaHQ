import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import Ionicons from "@expo/vector-icons/Ionicons";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { listOrganizationProperties, listOrganizations, type ManagedProperty } from "@/organizations";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * The one step a Unit needs before the existing flow can start: which Property.
 *
 * Coming from a Property this screen never appears — the Property is known.
 * Nothing is created here; it chooses, then hands over to `space-new`.
 */
export default function AddUnitScreen() {
  const router = useRouter();
  const { activeContext } = useAuth();
  const [properties, setProperties] = useState<ManagedProperty[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const organizations = await listOrganizations();
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const organization = organizations.find((row) => row.id === preferred) ?? organizations[0];
      setProperties(organization ? await listOrganizationProperties(organization.id) : []);
      setError("");
    } catch (cause) {
      setProperties([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your Properties.");
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Only Properties this person may actually add a Unit to. The backend refuses
  // the rest anyway; offering them would be a menu of dead ends.
  const eligible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (properties ?? [])
      .filter((property) => property.capabilities?.private_inventory?.allowed)
      .filter((property) => !needle || property.title.toLocaleLowerCase("en-GH").includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title, "en-GH"));
  }, [properties, query]);

  return (
    <FlatList
      data={eligible}
      keyExtractor={(property) => property.id}
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12] }}
      ListHeaderComponent={
        <View style={{ gap: space[3], marginBottom: space[2] }}>
          <View style={{ gap: space[1] }}>
            <Type variant="label">ADD UNIT</Type>
            <Type variant="display2" accessibilityRole="header">Choose a Property</Type>
          </View>
          {error ? <Notice tone="error" title={error} /> : null}
          {(properties?.length ?? 0) > 6 ? (
            <Field label="Search Properties" value={query} onChangeText={setQuery} returnKeyType="search" />
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${item.title}. ${item.unit_count} ${item.unit_count === 1 ? "Unit" : "Units"}.`}
          onPress={() => router.push({ pathname: "/(app)/space-new", params: { propertyId: item.id } } as never)}
          {...pressableFeedback(theme.color.field["200"])}
          style={({ pressed }) => ({
            minHeight: 72,
            paddingVertical: space[3],
            borderBottomWidth: 1,
            borderBottomColor: theme.color.field["200"],
            flexDirection: "row",
            alignItems: "center",
            gap: space[3],
            opacity: pressed ? 0.82 : 1,
          })}
        >
          <View style={{ flex: 1, minWidth: 0, gap: space[1] }}>
            <Type variant="bodyStrong">{item.title}</Type>
            <Type variant="caption">
              {item.unit_count} {item.unit_count === 1 ? "Unit" : "Units"}
            </Type>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.color.ink["300"]} />
        </Pressable>
      )}
      ListEmptyComponent={
        properties === null && !error ? (
          <Type variant="caption">Loading…</Type>
        ) : (
          <View style={{ paddingVertical: space[8], gap: space[3] }}>
            <Type variant="bodyStrong">
              {query ? "No matching Property" : "No Property can take a Unit yet"}
            </Type>
            <Type variant="caption">
              {query
                ? "Try another name."
                : "A Property has to be confirmed as yours to let before you can add Units to it."}
            </Type>
            <Button
              label="Open Properties"
              variant="secondary"
              onPress={() => router.push("/(app)/(provider-tabs)/properties" as never)}
            />
          </View>
        )
      }
    />
  );
}
