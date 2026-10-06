/**
 * What a buyer reads about a property for sale: the price, the tenure, and what
 * is being bought — rooms for a house, a use and floor area for a commercial
 * building, a size for land. The twin of the web `SaleDetailsForm.tsx`.
 *
 * One form for setup and for later. Which fields are open is the backend's
 * answer (`editable_fields`): everything while it is being described, only the
 * price and the words once verified, nothing while our team holds it. A locked
 * field is shown, not hidden, so the seller can see what was checked.
 */

import { useState } from "react";
import { View } from "react-native";

import { ApiFailure } from "@/api";
import { Select } from "@/components/form/Select";
import { ActionBar, Footnote, GroupLabel, Pill, RecordPanel, Fact } from "@/components/record/RecordSurfaces";
import { Chip, Field, Notice, space } from "@/components/ui";
import {
  COMMERCIAL_USES,
  LAND_UNITS,
  TENURES,
  trimNumber,
  updateSale,
  type SaleInput,
  type SellerSale,
} from "@/sales";

const options = (rows: readonly (readonly [string, string])[]) =>
  rows.map(([value, label]) => ({ value, label }));

export function SaleDetailsForm({
  propertyId,
  sale,
  onSaved,
  saveLabel = "Save sale details",
}: {
  propertyId: string;
  sale: SellerSale;
  onSaved: (next: SellerSale) => Promise<void> | void;
  saveLabel?: string;
}) {
  const open = new Set(sale.editable_fields);
  const locked = (field: string) => !open.has(field);

  const [price, setPrice] = useState(sale.price_minor ? String(sale.price_minor / 100) : "");
  const [negotiable, setNegotiable] = useState(sale.price_negotiable);
  const [headline, setHeadline] = useState(sale.headline);
  const [description, setDescription] = useState(sale.description);
  const [tenure, setTenure] = useState<string>(sale.tenure || "");
  const [leaseYears, setLeaseYears] = useState(
    sale.lease_years_remaining ? String(sale.lease_years_remaining) : "",
  );
  const [bedrooms, setBedrooms] = useState(sale.bedrooms !== null ? String(sale.bedrooms) : "");
  const [bathrooms, setBathrooms] = useState(sale.bathrooms !== null ? String(sale.bathrooms) : "");
  const [floorArea, setFloorArea] = useState(sale.floor_area_sqm ? trimNumber(sale.floor_area_sqm) : "");
  const [use, setUse] = useState(sale.commercial_use || "");
  const [landSize, setLandSize] = useState(sale.land_size ? trimNumber(sale.land_size) : "");
  const [landUnit, setLandUnit] = useState(sale.land_size_unit || "plots");
  const [serviced, setServiced] = useState(Boolean(sale.is_serviced));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const nothingOpen = open.size === 0;
  const digits = (value: string) => value.replace(/\D/g, "");

  async function save() {
    setBusy(true);
    setError("");
    const input: SaleInput = {};
    if (!locked("price_minor") && price.trim()) {
      const cedis = Number(price.replace(/,/g, ""));
      if (!Number.isFinite(cedis) || cedis <= 0) {
        setError("Give the asking price as a number of cedis.");
        setBusy(false);
        return;
      }
      input.price_minor = Math.round(cedis * 100);
    }
    if (!locked("price_negotiable")) input.price_negotiable = negotiable;
    if (!locked("headline")) input.headline = headline.trim();
    if (!locked("description")) input.description = description.trim();
    if (!locked("tenure")) input.tenure = tenure;
    if (!locked("lease_years_remaining")) {
      input.lease_years_remaining = tenure === "leasehold" && leaseYears ? Number(leaseYears) : null;
    }
    if (sale.kind === "residential") {
      if (!locked("bedrooms")) input.bedrooms = bedrooms === "" ? null : Number(bedrooms);
      if (!locked("bathrooms")) input.bathrooms = bathrooms === "" ? null : Number(bathrooms);
    }
    if (sale.kind !== "land" && !locked("floor_area_sqm")) {
      input.floor_area_sqm = floorArea === "" ? null : floorArea;
    }
    if (sale.kind === "commercial" && !locked("commercial_use")) input.commercial_use = use;
    if (sale.kind === "land") {
      if (!locked("land_size")) input.land_size = landSize === "" ? null : landSize;
      if (!locked("land_size_unit")) input.land_size_unit = landUnit;
      if (!locked("is_serviced")) input.is_serviced = serviced;
    }
    try {
      const next = await updateSale(propertyId, input);
      await onSaved(next);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not save: check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space[4] }}>
      {nothingOpen ? (
        <Notice
          tone="info"
          title="These details are fixed right now"
          body={sale.status === "sold" ? "This property has been sold." : "Our team is checking this property."}
        />
      ) : null}

      <View style={{ gap: space[3] }}>
        <GroupLabel>Price</GroupLabel>
        <Field
          label="Asking price"
          prefix="GH₵"
          keyboardType="decimal-pad"
          placeholder="850000"
          value={price}
          editable={!locked("price_minor")}
          onChangeText={setPrice}
        />
        <View style={{ flexDirection: "row" }}>
          <Chip
            label="The price is negotiable"
            selected={negotiable}
            disabled={locked("price_negotiable")}
            onPress={() => setNegotiable((value) => !value)}
          />
        </View>
      </View>

      <View style={{ gap: space[3] }}>
        <GroupLabel>What buyers read</GroupLabel>
        <Field
          label="Headline"
          placeholder="4-bedroom house with a boys' quarters"
          maxLength={160}
          value={headline}
          editable={!locked("headline")}
          onChangeText={setHeadline}
        />
        <Field
          label="Description"
          // How far off it is, said before saving rather than refused after.
          hint={description.trim().length >= 40 ? `${description.trim().length} characters.` : undefined}
          error={description.trim().length < 40
            ? `${40 - description.trim().length} more character${40 - description.trim().length === 1 ? "" : "s"} needed (40 minimum).`
            : undefined}
          placeholder="What it is, its condition, and what is close by"
          multiline
          numberOfLines={5}
          maxLength={3000}
          value={description}
          editable={!locked("description")}
          onChangeText={setDescription}
          style={{ minHeight: 120, textAlignVertical: "top", paddingTop: space[3] }}
        />
      </View>

      <View style={{ gap: space[3] }}>
        <GroupLabel>Tenure</GroupLabel>
        <Select
          label="Tenure"
          value={tenure}
          disabled={locked("tenure")}
          options={options(TENURES)}
          onChange={setTenure}
        />
        {tenure === "leasehold" ? (
          <Field
            label="Years left on the lease"
            keyboardType="number-pad"
            value={leaseYears}
            editable={!locked("lease_years_remaining")}
            onChangeText={(value) => setLeaseYears(digits(value))}
          />
        ) : null}
      </View>

      <View style={{ gap: space[3] }}>
        <GroupLabel>{sale.kind === "land" ? "The land" : "The building"}</GroupLabel>
        {sale.kind === "residential" ? (
          <>
            <View style={{ flexDirection: "row", gap: space[3] }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Bedrooms"
                  keyboardType="number-pad"
                  value={bedrooms}
                  editable={!locked("bedrooms")}
                  onChangeText={(value) => setBedrooms(digits(value))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Bathrooms"
                  keyboardType="number-pad"
                  value={bathrooms}
                  editable={!locked("bathrooms")}
                  onChangeText={(value) => setBathrooms(digits(value))}
                />
              </View>
            </View>
            <Field
              label="Floor area (m²), if known"
              keyboardType="decimal-pad"
              value={floorArea}
              editable={!locked("floor_area_sqm")}
              onChangeText={setFloorArea}
            />
          </>
        ) : sale.kind === "commercial" ? (
          <>
            <Select
              label="What it is used for"
              value={use}
              disabled={locked("commercial_use")}
              options={options(COMMERCIAL_USES)}
              onChange={setUse}
            />
            <Field
              label="Floor area (m²)"
              keyboardType="decimal-pad"
              value={floorArea}
              editable={!locked("floor_area_sqm")}
              onChangeText={setFloorArea}
            />
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row", gap: space[3] }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Land size"
                  keyboardType="decimal-pad"
                  value={landSize}
                  editable={!locked("land_size")}
                  onChangeText={setLandSize}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Select
                  label="Measured in"
                  value={landUnit}
                  disabled={locked("land_size_unit")}
                  options={options(LAND_UNITS)}
                  onChange={setLandUnit}
                />
              </View>
            </View>
            <View style={{ flexDirection: "row" }}>
              <Chip
                label="Water and power reach the plot"
                selected={serviced}
                disabled={locked("is_serviced")}
                onPress={() => setServiced((value) => !value)}
              />
            </View>
          </>
        )}
      </View>

      {sale.missing.length ? (
        <View style={{ gap: space[2] }}>
          <GroupLabel>Still needed</GroupLabel>
          <RecordPanel>
            {sale.missing.map((gap, index) => (
              <Fact key={gap.field} first={index === 0} label="Needed" value={gap.message} tone="waiting" wide />
            ))}
          </RecordPanel>
        </View>
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      {nothingOpen ? (
        <Footnote>Nothing here can change until our team finishes.</Footnote>
      ) : (
        <ActionBar>
          <Pill label={saveLabel} icon="checkmark" busy={busy} busyLabel="Saving" grow onPress={() => void save()} />
        </ActionBar>
      )}
    </View>
  );
}
