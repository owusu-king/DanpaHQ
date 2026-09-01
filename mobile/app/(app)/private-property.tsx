/**
 * Step one of creating a property: what to call it, what kind it is, and where.
 *
 * **Not a "create" action with its own button.** It is the first step of one
 * journey that ends, five steps later, in `property-setup` with *Create
 * property*. The record is written here because documents and photographs need
 * something to attach to — an implementation detail the provider should never
 * feel.
 *
 * On mobile the compact checkpoint journey is enough context. The full numbered
 * checklist remains a web pattern; stacking it above the form consumed the
 * small screen before the provider could reach the work.
 */

import { useLocalSearchParams, useRouter } from "expo-router";

import {
  loadPropertyTypes,
  type PropertyTypeOption,
} from "@/propertyTypes";
import { PropertyTypeChoice } from "@/components/property/PropertyTypeChoice";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Choice, Field, Notice, Type, space } from "@/components/ui";
import type { Locality } from "@/listings";
import {
  createPersonalPortfolioProperty,
  createPrivateProperty,
  listOrganizations,
  type Organization,
} from "@/organizations";
import { SetupProgress } from "@/components/property/SetupSteps";
import { describePropertySetup, type SetupStep } from "@/propertySetup";
import { createAddress, searchProviderLocalities } from "@/provider";
import { theme } from "@/theme";

/** The whole journey, before any of it exists. */
const OUTLINE: SetupStep[] = describePropertySetup({
  name: "",
  waterSource: "unknown",
  powerMeterType: "unknown",
  documentState: "draft",
  photos: null,
  amenityCount: null,
}).map((step) => (step.key === "basics" ? { ...step, status: "todo" as const } : step));

export default function PrivatePropertyScreen() {
  const router = useRouter();
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const { activeContext } = useAuth();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(organizationId ?? "");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [title, setTitle] = useState("");
  // No default. There is no sensible one — a hostel is not a residential
  // property with extra rooms — and this decides what may be let inside.
  const [propertyType, setPropertyType] = useState("");
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[]>([]);
  const [localityQuery, setLocalityQuery] = useState("");
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [locality, setLocality] = useState<Locality | null>(null);
  const [digitalAddress, setDigitalAddress] = useState("");
  const [street, setStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Fetched, so the form cannot offer a category the backend does not have.
    void loadPropertyTypes().then(setPropertyTypes).catch(() => setPropertyTypes([]));
  }, []);

  useEffect(() => {
    // Fetched even when a workspace was named. The parameter says which one to
    // preselect, not that there is only one — returning early here left
    // `organizations` empty, so the picker could never appear and somebody who
    // arrived from the wrong workspace had no way to change it.
    void listOrganizations().then((rows) => {
      setOrganizations(rows);
      if (organizationId) {
        setSelectedOrganizationId(organizationId);
        return;
      }
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      // Preselect the one they are already working in, and otherwise the only
      // one they have. With several and no context, nothing is chosen for them:
      // silently filing a property under the first workspace in a list is a
      // wrong answer that nobody sees until much later.
      setSelectedOrganizationId(
        rows.find((row) => row.id === preferred)?.id ?? (rows.length === 1 ? rows[0]!.id : ""),
      );
    }).catch(() => setError("Could not load your Portfolios."));
  }, [activeContext, organizationId]);

  useEffect(() => {
    if (locality || localityQuery.trim().length < 2) return;
    const timer = setTimeout(() => {
      void searchProviderLocalities(localityQuery.trim()).then(setLocalities).catch(() => setLocalities([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [locality, localityQuery]);

  async function submit() {
    if (!locality || (organizations.length > 0 && !selectedOrganizationId)) return;
    setBusy(true);
    setError("");
    try {
      const address = await createAddress({
        locality_id: locality.id,
        digital_address: digitalAddress || undefined,
        street: street || undefined,
        landmark: landmark || undefined,
      });
      const input = {
        title: title.trim(),
        property_type: propertyType,
        address_id: address.id,
      };
      const property = selectedOrganizationId
        ? await createPrivateProperty(selectedOrganizationId, input)
        : await createPersonalPortfolioProperty(input);
      // Straight on to step two. This screen is the first step of one journey,
      // not a create action of its own — it used to say "Create private
      // property" and hand over to a differently shaped flow that ended with a
      // second button also called Create property.
      router.replace({
        pathname: "/(app)/property-setup",
        params: { propertyId: property.id, step: "details" },
      });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not start this property.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4] }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space[2] }}>
        <Type variant="label">PRIVATE BY DEFAULT</Type>
        <Type variant="display2">Create a property</Type>
        <Type variant="body">
          Everything saves as you go. Do them in any order.</Type>
      </View>

      <SetupProgress steps={OUTLINE} current="basics" />
      {organizations.length > 1 ? (
        <Choice
          label="Which Portfolio?"
          hint="The property is filed under this one."
          value={selectedOrganizationId}
          options={organizations.map((row) => ({ value: row.id, label: row.name }))}
          onChange={setSelectedOrganizationId}
        />
      ) : null}
      {organizations.length === 0 ? (
        <Notice
          tone="info"
          title="Your personal Portfolio starts here"
          />
      ) : null}
      <Field label="Property name" hint="An internal name, such as Adom Heights" value={title} onChangeText={setTitle} />
      {/* Three categories, and the choice decides what may be let inside.
          `Choice` is a wrapping row of labels — right for a water source, and
          unable to say what choosing Hostel actually gets you.

          Activities describe a Portfolio's current focus. The backend's
          complete vocabulary remains selectable, and creating another valid
          category adds that activity to the Portfolio. */}
      <PropertyTypeChoice types={propertyTypes} value={propertyType} onChange={setPropertyType} />
      <Field label="Town or neighbourhood" value={localityQuery} onChangeText={(value) => { setLocalityQuery(value); setLocality(null); }} />
      {localities.map((item) => (
        <Pressable key={item.id} onPress={() => { setLocality(item); setLocalityQuery(item.name); setLocalities([]); }} style={{ minHeight: theme.targetMin, justifyContent: "center" }}>
          <Type variant="body">{item.name} · {item.district_name}</Type>
        </Pressable>
      ))}
      <Field label="GhanaPost GPS (where available)" value={digitalAddress} onChangeText={setDigitalAddress} autoCapitalize="characters" />
      <Field label="Street" value={street} onChangeText={setStreet} />
      <Field label="Landmark" value={landmark} onChangeText={setLandmark} />
      {error ? <Notice tone="error" title={error} /> : null}
      {/* `propertyType` is in the condition because the backend requires it and
          there is no default — submitting without it produced a refusal the
          form could have prevented. */}
      <Button
        label="Save and continue"
        onPress={submit}
        busy={busy}
        disabled={(organizations.length > 0 && !selectedOrganizationId) || !title.trim() || !propertyType || !locality}
      />
    </ScrollView>
  );
}
