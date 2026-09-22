import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Bone } from "@/components/billing/BillingParts";
import {
  Fact,
  Footnote,
  GroupLabel,
  INK,
  KOLA,
  LinkRow,
  RecordPanel,
} from "@/components/record/RecordSurfaces";
import { Field, Notice, Type, space } from "@/components/ui";
import { listOrganizationProperties, listOrganizations, type ManagedProperty } from "@/organizations";
import { useSafeBottom } from "@/platform";

/** Above this many, finding the right Property is a task of its own. */
const SEARCHABLE_FROM = 6;

/**
 * The one step a Unit needs before the existing flow can start: which Property.
 *
 * Coming from a Property this screen never appears — the Property is known.
 * Nothing is created here; it chooses, then hands over to `space-new`.
 *
 * Refined on review (2026-09-22). It was a display heading over a list of
 * hairline rows; a choice this short should read as one panel, with each row
 * saying how full the building already is — which is what decides where the
 * next Unit goes.
 */
export default function AddUnitScreen() {
  const pageBottom = useSafeBottom(space[8]);
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
      contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={styles.head}>
          <View style={styles.title}>
            <Type variant="label" style={styles.eyebrow}>NEW UNIT</Type>
            <Type variant="title2" accessibilityRole="header" style={styles.heading}>Which Property?</Type>
          </View>
          {error ? <Notice tone="error" title={error} /> : null}
          {(properties?.length ?? 0) > SEARCHABLE_FROM ? (
            <Field label="Search" placeholder="Property name" value={query} onChangeText={setQuery} returnKeyType="search" />
          ) : null}
          {eligible.length ? <GroupLabel>Can take a Unit</GroupLabel> : null}
        </View>
      }
      renderItem={({ item, index }) => (
        <RecordPanel style={index === 0 ? null : styles.stacked}>
          <LinkRow
            first
            icon="business-outline"
            tone={item.vacant_unit_count ? "quiet" : "good"}
            label={item.title}
            detail={item.unit_count
              ? `${item.unit_count} ${item.unit_count === 1 ? "Unit" : "Units"} · ${item.occupied_unit_count} let`
              : "No Units yet"}
            onPress={() => router.push({ pathname: "/(app)/space-new", params: { propertyId: item.id } } as never)}
          />
        </RecordPanel>
      )}
      ListEmptyComponent={
        properties === null && !error ? (
          <View style={{ gap: space[3] }}>
            <Bone height={64} />
            <Bone height={64} />
            <Bone height={64} />
          </View>
        ) : (
          <View style={{ gap: space[3] }}>
            <RecordPanel>
              <Fact
                wide
                first
                label={query ? "No matching Property" : "Nothing can take a Unit yet"}
                value={query
                  ? "Try another name."
                  : "A Property has to be confirmed as yours to let before Units can go inside it."}
              />
            </RecordPanel>
            {query ? null : (
              <RecordPanel>
                <LinkRow
                  first
                  icon="albums-outline"
                  tone="action"
                  label="Open Properties"
                  detail="Finish a Property's checks first"
                  onPress={() => router.push("/(app)/(provider-tabs)/properties" as never)}
                />
              </RecordPanel>
            )}
          </View>
        )
      }
      ListFooterComponent={
        eligible.length ? <Footnote>A Unit takes its address and its checks from the Property it sits in.</Footnote> : null
      }
    />
  );
}

const styles = StyleSheet.create({
  page: {
    padding: space[4],
    gap: space[3],
  },
  head: {
    gap: space[3],
  },
  title: {
    gap: space[1],
    paddingHorizontal: 2,
  },
  eyebrow: {
    color: KOLA,
  },
  heading: {
    fontSize: 19,
    lineHeight: 25,
    color: INK,
  },
  stacked: {
    marginTop: space[2],
  },
});
