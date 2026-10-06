/**
 * Step one of creating a property: what to call it, what kind it is, and where.
 *
 * **Not a "create" action with its own button.** It is the first step of one
 * journey that ends, five steps later, in `property-setup` with *Create
 * property*. The record is written here because documents and photographs need
 * something to attach to — an implementation detail the provider should never
 * feel.
 *
 * Refined on review (2026-09-22). It was a flat stack of six fields, each with
 * a sentence of hint under it, under a display heading and a paragraph — more
 * words than inputs. The work is now two groups, *what it is* and *where it
 * is*; an example belongs in the box as a placeholder rather than in a line
 * beneath it; and the one act is pinned where a thumb is instead of sitting at
 * the end of a scroll.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import {
  ActionBar,
  EDGE,
  Footnote,
  GroupLabel,
  INK,
  KOLA,
  MUTED,
  PRESSED,
  Pill,
  RecordPanel,
} from "@/components/record/RecordSurfaces";
import { PropertyTypeChoice } from "@/components/property/PropertyTypeChoice";
import { PurposeChoice, SaleTypeChoice } from "@/components/property/PurposeChoice";
import { SetupProgress } from "@/components/property/SetupSteps";
import { Select } from "@/components/form/Select";
import { Field, Notice, Type, space } from "@/components/ui";
import {
  createPersonalPortfolioProperty,
  createPrivateProperty,
  listOrganizations,
  type Organization,
} from "@/organizations";
import {
  newPlacesSession,
  placeLabel,
  suggestPlaces,
  type PlaceSuggestion,
} from "@/places";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { describePropertySetup, type SetupStep } from "@/propertySetup";
import { loadPropertyVocabulary, type FeatureOption, type PropertyTypeOption } from "@/propertyTypes";
import { createAddress } from "@/provider";

/** The whole journey, before any of it exists — a sale's has a sale step, and land's is shorter. */
function outline(purpose: "letting" | "sale", propertyType: string): SetupStep[] {
  return describePropertySetup({
    name: "",
    waterSource: "unknown",
    powerMeterType: "unknown",
    documentState: "draft",
    photos: null,
    amenityCount: null,
    purpose,
    propertyType,
  }).map((step) => (step.key === "basics" ? { ...step, status: "todo" as const } : step));
}

