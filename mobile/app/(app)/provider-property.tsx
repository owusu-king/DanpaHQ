import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { FlatList, StyleSheet, View } from "react-native";
import { useCallback, useState } from "react";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import {
  ActionBar,
  EDGE,
  Fact,
  Footnote,
  GroupLabel,
  HARMATTAN,
  INK,
  KOLA_DEEP,
  Lead,
  LinkRow,
  Pill,
  RecordPanel,
  StandingLine,
  type RecordTone,
} from "@/components/record/RecordSurfaces";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Button, Notice, Type, space } from "@/components/ui";
import { PropertyLifecycle, PropertyMore, PropertyRemoval, propertyRemoval } from "@/components/property/PropertyLifecycle";
import { propertyStatus } from "@/components/property/WorkspacePatterns";
import { SaleDetailsForm } from "@/components/property/SaleDetailsForm";
import { SalePanel, saleVisibility } from "@/components/property/SalePanel";
import { UNIT_COLUMNS, UNIT_TILE_GAP, UnitTile } from "@/components/property/UnitTile";
import { useSafeBottom } from "@/platform";
import { describePropertySetup, toSetupInput } from "@/propertySetup";
import {
  getProperty,
  getPropertyAmenities,
  listUnits,
  type Property,
  type SpaceAmenity,
  type Unit,
} from "@/provider";
import { getSellerSale, type SellerSale } from "@/sales";
import { theme } from "@/theme";
import { getVerification, type VerificationProgress } from "@/verification";

type Sheet = "information" | "amenities" | "more" | "danger" | "sale";

/**
 * One Property: what is inside it, and how much of it is let.
 *
 * Refined on review (2026-09-22) onto the record surfaces. It carried a tab bar
 * of its own — Units and Details — inside a pushed detail screen, which nothing
 * else in the app does and which hid half the record behind a control people
 * do not expect to find there. The Property *is* its Units, so they are the
 * page; everything that is reference rather than work — the address and
 * services, the shared amenities, the verification trail — opens
 * from a row instead of competing with them.
 */
