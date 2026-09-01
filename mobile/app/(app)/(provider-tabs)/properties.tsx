import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Notice, Type, space } from "@/components/ui";
import { LoadingRows, StatusLine, propertyStatus } from "@/components/property/WorkspacePatterns";
import {
  listOrganizationProperties,
  listOrganizations,
  type ManagedProperty,
  type Organization,
} from "@/organizations";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

export default function ProviderPropertiesScreen() {
  const router = useRouter();
  const { state, activeContext } = useAuth();
  const provider = state.status === "signed_in" ? state.me.capabilities.provider : null;
  const canCreateProperty = provider?.can_create_property ?? false;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [choosingPortfolio, setChoosingPortfolio] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const orgs = await listOrganizations();
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const selected = orgs.find((organization) => organization.id === preferred)?.id ?? orgs[0]?.id ?? "";
      setOrganizations(orgs);
      setOrganizationId(selected);
      setProperties(selected ? await listOrganizationProperties(selected) : []);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load Properties.");
    } finally {
      setLoading(false);
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function chooseOrganization(id: string) {
    setLoading(true);
    try {
      setOrganizationId(id);
      setProperties(await listOrganizationProperties(id));
      setChoosingPortfolio(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not switch Portfolio.");
    } finally {
      setLoading(false);
    }
  }

  const currentPortfolio = organizations.find((organization) => organization.id === organizationId);

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12] }}>
      <View style={{ gap: space[2], paddingBottom: space[5] }}>
        <Type variant="title1">Properties</Type>
        <Type variant="caption">
          {currentPortfolio?.name ?? "Your Portfolio"} · {properties.length} {properties.length === 1 ? "Property" : "Properties"}
        </Type>
        {organizations.length > 1 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: choosingPortfolio }}
            onPress={() => setChoosingPortfolio((value) => !value)}
            style={{ minHeight: 48, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space[2] }}
            {...pressableFeedback(theme.color.field["200"])}
          >
            <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>Switch Portfolio</Type>
            <Ionicons name={choosingPortfolio ? "chevron-up" : "chevron-down"} size={18} color={theme.color.kola["600"]} />
          </Pressable>
        ) : null}
      </View>

      {choosingPortfolio ? (
        <View style={{ marginBottom: space[5], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}>
          {organizations.map((organization) => (
            <Pressable
              key={organization.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: organization.id === organizationId }}
              onPress={() => void chooseOrganization(organization.id)}
              style={{ minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}
              {...pressableFeedback(theme.color.field["200"])}
            >
              <Type variant="bodyStrong">{organization.name}</Type>
              {organization.id === organizationId ? <Ionicons name="checkmark" size={20} color={theme.color.kola["600"]} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {provider && !canCreateProperty ? (
        <Notice tone="info" title="Property creation is not available yet" body="You can review this Portfolio while your provider verification is in progress." />
      ) : null}
      {error ? <Notice tone="error" title={error} body="Pull down or return to this tab to try again." /> : null}

      {canCreateProperty ? (
        <View style={{ marginVertical: space[4] }}>
          <Button label="Add Property" onPress={() => router.push({ pathname: "/(app)/private-property", params: { organizationId } })} />
        </View>
      ) : null}

      {loading ? <LoadingRows rows={4} /> : null}
      {!loading && properties.length === 0 ? (
        <View style={{ paddingVertical: space[10], gap: space[3], alignItems: "center" }}>
          <Type variant="bodyStrong">No Properties yet</Type>
          <Type variant="caption" style={{ textAlign: "center" }}>
            Add the first Property in this Portfolio. A personal Portfolio is created automatically when needed.
          </Type>
        </View>
      ) : null}

      {!loading ? (
        <View accessibilityRole="list" style={{ borderTopWidth: properties.length ? 1 : 0, borderTopColor: theme.color.field["200"] }}>
          {properties.map((property) => (
            <PropertyRow
              key={property.id}
              property={property}
              onOpen={() => router.push({ pathname: "/(app)/provider-property", params: { propertyId: property.id } })}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function PropertyRow({ property, onOpen }: { property: ManagedProperty; onOpen: () => void }) {
  const status = propertyStatus(property.verification);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${property.title}. ${status.label}. ${property.unit_count} Units.`}
      onPress={onOpen}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 92,
        paddingVertical: space[4],
        borderBottomWidth: 1,
        borderBottomColor: theme.color.field["200"],
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        opacity: pressed ? 0.82 : 1,
      })}
    >
      <View
        style={{
          width: 64,
          height: 52,
          borderRadius: 8,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.color.field["100"],
        }}
      >
        {property.cover_url ? (
          <Image
            source={{ uri: property.cover_url }}
            accessible={false}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        ) : (
          <Ionicons name="business-outline" size={20} color={theme.color.ink["300"]} />
        )}
      </View>
      <View style={{ flex: 1, gap: space[1] }}>
        <Type variant="bodyStrong">{property.title || "Untitled Property"}</Type>
        <Type variant="caption">{property.address.locality_name}, {property.address.district_name}</Type>
        <StatusLine label={status.label} tone={status.tone} />
      </View>
      <View style={{ alignItems: "flex-end", gap: space[1] }}>
        <Type variant="caption" style={{ color: theme.color.ink["700"], fontWeight: "600" }}>{property.unit_count} {property.unit_count === 1 ? "Unit" : "Units"}</Type>
        {property.unit_count ? <Type variant="caption">{property.occupied_unit_count} occupied</Type> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.color.ink["300"]} />
    </Pressable>
  );
}