export default function PrivatePropertyScreen() {
  const router = useRouter();
  const pageBottom = useSafeBottom(space[6]);
  const { organizationId, purpose: askedPurpose } = useLocalSearchParams<{ organizationId: string; purpose?: string }>();
  const { activeContext } = useAuth();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(organizationId ?? "");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [title, setTitle] = useState("");
  // No default. There is no sensible one — a hostel is not a residential
  // property with extra rooms — and this decides what may be let inside.
  const [propertyType, setPropertyType] = useState("");
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[]>([]);
  const [saleTypes, setSaleTypes] = useState<FeatureOption[]>([]);
  // Asked first: it decides which categories exist and every step after this one.
  const [purpose, setPurpose] = useState<"letting" | "sale">(askedPurpose === "sale" ? "sale" : "letting");
  const [localityQuery, setLocalityQuery] = useState("");
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceSuggestion | null>(null);
  const [placeAttribution, setPlaceAttribution] = useState<string | null>(null);
  const placesSession = useRef<string | null>(null);
  const [digitalAddress, setDigitalAddress] = useState("");
  const [street, setStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Fetched, so the form cannot offer a category the backend does not have.
    void loadPropertyVocabulary()
      .then((vocabulary) => {
        setPropertyTypes(vocabulary.property_types);
        setSaleTypes(vocabulary.sale_types ?? []);
      })
      .catch(() => setPropertyTypes([]));
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
    const typed = localityQuery.trim();
    if (selectedPlace || typed.length < 2) {
      setPlaceSuggestions([]);
      return;
    }

    placesSession.current ??= newPlacesSession();
    let current = true;
    const timer = setTimeout(() => {
      void suggestPlaces(typed, placesSession.current!, true)
        .then((response) => {
          if (!current) return;
          setPlaceSuggestions(response.suggestions);
          setPlaceAttribution(response.attribution);
        })
        .catch(() => {
          if (current) setPlaceSuggestions([]);
        });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [localityQuery, selectedPlace]);

  async function submit() {
    if (!selectedPlace || (organizations.length > 0 && !selectedOrganizationId)) return;
    setBusy(true);
    setError("");
    try {
      const address = await createAddress({
        place: {
          provider: selectedPlace.provider,
          reference: selectedPlace.reference,
          session: placesSession.current ?? undefined,
          name: selectedPlace.name,
          context: selectedPlace.context,
        },
        digital_address: digitalAddress || undefined,
        street: street || undefined,
        landmark: landmark || undefined,
      });
      const input = {
        title: title.trim(),
        property_type: propertyType,
        address_id: address.id,
        purpose,
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
        // A sale starts on its price and terms; land has no details step at all.
        params: { propertyId: property.id, step: purpose === "sale" ? "sale" : "details" },
      });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not start this property.");
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(selectedPlace) && Boolean(title.trim()) && Boolean(propertyType)
    && (organizations.length === 0 || Boolean(selectedOrganizationId));
  // Said outright rather than left to a greyed-out button (owner, 2026-10-05:
  // "be explicit about the issue, don't leave the user wondering").
  const stillNeeded = [
    organizations.length > 1 && !selectedOrganizationId ? "a Portfolio" : "",
    title.trim() ? "" : "a name",
    propertyType ? "" : "a type",
    selectedPlace ? "" : localityQuery.trim() ? "a town picked from the list" : "a town",
  ].filter(Boolean);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <Type variant="title2" accessibilityRole="header" style={styles.title}>Create a property</Type>
          <Footnote>Private until you choose otherwise.</Footnote>
        </View>

        <SetupProgress steps={outline(purpose, propertyType)} current="basics" />

        <View style={styles.section}>
          <GroupLabel>What it is</GroupLabel>
          {organizations.length > 1 ? (
            <Select
              label="Portfolio"
              placeholder="Which one files it"
              value={selectedOrganizationId}
              options={organizations.map((row) => ({ value: row.id, label: row.name }))}
              onChange={setSelectedOrganizationId}
            />
          ) : null}
          {organizations.length === 0 ? (
            <Notice tone="info" title="This goes into your Rooomly Portfolio" />
          ) : null}
          <PurposeChoice
            value={purpose}
            onChange={(next) => {
              // The two sides have different categories, so a choice made on
              // one never carries over to the other.
              if (next !== purpose) setPropertyType("");
              setPurpose(next);
            }}
          />
          {purpose === "sale" ? (
            <Field label="Name" placeholder="3-bedroom house, East Legon" value={title} onChangeText={setTitle} />
          ) : (
            <Field label="Name" placeholder="Adom Heights" value={title} onChangeText={setTitle} />
          )}
          {/* One compact field; each answer says what it holds inside its sheet. */}
          {purpose === "sale" ? (
            <SaleTypeChoice types={saleTypes} value={propertyType} onChange={setPropertyType} />
          ) : (
            <PropertyTypeChoice types={propertyTypes} value={propertyType} onChange={setPropertyType} />
          )}
        </View>

        <View style={styles.section}>
          <GroupLabel>Where it is</GroupLabel>
          <Field
            label="Town or neighbourhood"
            placeholder="Search anywhere in Ghana"
            value={localityQuery}
            onChangeText={(value) => {
              if (selectedPlace) placesSession.current = null;
              setLocalityQuery(value);
              setSelectedPlace(null);
              if (!value.trim()) placesSession.current = null;
            }}
            suffix={selectedPlace ? <Ionicons name="checkmark-circle" size={18} color={KOLA} /> : undefined}
          />

          {placeSuggestions.length ? (
            <RecordPanel>
              {placeSuggestions.map((item, index) => (
                <Pressable
                  key={item.provider + item.reference}
                  accessibilityRole="button"
                  accessibilityLabel={item.context ? `${item.name}. ${item.context}` : item.name}
                  onPress={() => {
                    setSelectedPlace(item);
                    setLocalityQuery(placeLabel(item));
                    setPlaceSuggestions([]);
                  }}
                  {...pressableFeedback(PRESSED)}
                  style={({ pressed }) => [
                    styles.place,
                    index === 0 ? null : styles.ruled,
                    pressed ? { backgroundColor: PRESSED } : null,
                  ]}
                >
                  <Ionicons name="location-outline" size={16} color={KOLA} />
                  <View style={styles.placeBody}>
                    <Type variant="bodyStrong" numberOfLines={1} style={styles.placeName}>{item.name}</Type>
                    {item.context ? (
                      <Type variant="caption" numberOfLines={1} style={styles.placeWhere}>{item.context}</Type>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </RecordPanel>
          ) : null}
          {placeSuggestions.length > 0 && placeAttribution === "google" ? (
            <Footnote>Google Maps</Footnote>
          ) : null}

          <Field
            label="GhanaPost GPS (optional)"
            placeholder="GA-492-1234"
            value={digitalAddress}
            onChangeText={setDigitalAddress}
            autoCapitalize="characters"
          />
          <Field label="Street (optional)" placeholder="Nii Tetteh Street" value={street} onChangeText={setStreet} />
          <Field label="Landmark (optional)" placeholder="Opposite the Baptist church" value={landmark} onChangeText={setLandmark} />
        </View>

        {error ? <Notice tone="error" title={error} /> : null}
        {stillNeeded.length ? (
          <Footnote>{`Still needed: ${stillNeeded.join(", ")}.`}</Footnote>
        ) : (
          <Footnote>Saves as you go.</Footnote>
        )}
      </ScrollView>

      {/* `propertyType` is in the condition because the backend requires it and
          there is no default — submitting without it produced a refusal the
          form could have prevented. */}
      <ActionBar>
        <Pill
          label="Save and continue"
          icon="arrow-forward"
          busy={busy}
          busyLabel="Saving"
          disabled={!ready}
          grow
          onPress={() => void submit()}
        />
      </ActionBar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  page: {
    padding: space[4],
    gap: space[4],
  },
  head: {
    gap: space[1],
    paddingHorizontal: 2,
  },
  eyebrow: {
    color: KOLA,
  },
  title: {
    fontSize: 19,
    lineHeight: 25,
    color: INK,
  },
  section: {
    gap: space[3],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  place: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  placeBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  placeName: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  placeWhere: {
    fontSize: 13,
    lineHeight: 17,
    color: MUTED,
  },
});
