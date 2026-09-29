"use client";

import { Icon } from "@/components/portal/icons";
import type { Property } from "@/lib/console";

const TYPE_LABEL: Record<string, string> = {
  residential: "Residential",
  commercial: "Commercial",
  hostel: "Hostel",
  land: "Land",
};

function value(raw: string): string | null {
  if (!raw || raw === "unknown") return null;
  return raw.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

/**
 * The property somebody just built, shown as a property.
 *
 * The review step was a definition list of step names against their status —
 * "Photos: 2 of 5 added", "What the compound has: 3 recorded". Somebody had
 * just photographed a building, named it, said how its water arrives and ticked
 * what the compound shares, and the last thing they saw before pressing *Create
 * property* was a progress table.
 *
 * So this shows the thing instead: its photograph, its name, where it is, and
 * the facts they entered in the words they chose. Nothing here is new
 * information — that is the point. It is the same answers, arranged as the
 * record they add up to.
 *
 * `Edit` sits beside each group rather than at the end, because somebody who
 * spots a wrong water source wants to fix the water source, not walk back
 * through three steps to reach it.
 */
export function PropertySummary({
  property,
  onEdit,
}: {
  property: Property;
  /** Which step to open. Keys match `propertySetup`. */
  onEdit: (step: string) => void;
}) {
  const where = property.address
    ? [property.address.locality_name, property.address.district_name].filter(Boolean).join(", ")
    : null;

  const characteristics = [
    ["Water", value(property.water_source)],
    ["Power", value(property.power_meter_type)],
    ["Compound", value(property.compound_type)],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  // A sale shows its price and headline; land has no water, power, compound or
  // shared amenities to show, so those groups are not drawn for it.
  const selling = property.purpose === "sale";
  const land = selling && property.property_type === "land";

  return (
    <div className="property-summary">
      <div className="property-summary-face">
        <span className="property-summary-photo">
          {property.cover_url ? (
            /* Short-lived signed URL from the files service. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={property.cover_url} alt="" />
          ) : (
            <span className="type-caption">No photograph yet</span>
          )}
        </span>
        <span className="property-summary-identity">
          <strong>{property.title || "Untitled property"}</strong>
          <span className="property-summary-kind">
            {TYPE_LABEL[property.property_type] ?? value(property.property_type) ?? "Property"}
            {selling ? " · For sale" : ""}
          </span>
          {where ? (
            <span className="property-summary-where">
              <Icon name="pin" />
              {where}
            </span>
          ) : null}
        </span>
      </div>

      <dl className="property-summary-facts">
        {selling ? (
          <Group label="Sale" onEdit={() => onEdit("sale")}>
            {property.sale?.price_formatted ? (
              <p className="property-summary-list">
                <strong>{property.sale.price_formatted}</strong>
                {property.sale.headline ? ` · ${property.sale.headline}` : ""}
              </p>
            ) : (
              <span className="property-summary-missing">No price yet</span>
            )}
          </Group>
        ) : null}

        {land ? null : (
          <Group label="Details" onEdit={() => onEdit("details")}>
            {characteristics.length ? (
              <ul className="property-summary-chips">
                {characteristics.map(([label, text]) => (
                  <li key={label}>
                    <span>{label}</span>
                    {text}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="property-summary-missing">Not recorded yet</span>
            )}
          </Group>
        )}

        {land ? null : (
          <Group label="Shared amenities" onEdit={() => onEdit("amenities")}>
            {property.amenities.length ? (
              <p className="property-summary-list">
                {property.amenities.map((amenity) => amenity.name).join(" · ")}
              </p>
            ) : (
              <span className="property-summary-missing">Nothing shared</span>
            )}
          </Group>
        )}
      </dl>
    </div>
  );
}

function Group({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="property-summary-group">
      <dt>
        {label}
        <button type="button" onClick={onEdit}>Edit</button>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
