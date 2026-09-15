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
import { useBlankOnPortfolioSwitch } from "@/portfolioScope";
import { theme } from "@/theme";

export default function ProviderPropertiesScreen() {
  const router = useRouter();
  const { state, activeContext } = useAuth();
  const me = state.status === "signed_in" ? state.me : null;
  const provider = me?.capabilities.provider ?? null;
  // Two ways to be allowed: an approved provider adding to anything of theirs,
  // or a Portfolio administrator adding to the Portfolio that invited them —
  // which its standing and their identity check decide, on the backend.
  const portfolioAccess = me?.contexts.find(
    (row) => row.type === "organization" && row.id === activeContext,
  )?.access ?? me?.contexts.find((row) => row.type === "organization")?.access ?? null;
  const canCreateProperty =
    (provider?.can_create_property ?? false) || Boolean(portfolioAccess?.can.create_properties);
  // A role whose reach is decided by assignment has a different empty state
  // from an owner's: there is nothing for them to add, and somebody else
  // decides which Properties they see.
  const assignedOnly = portfolioAccess ? portfolioAccess.scope !== "portfolio_wide" : false;
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // A switch takes the Portfolio being left off the screen with it, name and
  // count included. Returning to this tab is not a switch, so what is already
  // here stays while it refreshes.
  useBlankOnPortfolioSwitch(activeContext, () => {
    setProperties([]);
    setOrganizationId("");
    setLoading(true);
  });

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

  const currentPortfolio = organizations.find((organization) => organization.id === organizationId);
  // The header names the tab and the Portfolio; this says how many. Never a count
  // before the Portfolio is resolved: until then there is nothing to say except
  // that we are finding out.
  const caption = currentPortfolio
    ? `${properties.length} ${properties.length === 1 ? "Property" : "Properties"}`
    : loading
      ? "Loading your Portfolio…"
      : "Your Portfolio";

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12] }}>
      <View style={{ paddingBottom: space[5] }}>
        <Type variant="caption">{caption}</Type>
      </View>

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
          <Type variant="bodyStrong">
            {assignedOnly ? "No Property is assigned to you" : "No Properties yet"}
          </Type>
          <Type variant="caption" style={{ textAlign: "center" }}>
            {assignedOnly
              ? `An owner or administrator of ${currentPortfolio?.name ?? "this Portfolio"} decides which Properties you operate. The ones assigned to you appear here.`
              : "Add the first Property in this Portfolio."}
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
