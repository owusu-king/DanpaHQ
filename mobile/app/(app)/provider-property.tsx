import { useLocalSearchParams, useRouter } from "expo-router";
import { FlatList, Pressable, View } from "react-native";
import { useCallback, useEffect, useState } from "react";

import { ApiFailure } from "@/api";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { PropertyLifecycle, PropertyMore } from "@/components/property/PropertyLifecycle";
import {
  Disclosure,
  EntityHeader,
  LoadingRows,
  StatusLine,
  propertyStatus,
} from "@/components/property/WorkspacePatterns";
import { UNIT_COLUMNS, UNIT_TILE_GAP, UnitTile } from "@/components/property/UnitTile";
import { pressableFeedback } from "@/platform";
import { describePropertySetup, toSetupInput } from "@/propertySetup";
import {
  createBuilding,
  getProperty,
  getPropertyAmenities,
  listBuildings,
  listUnits,
  type Building,
  type Property,
  type SpaceAmenity,
  type Unit,
} from "@/provider";
import { theme } from "@/theme";
import { getVerification, type VerificationProgress } from "@/verification";

export default function ProviderPropertyScreen() {
  const { propertyId, created: cameFromCreation } = useLocalSearchParams<{
    propertyId: string;
    created?: string;
  }>();
  // Set by the creation flow on its way back here, so the provider lands on
  // proof that the thing they just did worked.
  const justCreated = cameFromCreation === "1";
  const router = useRouter();
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [photos, setPhotos] = useState<VerificationProgress | null>(null);
  const [amenities, setAmenities] = useState<SpaceAmenity[] | null>(null);
  const [error, setError] = useState("");
  const [addingBuilding, setAddingBuilding] = useState(false);
  const [section, setSection] = useState<"units" | "details">("units");

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      // Each space carries its own check state, publication state, amenities and
      // primary photo, so the screen never fetches every listing and every bed to
      // describe a card. The last two are what say where setup has got to.
      const [prop, unitRows, buildingRows, progress, amenityState] = await Promise.all([
        getProperty(propertyId),
        listUnits(propertyId),
        listBuildings(propertyId),
        getVerification("property", propertyId),
        getPropertyAmenities(propertyId),
      ]);
      setProperty(prop);
      setUnits(unitRows);
      setBuildings(buildingRows);
      setPhotos(progress);
      setAmenities(amenityState.chosen);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this Property.");
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const steps = property
    ? describePropertySetup(
        toSetupInput(
          property,
          photos,
          amenities !== null && property.amenities_confirmed_at ? amenities.length : null,
        ),
      )
    : [];
  const canAddUnit = property?.capabilities.private_inventory?.allowed ?? false;
  const status = property ? propertyStatus(property.verification) : null;
  const fullAddress = property
    ? [
        property.address.house_number,
        property.address.street,
        property.address.locality_name,
        property.address.district_name,
      ].filter(Boolean).join(", ")
    : "";

  return (
    <FlatList
      data={property && section === "units" ? units : []}
      keyExtractor={(unit) => unit.id}
      numColumns={UNIT_COLUMNS}
      columnWrapperStyle={{ gap: UNIT_TILE_GAP }}
      renderItem={({ item }) => (
        <UnitTile
          unit={item}
          // Inside a Property the building is a given — what kind of space it
          // is and how big is what tells one Unit from the next.
          meta={`${item.space_type_label} · ${item.bedrooms === 0 ? "Single room" : `${item.bedrooms} bed${item.bedrooms === 1 ? "" : "s"}`}`}
          onOpen={() => router.push({ pathname: "/(app)/space", params: { unitId: item.id } })}
        />
      )}
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: UNIT_TILE_GAP }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={(
        <View style={{ gap: space[5] }}>
          {error ? <Notice tone="error" title={error} body={property ? "Some information may be out of date. Try again." : "Return to Properties and try again."} /> : null}
          {justCreated ? (
            <Notice
              tone="success"
              title="Property created"
              body="It is private in your Portfolio. Finish its setup, then submit it for verification when you are ready."
            />
          ) : null}
          {property ? (
            <EntityHeader
              eyebrow={propertyTypeLabel(property.property_type)}
              title={property.title || "Untitled Property"}
              subtitle={fullAddress || `${property.address.locality_name}, ${property.address.district_name}`}
              status={status ? <StatusLine label={status.label} tone={status.tone} /> : undefined}
            />
          ) : null}
          {property ? <PropertyLifecycle property={property} steps={steps} onChanged={load} compact /> : null}
          {property ? <PropertyTabs selected={section} onSelect={setSection} /> : null}
          {property && section === "units" ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], paddingBottom: space[2], borderBottomWidth: units.length ? 1 : 0, borderBottomColor: theme.color.field["200"] }}>
              <View style={{ flex: 1, gap: space[1] }}>
                <Type variant="title2" accessibilityRole="header">Units</Type>
                <Type variant="caption">{units.length} {units.length === 1 ? "rentable space" : "rentable spaces"}</Type>
              </View>
              {canAddUnit ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add Unit"
                  onPress={() => router.push({ pathname: "/(app)/space-new", params: { propertyId: property.id } })}
                  {...pressableFeedback(theme.color.field["200"])}
                  style={{ minHeight: 48, justifyContent: "center" }}
                >
                  <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>Add Unit</Type>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
      ListEmptyComponent={
        !property ? (
          error ? null : <LoadingRows rows={5} />
        ) : section === "units" ? (
          <View style={{ paddingVertical: space[8], gap: space[2], alignItems: "center" }}>
            <Type variant="bodyStrong">No Units yet</Type>
            <Type variant="caption" style={{ textAlign: "center" }}>Add the room, apartment, shop or other space a tenant can rent.</Type>
          </View>
        ) : (
          <PropertyDetails
            property={property}
            fullAddress={fullAddress}
            amenities={amenities}
            buildings={buildings}
            addingBuilding={addingBuilding}
            onAddBuilding={() => setAddingBuilding(true)}
            onBuildingDone={async () => { setAddingBuilding(false); await load(); }}
          />
        )
      }
      ListFooterComponent={property && section === "units" && units.length ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/(app)/(provider-tabs)/tenants" as never)}
          {...pressableFeedback(theme.color.field["200"])}
          style={{ minHeight: 56, justifyContent: "center", marginTop: space[3] }}
        >
          <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>Manage tenant access and tenancies →</Type>
        </Pressable>
      ) : null}
    />
  );
}