export default function ProviderPropertyScreen() {
  const pageBottom = useSafeBottom(space[8]);
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
  const [photos, setPhotos] = useState<VerificationProgress | null>(null);
  const [amenities, setAmenities] = useState<SpaceAmenity[] | null>(null);
  const [sale, setSale] = useState<SellerSale | null>(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const load = useCallback(async () => {
    if (!propertyId) return;
    try {
      // Each space carries its own check state, publication state, amenities and
      // primary photo, so the screen never fetches every listing and every bed to
      // describe a card. The last two are what say where setup has got to.
      const [prop, unitRows, progress, amenityState] = await Promise.all([
        getProperty(propertyId),
        listUnits(propertyId),
        getVerification("property", propertyId),
        getPropertyAmenities(propertyId),
      ]);
      // Sold whole, a sale has no Units; its price and terms are its own record.
      setSale(prop.purpose === "sale" ? await getSellerSale(propertyId) : null);
      setProperty(prop);
      setUnits(prop.purpose === "sale" ? [] : unitRows);
      setPhotos(progress);
      setAmenities(amenityState.chosen);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this Property.");
    }
  }, [propertyId]);

  // On focus, so coming back from a Unit, setup or verification shows what changed.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!property) {
    return (
      <View style={styles.page}>
        {error ? <Notice tone="error" title={error} body="Return to Properties and try again." /> : <PropertySkeleton />}
      </View>
    );
  }

  const steps = describePropertySetup(
    toSetupInput(
      property,
      photos,
      amenities !== null && property.amenities_confirmed_at ? amenities.length : null,
      sale ? sale.missing.length : null,
    ),
  );
  const selling = property.purpose === "sale";
  const land = selling && property.property_type === "land";
  const verified = property.verification.review_state === "verified";
  const shown = sale ? saleVisibility(sale, verified) : null;
  // A property above its Portfolio's plan allowance takes no new units. The API
  // refuses regardless; this only stops offering what it would refuse.
  const access = property.billing_access;
  const restricted = Boolean(access && access.state !== "full");
  const canAddUnit = (property.capabilities.private_inventory?.allowed ?? false) && !restricted;
  // A sale is sold whole, so it is never offered a Unit.
  const offerUnit = canAddUnit && !selling;
  const canEdit = property.permitted_actions.edit?.allowed ?? false;
  const removal = propertyRemoval(property);
  const status = propertyStatus(property.verification);
  const tone: RecordTone = status.tone === "good" ? "good"
    : status.tone === "attention" ? "alert"
    : status.tone === "waiting" ? "waiting" : "quiet";
  const fullAddress = [
    property.address.house_number,
    property.address.street,
    property.address.locality_name,
    property.address.district_name,
  ].filter(Boolean).join(", ");

  const occupied = units.filter((unit) => unit.availability.state === "occupied").length;
  const vacant = units.length - occupied;
  const addUnit = () => router.push({ pathname: "/(app)/space-new", params: { propertyId: property.id } });

  return (
    <View style={styles.screen}>
      <FlatList
        data={units}
        keyExtractor={(unit) => unit.id}
        numColumns={UNIT_COLUMNS}
        columnWrapperStyle={{ gap: UNIT_TILE_GAP }}
        contentContainerStyle={[styles.page, { paddingBottom: offerUnit ? space[6] : pageBottom }]}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <UnitTile
            unit={item}
            // Inside a Property the building is a given — what kind of space it
            // is and how big is what tells one Unit from the next.
            meta={`${item.space_type_label} · ${item.bedrooms === 0 ? "Single room" : `${item.bedrooms} bed${item.bedrooms === 1 ? "" : "s"}`}`}
            onOpen={() => router.push({ pathname: "/(app)/space", params: { unitId: item.id } })}
          />
        )}
        ListHeaderComponent={
          <View style={styles.head}>
            {error ? <Notice tone="error" title={error} body="Some information may be out of date. Try again." /> : null}
            {justCreated ? (
              <Notice
                tone="success"
                title="Property created"
                body="It is private in your Portfolio. Finish its setup, then submit it for verification when you are ready."
              />
            ) : null}

            {/* One card says what this Property is (owner, 2026-10-06): its name,
                where it is and where it stands, how much of it is let as a bar,
                and its counts on one straight line — not a title on the ground
                over a separate "Let 5/6" panel. */}
            <View style={styles.card}>
              <View style={styles.identity}>
                <Type variant="title2" accessibilityRole="header" numberOfLines={2} style={styles.who}>
                  {property.title || "Untitled Property"}
                </Type>
                <Type variant="caption" numberOfLines={2} style={styles.where}>
                  {fullAddress || `${property.address.locality_name}, ${property.address.district_name}`}
                </Type>
                <StandingLine tone={tone} line={status.label} />
              </View>
              {selling ? (
                <View style={styles.sale}>
                  <Lead
                    label="Asking price"
                    value={sale?.price_formatted ?? "No price yet"}
                    note={shown ? `${shown.label} · ${shown.note}` : "Loading…"}
                    tone={shown?.tone ?? "quiet"}
                  />
                </View>
              ) : units.length ? (
                <View accessible accessibilityLabel={`${occupied} of ${units.length} Units let`} style={styles.letting}>
                  <View style={styles.lettingHead}>
                    <Type variant="caption" style={styles.lettingLabel}>Let</Type>
                    <Type variant="captionStrong" style={{ color: vacant ? HARMATTAN : KOLA_DEEP }}>
                      {vacant ? `${vacant} still to let` : "Every Unit is let"}
                    </Type>
                  </View>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { flex: occupied }]} />
                    <View style={{ flex: vacant }} />
                  </View>
                </View>
              ) : null}
              <View style={styles.facts}>
                <PropertyFact label="Type" wide value={propertyTypeLabel(property.property_type).replace(/ Property$/, "")} />
                {selling ? null : (
                  <>
                    <View style={styles.factRule} />
                    <PropertyFact label="Units" value={units.length ? `${occupied}/${units.length} let` : "None yet"} />
                  </>
                )}
              </View>
            </View>

            {access && restricted ? (
              <Notice
                tone={access.state === "wind_down" ? "warning" : "info"}
                title={access.state === "wind_down" ? "Winding down on your current plan" : "Read-only on your current plan"}
                body={`${access.message} Manage this in More → Plan & billing.`}
              />
            ) : null}

            <PropertyLifecycle property={property} steps={steps} onChanged={load} compact />

            {selling && sale ? (
              <SalePanel
                propertyId={property.id}
                sale={sale}
                verified={verified}
                onChanged={load}
                onEdit={() => setSheet("sale")}
              />
            ) : null}

            <View style={styles.section}>
              <GroupLabel>About this Property</GroupLabel>
              <RecordPanel>
                <LinkRow
                  first
                  icon="document-text-outline"
                  label="Property information"
                  detail={land ? "Address and landmark" : "Address, water, power and compound"}
                  onPress={() => setSheet("information")}
                />
                {land ? null : <LinkRow
                  icon="sparkles-outline"
                  label="Shared amenities"
                  detail={amenities === null ? "Loading…" : amenities.length ? amenities.map((row) => row.name).join(" · ") : "None recorded"}
                  onPress={() => setSheet("amenities")}
                />}
                <LinkRow
                  icon="shield-checkmark-outline"
                  label="Verification details"
                  detail={property.verification.review_state_label}
                  onPress={() => setSheet("more")}
                />
                {/* In the open, where the Property is described, rather than
                    tucked inside its verification trail (owner, 2026-09-28).
                    Which of the two is offered is the backend's answer. */}
                {removal ? (
                  <LinkRow
                    icon={removal === "delete" ? "trash-outline" : "archive-outline"}
                    tone="alert"
                    label={removal === "delete" ? "Delete property" : "Archive property"}
                    detail={removal === "delete" ? "Removes it for good" : "Takes it out of your Portfolio"}
                    onPress={() => setSheet("danger")}
                  />
                ) : null}
              </RecordPanel>
            </View>

            {selling ? null : (
              <View style={styles.section}>
                <GroupLabel>{units.length ? `Units · ${units.length}` : "Units"}</GroupLabel>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={selling ? null : (
          <RecordPanel>
            <Fact
              wide
              first
              label="No Units yet"
              value="Add the room, apartment, shop or other space a tenant can rent."
            />
          </RecordPanel>
        )}
        ListFooterComponent={
          <View style={styles.foot}>
            {selling ? null : <RecordPanel>
              <LinkRow
                first
                icon="people-outline"
                label="Tenant access and tenancies"
                detail="Requests, agreements and who lives here, in this Property"
                onPress={() => router.push({ pathname: "/(app)/(provider-tabs)/tenants", params: { propertyId: property.id, scopeLabel: property.title } } as never)}
              />
            </RecordPanel>}
            {canEdit ? null : <Footnote>This Property is read-only for your role.</Footnote>}
          </View>
        }
      />

      {offerUnit ? (
        <ActionBar>
          <Pill label="Add Unit" icon="add" grow onPress={addUnit} />
        </ActionBar>
      ) : null}

      <BottomSheet
        visible={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheetTitle(sheet)}
        closeLabel="Close"
      >
        {sheet === "information" ? (
          <View style={styles.sheetBody}>
            <RecordPanel>
              <Fact first label="Type" value={propertyTypeLabel(property.property_type)} />
              <Fact wide label="Address" value={fullAddress || `${property.address.locality_name}, ${property.address.district_name}`} />
              {property.address.digital_address ? <Fact label="Digital address" value={property.address.digital_address} /> : null}
              {property.address.landmark ? <Fact wide label="Landmark" value={property.address.landmark} /> : null}
              {land ? null : (
                <>
                  <Fact label="Water" value={property.water_source_label} />
                  <Fact label="Power meter" value={property.power_meter_label} />
                  <Fact label="Compound" value={property.compound_label} />
                </>
              )}
            </RecordPanel>
            {canEdit ? (
              <Button
                label="Edit Property information"
                variant="secondary"
                onPress={() => { setSheet(null); router.push({ pathname: "/(app)/property-setup", params: { propertyId: property.id } }); }}
              />
            ) : null}
          </View>
        ) : sheet === "amenities" ? (
          <View style={styles.sheetBody}>
            <RecordPanel>
              {amenities === null ? (
                <Fact wide first label="Shared amenities" value="Loading…" />
              ) : amenities.length ? (
                amenities.map((amenity, index) => (
                  <Fact key={amenity.id} first={index === 0} wide label={amenity.category || "Amenity"} value={amenity.name} />
                ))
              ) : (
                <Fact wide first label="None recorded" value="Amenities shared across the whole Property are listed here." />
              )}
            </RecordPanel>
            {canEdit ? (
              <Button
                label="Edit shared amenities"
                variant="secondary"
                onPress={() => { setSheet(null); router.push({ pathname: "/(app)/property-setup", params: { propertyId: property.id, step: "amenities" } }); }}
              />
            ) : null}
          </View>
        ) : sheet === "more" ? (
          <View style={styles.sheetBody}>
            <PropertyMore property={property} />
          </View>
        ) : sheet === "sale" && sale ? (
          <View style={styles.sheetBody}>
            <SaleDetailsForm
              propertyId={property.id}
              sale={sale}
              saveLabel="Save changes"
              onSaved={async () => { setSheet(null); await load(); }}
            />
          </View>
        ) : sheet === "danger" ? (
          <View style={styles.sheetBody}>
            <PropertyRemoval property={property} />
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

/** One of the Property's facts on the identity card's straight line. */
function PropertyFact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={[styles.fact, wide ? { flex: 1.5 } : null]}>
      <Type variant="caption" style={styles.factLabel}>{label}</Type>
      <Type variant="bodyStrong" numberOfLines={2} style={styles.factValue}>{value}</Type>
    </View>
  );
}

function sheetTitle(sheet: Sheet | null) {
  if (sheet === "information") return "Property information";
  if (sheet === "amenities") return "Shared amenities";
  if (sheet === "more") return "Verification details";
  if (sheet === "danger") return "Archive or delete";
  if (sheet === "sale") return "Price and description";
  return "";
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

/** Shaped like the Property, so nothing jumps when it arrives. */
function PropertySkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading this Property" style={{ gap: space[4] }}>
      <Bone width="62%" height={22} />
      <Bone width="44%" />
      <RecordPanel style={styles.skeletonPanel}>
        <Bone width="30%" height={12} />
        <Bone width="52%" height={26} />
      </RecordPanel>
      <Bone width="40%" height={12} />
      <View style={{ flexDirection: "row", gap: UNIT_TILE_GAP }}>
        <Bone height={190} />
        <Bone height={190} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  page: {
    padding: space[4],
    gap: UNIT_TILE_GAP,
  },
  head: {
    gap: space[4],
    marginBottom: space[1],
  },
  card: {
    overflow: "hidden",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: theme.color.field["0"],
  },
  identity: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },
  who: {
    fontSize: 22,
    lineHeight: 28,
    color: INK,
  },
  where: {
    marginTop: -4,
  },
  sale: {
    marginHorizontal: -space[4],
  },
  letting: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingTop: space[4],
  },
  lettingHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  lettingLabel: {
    color: theme.color.ink["500"],
  },
  bar: {
    height: 8,
    flexDirection: "row",
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: theme.color.harmattan["100"],
  },
  barFill: {
    borderRadius: 4,
    backgroundColor: theme.color.kola["600"],
  },
  facts: {
    flexDirection: "row",
    marginTop: space[4],
    paddingVertical: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: EDGE,
  },
  fact: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingHorizontal: space[4],
  },
  factRule: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: EDGE,
  },
  factLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  factValue: {
    fontSize: 14,
    lineHeight: 19,
    color: INK,
  },
  section: {
    gap: space[2],
  },
  foot: {
    gap: space[3],
    marginTop: space[4],
  },
  sheetBody: {
    gap: space[4],
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
});
