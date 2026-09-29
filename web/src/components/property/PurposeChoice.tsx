"use client";

import { Icon, type IconName } from "@/components/portal/icons";
import type { FeatureOption } from "@/lib/propertyTypes";

/**
 * The same tile choice `PropertyTypeChoice` draws, for a set of options that are
 * not the letting categories: why the property is here, and — for a sale — what
 * kind of thing is being sold. Real radio inputs, visually hidden, so arrow keys
 * move between the options and the state is announced.
 */
function Tiles({
  name,
  legend,
  caption,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  caption: string;
  options: { value: string; label: string; holds: string; icon: IconName }[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <fieldset className="type-choice">
      <legend>{legend}</legend>
      <p className="type-caption">{caption}</p>
      <div className="type-choice-grid">
        {options.map((option) => (
          <label key={option.value} className="type-choice-option">
            <input
              type="radio"
              className="control-input"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="type-choice-face">
              <Icon name={option.icon} />
              <span className="type-choice-name">{option.label}</span>
              <span className="type-choice-holds">{option.holds}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * To let, or for sale — asked first, because it decides everything after it.
 *
 * A property for sale is sold whole: it takes no Units, and it is advertised as
 * itself the moment its verification passes (owner, 2026-09-28). A property to
 * let is the space-by-space business the rest of the portal runs. The choice is
 * fixed once the property exists, so it is made here, before anything else.
 */
export function PurposeChoice({
  value,
  onChange,
}: {
  value: "letting" | "sale";
  onChange: (next: "letting" | "sale") => void;
}) {
  return (
    <Tiles
      name="property-purpose"
      legend="What are you doing with it?"
      caption="It cannot be changed once the property is created."
      value={value}
      onChange={(next) => onChange(next as "letting" | "sale")}
      options={[
        {
          value: "letting",
          label: "Letting it",
          holds: "Units, rooms or bed spaces, each let to a tenant",
          icon: "units",
        },
        {
          value: "sale",
          label: "Selling it",
          holds: "Sold whole, and public once it is verified",
          icon: "listings",
        },
      ]}
    />
  );
}

const SALE_GLYPH: Record<string, IconName> = {
  residential: "properties",
  commercial: "shop",
  land: "map",
};

const SALE_HOLDS: Record<string, string> = {
  residential: "A house, a flat or a townhouse — bedrooms and bathrooms",
  commercial: "A shop, office or warehouse building — its use and floor area",
  land: "A plot or acreage — its size, and a surveyed site plan",
};

/** What is being sold, from the backend's own sale vocabulary. */
export function SaleTypeChoice({
  types,
  value,
  onChange,
}: {
  types: FeatureOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Tiles
      name="sale-type"
      legend="What are you selling?"
      caption="Each asks for what a buyer of it needs to know."
      value={value}
      onChange={onChange}
      options={types.map((type) => ({
        value: type.value,
        label: type.label,
        holds: SALE_HOLDS[type.value] ?? "",
        icon: SALE_GLYPH[type.value] ?? "properties",
      }))}
    />
  );
}