function PropertyTabs({
  selected,
  onSelect,
}: {
  selected: "units" | "details";
  onSelect: (section: "units" | "details") => void;
}) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: space[2] }}>
      <PropertyTab label="Units" selected={selected === "units"} onPress={() => onSelect("units")} />
      <PropertyTab label="Details" selected={selected === "details"} onPress={() => onSelect("details")} />
    </View>
  );
}

function PropertyTab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 48,
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: selected ? theme.color.kola["600"] : theme.color.field["300"],
        backgroundColor: selected ? theme.color.kola["50"] : theme.color.field["0"],
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["700"] }}>{label}</Type>
    </Pressable>
  );
}

function PropertyDetails({
  property,
  fullAddress,
  amenities,
  buildings,
  addingBuilding,
  onAddBuilding,
  onBuildingDone,
}: {
  property: Property;
  fullAddress: string;
  amenities: SpaceAmenity[] | null;
  buildings: Building[];
  addingBuilding: boolean;
  onAddBuilding: () => void;
  onBuildingDone: () => Promise<void>;
}) {
  const router = useRouter();
  const canEdit = property.permitted_actions.edit?.allowed ?? false;
  return (
    <View style={{ paddingTop: space[2] }}>
      <Type variant="title2" accessibilityRole="header" style={{ marginBottom: space[3] }}>About this Property</Type>
      <Disclosure title="Property information" initiallyOpen>
        <Fact label="Type" value={propertyTypeLabel(property.property_type)} />
        <Fact label="Address" value={fullAddress || `${property.address.locality_name}, ${property.address.district_name}`} />
        {property.address.digital_address ? <Fact label="Digital address" value={property.address.digital_address} mono /> : null}
        {property.address.landmark ? <Fact label="Landmark" value={property.address.landmark} /> : null}
        <Fact label="Water" value={valueLabel(property.water_source)} />
        <Fact label="Power meter" value={valueLabel(property.power_meter_type)} />
        <Fact label="Compound" value={valueLabel(property.compound_type)} />
        <Fact label="Security" value={property.has_security ? "Security recorded" : "Not recorded"} />
        {canEdit ? <InlineAction label="Edit Property information" onPress={() => router.push({ pathname: "/(app)/property-setup", params: { propertyId: property.id } })} /> : null}
      </Disclosure>
      <Disclosure title={`Shared amenities${amenities?.length ? ` (${amenities.length})` : ""}`}>
        {amenities === null ? <LoadingRows rows={2} /> : amenities.length ? (
          <Type variant="body">{amenities.map((amenity) => amenity.name).join(" · ")}</Type>
        ) : <Type variant="caption">No shared amenities recorded.</Type>}
        {canEdit ? <InlineAction label="Edit shared amenities" onPress={() => router.push({ pathname: "/(app)/property-setup", params: { propertyId: property.id, step: "amenities" } })} /> : null}
      </Disclosure>
      <Disclosure title={`Buildings and blocks${buildings.length ? ` (${buildings.length})` : ""}`}>
        {buildings.length ? buildings.map((building) => <Type key={building.id} variant="bodyStrong">{building.name}{building.code ? ` · ${building.code}` : ""}</Type>) : <Type variant="caption">No separate buildings or blocks.</Type>}
        {addingBuilding ? <BuildingForm property={property} onDone={onBuildingDone} /> : <Button label="Add building or block" variant="secondary" onPress={onAddBuilding} />}
      </Disclosure>
      <PropertyMore property={property} />
    </View>
  );
}

function InlineAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...pressableFeedback(theme.color.field["200"])} style={{ minHeight: 48, justifyContent: "center" }}>
      <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>{label} →</Type>
    </Pressable>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ minHeight: 40, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[4] }}>
      <Type variant="caption">{label}</Type>
      <Type variant={mono ? "mono" : "bodyStrong"} style={{ flex: 1, textAlign: "right" }}>{value}</Type>
    </View>
  );
}

function valueLabel(value: string): string {
  if (!value || value === "unknown") return "Not recorded";
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function propertyTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    residential: "Residential Property",
    commercial: "Commercial Property",
    hostel: "Hostel",
    mixed_use: "Mixed-use Property",
    land: "Land",
  };
  return labels[value] ?? valueLabel(value);
}

function BuildingForm({ property, onDone }: { property: Property; onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <View style={{ gap: space[3] }}>
      <Field label="Building or block name" value={name} onChangeText={setName} />
      <Field label="Code (optional)" value={code} onChangeText={setCode} />
      {error ? <Notice tone="error" title={error} /> : null}
      <Button label="Save building" busy={busy} disabled={!name.trim()} onPress={async () => {
        setBusy(true); setError("");
        try { await createBuilding(property.id, { name: name.trim(), code: code.trim() }); await onDone(); }
        catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not save the building."); }
        finally { setBusy(false); }
      }} />
    </View>
  );
}
