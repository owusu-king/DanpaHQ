import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Bone } from "@/components/billing/BillingParts";
import { Fact, LinkRow, RecordPanel } from "@/components/record/RecordSurfaces";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Field, Notice, space } from "@/components/ui";
import { listOrganizationProperties, listOrganizations, type ManagedProperty } from "@/organizations";

/** Above this many, finding the right Property is a task of its own. */
const SEARCHABLE_FROM = 6;

/**
 * "Add Unit" from outside a Property: a sheet to choose which Property, then
 * the creation flow that already exists (owner, 2026-10-05: a whole screen
 * for one choice was too much). The twin of the web `AddUnitChooser`.
 *
 * One eligible Property is not a choice, so `start` goes straight to the flow.
 */
export function useAddUnit() {
  const router = useRouter();
  const choices = usePropertyChoices();
  const [open, setOpen] = useState(false);

  const start = useCallback(async () => {
    const eligible = await choices.load();
    if (eligible.length === 1) {
      router.push({ pathname: "/(app)/space-new", params: { propertyId: eligible[0]!.id } } as never);
      return;
    }
    setOpen(true);
  }, [choices, router]);

  const sheet = (
    <BottomSheet visible={open} onClose={() => setOpen(false)} title="Add Unit" closeLabel="Close Add Unit">
      <PropertyChoices choices={choices} onChosen={() => setOpen(false)} />
    </BottomSheet>
  );
  return { start, sheet };
}

type Choices = ReturnType<typeof usePropertyChoices>;

/** The Properties a Unit may be added to, loaded on demand. */
export function usePropertyChoices() {
  const { activeContext } = useAuth();
  const [properties, setProperties] = useState<ManagedProperty[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<ManagedProperty[]> => {
    try {
      const organizations = await listOrganizations();
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const organization = organizations.find((row) => row.id === preferred) ?? organizations[0];
      const rows = organization ? await listOrganizationProperties(organization.id) : [];
      setProperties(rows);
      setError("");
      return eligibleOf(rows);
    } catch (cause) {
      setProperties([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your Properties.");
      return [];
    }
  }, [activeContext]);

  return useMemo(() => ({ properties, error, load }), [properties, error, load]);
}

/**
 * Only Properties this person may actually add a Unit to — confirmed as theirs
 * to let, and not for sale (a sale is sold whole and takes no Units). The
 * backend refuses the rest; offering them would be a menu of dead ends.
 */
function eligibleOf(properties: ManagedProperty[]) {
  return properties
    .filter((property) => property.capabilities?.private_inventory?.allowed)
    .filter((property) => property.purpose !== "sale")
    .sort((a, b) => a.title.localeCompare(b.title, "en-GH"));
}

export function PropertyChoices({ choices, onChosen }: { choices: Choices; onChosen?: () => void }) {
  const router = useRouter();
  const { properties, error } = choices;
  const [query, setQuery] = useState("");

  const all = useMemo(() => eligibleOf(properties ?? []), [properties]);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return all.filter((property) => !needle || property.title.toLocaleLowerCase("en-GH").includes(needle));
  }, [all, query]);

  if (error) return <Notice tone="error" title={error} />;
  if (properties === null) {
    return (
      <View style={styles.list}>
        <Bone height={56} />
        <Bone height={56} />
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {all.length > SEARCHABLE_FROM ? (
        <Field label="Search" placeholder="Property name" value={query} onChangeText={setQuery} returnKeyType="search" />
      ) : null}
      {shown.length ? (
        <RecordPanel>
          {shown.map((item, index) => (
            <LinkRow
              key={item.id}
              first={index === 0}
              icon="business-outline"
              tone={item.vacant_unit_count ? "quiet" : "good"}
              label={item.title}
              detail={item.unit_count
                ? `${item.unit_count} ${item.unit_count === 1 ? "Unit" : "Units"} · ${item.occupied_unit_count} let`
                : "No Units yet"}
              onPress={() => {
                onChosen?.();
                router.push({ pathname: "/(app)/space-new", params: { propertyId: item.id } } as never);
              }}
            />
          ))}
        </RecordPanel>
      ) : (
        <RecordPanel>
          <Fact
            wide
            first
            label={query ? "No matching Property" : "Nothing can take a Unit yet"}
            value={query ? "Try another name." : "Confirm a Property as yours to let first."}
          />
        </RecordPanel>
      )}
      {!query && !all.length ? (
        <RecordPanel>
          <LinkRow
            first
            icon="albums-outline"
            tone="action"
            label="Open Properties"
            onPress={() => {
              onChosen?.();
              router.push("/(app)/(provider-tabs)/properties" as never);
            }}
          />
        </RecordPanel>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: space[3],
  },
});
