"use client";

import { Icon, type IconName } from "@/components/portal/icons";
import type { PropertyTypeOption } from "@/lib/propertyTypes";

/** The three categories, in the order the backend lists them. */
const GLYPH: Record<string, IconName> = {
  residential: "home",
  commercial: "shop",
  hostel: "users",
};

/**
 * What kind of property this is, as a choice rather than a list.
 *
 * There are exactly three categories and the field is the most consequential
 * one on the page: it decides what may be *let* inside the property, which the
 * backend enforces through `space_rules`. A dropdown asked somebody to open a
 * control, read three words with no consequence attached to any of them, and
 * pick — for a decision that shapes every screen after it.
 *
 * Each tile says what the choice actually buys, and says it from the API's own
 * `space_types` rather than from copy written here. If the vocabulary gains a
 * space type the tile gains it too, and nothing can describe a combination the
 * backend would refuse.
 *
 * Real radio inputs, visually hidden. Arrow keys move between the options, the
 * label is the hit area, and the state is announced — none of which is free
 * with a grid of buttons.
 */
export function PropertyTypeChoice({
  types,
  value,
  onChange,
}: {
  types: PropertyTypeOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <fieldset className="type-choice">
      <legend>What kind of property is this?</legend>
      <p className="type-caption">It decides what you can let inside it.</p>

      <div className="type-choice-grid">
        {types.map((type) => (
          <label key={type.value} className="type-choice-option">
            <input
              type="radio"
              name="property-type"
              value={type.value}
              checked={value === type.value}
              onChange={() => onChange(type.value)}
            />
            <span className="type-choice-face">
              <Icon name={GLYPH[type.value] ?? "properties"} />
              <span className="type-choice-name">{type.label}</span>
              {type.space_types.length ? (
                <span className="type-choice-holds">
                  {type.space_types.map((space) => space.label).join(" · ")}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
