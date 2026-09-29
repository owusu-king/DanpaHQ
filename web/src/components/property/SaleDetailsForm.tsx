"use client";

/**
 * What a buyer reads about a property for sale: the price, the tenure, and what
 * is being bought — rooms for a house, a use and floor area for a commercial
 * building, a size for land.
 *
 * One form for both moments it is needed. During setup everything is open;
 * once the property is verified only the price, whether it is negotiable, the
 * headline and the description move, because the size, the rooms and the tenure
 * were checked against the title (owner, 2026-09-28). Which fields are open is
 * the backend's answer — `editable_fields` — and a locked field is shown, not
 * hidden, so the seller can see what was checked.
 */

import { useState } from "react";

import { Button } from "@/components/Button";
import { CheckChip } from "@/components/Check";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { Select } from "@/components/Select";
import { ApiFailure } from "@/lib/api";
import {
  COMMERCIAL_USES,
  LAND_UNITS,
  TENURES,
  trimNumber,
  updateSale,
  type SaleInput,
  type SellerSale,
} from "@/lib/sales";

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

  async function save() {
    setBusy(true);
    setError("");
    const input: SaleInput = {};
    const cedis = Number(price.replace(/,/g, ""));
    if (!locked("price_minor") && price.trim()) {
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
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sale-form">
      {nothingOpen ? (
        <Notice
          tone="info"
          title="These details are fixed right now"
          body={
            sale.status === "sold"
              ? "This property has been sold."
              : "Our team is checking this property. Nothing about it can change until they finish."
          }
        />
      ) : null}

      <section className="sale-form-group" aria-label="Price">
        <div className="sale-form-grid">
          <Field
            label="Asking price"
            prefix="GH₵"
            inputMode="decimal"
            value={price}
            disabled={locked("price_minor")}
            onChange={(event) => setPrice(event.target.value)}
          />
          <div className="sale-form-check">
            <CheckChip
              label="The price is negotiable"
              checked={negotiable}
              disabled={locked("price_negotiable")}
              onChange={setNegotiable}
            />
          </div>
        </div>
      </section>

      <section className="sale-form-group" aria-label="What buyers read">
        <Field
          label="Headline"
          hint="The first line a buyer reads — what it is and where."
          maxLength={160}
          value={headline}
          disabled={locked("headline")}
          onChange={(event) => setHeadline(event.target.value)}
        />
        <label className="sale-form-textarea">
          <span className="type-caption field-label">Description</span>
          <textarea
            className="type-body"
            rows={5}
            maxLength={3000}
            value={description}
            disabled={locked("description")}
            onChange={(event) => setDescription(event.target.value)}
          />
          <span className="type-caption">At least 40 characters. {description.trim().length} so far.</span>
        </label>
      </section>

      <section className="sale-form-group" aria-label="Tenure">
        <div className="sale-form-grid">
          <Select
            label="Tenure"
            value={tenure}
            disabled={locked("tenure")}
            onChange={setTenure}
            options={[["", "Choose…"], ...TENURES]}
          />
          {tenure === "leasehold" ? (
            <Field
              label="Years left on the lease"
              inputMode="numeric"
              value={leaseYears}
              disabled={locked("lease_years_remaining")}
              onChange={(event) => setLeaseYears(event.target.value.replace(/\D/g, ""))}
            />
          ) : null}
        </div>
      </section>

      <section className="sale-form-group" aria-label="What is being sold">
        {sale.kind === "residential" ? (
          <div className="sale-form-grid">
            <Field
              label="Bedrooms"
              inputMode="numeric"
              value={bedrooms}
              disabled={locked("bedrooms")}
              onChange={(event) => setBedrooms(event.target.value.replace(/\D/g, ""))}
            />
            <Field
              label="Bathrooms"
              inputMode="numeric"
              value={bathrooms}
              disabled={locked("bathrooms")}
              onChange={(event) => setBathrooms(event.target.value.replace(/\D/g, ""))}
            />
            <Field
              label="Floor area (m²), if known"
              inputMode="decimal"
              value={floorArea}
              disabled={locked("floor_area_sqm")}
              onChange={(event) => setFloorArea(event.target.value)}
            />
          </div>
        ) : sale.kind === "commercial" ? (
          <div className="sale-form-grid">
            <Select
              label="What is it used for?"
              value={use}
              disabled={locked("commercial_use")}
              onChange={setUse}
              options={[["", "Choose…"], ...COMMERCIAL_USES]}
            />
            <Field
              label="Floor area (m²)"
              inputMode="decimal"
              value={floorArea}
              disabled={locked("floor_area_sqm")}
              onChange={(event) => setFloorArea(event.target.value)}
            />
          </div>
        ) : (
          <div className="sale-form-grid">
            <Field
              label="Land size"
              inputMode="decimal"
              value={landSize}
              disabled={locked("land_size")}
              onChange={(event) => setLandSize(event.target.value)}
            />
            <Select
              label="Measured in"
              value={landUnit}
              disabled={locked("land_size_unit")}
              onChange={setLandUnit}
              options={LAND_UNITS}
            />
            <div className="sale-form-check">
              <CheckChip
                label="Water and power reach the plot"
                checked={serviced}
                disabled={locked("is_serviced")}
                onChange={setServiced}
              />
            </div>
          </div>
        )}
      </section>

      {sale.missing.length ? (
        <div className="sale-form-missing">
          <p className="type-caption">Still needed before it can be sent</p>
          <ul>
            {sale.missing.map((gap) => (
              <li key={gap.field} className="type-caption">{gap.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      {nothingOpen ? null : (
        <div>
          <Button onClick={save} busy={busy} busyLabel="Saving…">
            {saveLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
