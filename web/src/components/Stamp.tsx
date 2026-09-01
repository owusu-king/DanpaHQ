/**
 * The Stamp: this product's signature component.
 *
 * Adinkra cloth is printed by pressing a carved stamp onto fabric in a
 * registered grid. A verification here is the same gesture — somebody pressed a
 * decision onto a record at a moment in time — so the component looks like a
 * print mark rather than a badge: square corners, a hairline rule down one side,
 * and the date carried in the mark.
 *
 * The date is not decoration. A "Verified" chip with no date invites a tenant to
 * believe a two-year-old check still means something. Every stamp states when,
 * and "Not checked" is a first-class state rather than an absence — an omitted
 * stamp lets the interface imply a check that never happened.
 */

import { STATE_LABEL, type TrustState } from "@/lib/trust";

const TONE: Record<TrustState, { fg: string; bg: string; rule: string }> = {
  verified: {
    fg: "var(--color-kola-600)",
    bg: "var(--color-kola-50)",
    rule: "var(--color-kola-300)",
  },
  pending: {
    fg: "var(--color-harmattan-600)",
    bg: "var(--color-harmattan-100)",
    rule: "var(--color-harmattan-500)",
  },
  unverified: {
    fg: "var(--color-ink-500)",
    bg: "var(--color-field-100)",
    rule: "var(--color-field-300)",
  },
  expired: {
    fg: "var(--color-laterite-600)",
    bg: "var(--color-laterite-100)",
    rule: "var(--color-laterite-600)",
  },
};

export function Stamp({
  state,
  what,
  on,
  by,
}: {
  state: TrustState;
  /** What was checked: "Landlord identity", "Property ownership". */
  what: string;
  /** When the decision was made. Omitted only for states that never had one. */
  on?: string;
  /** Who or what checked it, where that is meaningful to the reader. */
  by?: string;
}) {
  const tone = TONE[state];
  return (
    <span
      aria-label={`${what}: ${STATE_LABEL[state]}${on ? `, ${on}` : ""}`}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: "var(--space-1)",
        padding: "var(--space-2) var(--space-3)",
        background: tone.bg,
        color: tone.fg,
        borderRadius: "var(--radius-stamp)",
        borderLeft: `var(--border-stamp) solid ${tone.rule}`,
        boxShadow: `inset 0 -1px 0 0 ${tone.rule}33`,
      }}
    >
      <span className="type-label" style={{ textTransform: "uppercase" }}>
        {STATE_LABEL[state]}
      </span>
      <span className="type-caption" style={{ color: "var(--color-ink-700)" }}>
        {what}
        {on ? ` · ${on}` : ""}
        {by ? ` · ${by}` : ""}
      </span>
    </span>
  );
}
