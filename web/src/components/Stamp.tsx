/**
 * The verification mark.
 *
 * Every stamp states **what** was checked and **when**. A "Verified" chip with
 * no date invites somebody to believe a two-year-old check still holds, and
 * that is precisely the false confidence this product exists to remove. "Not
 * checked" is drawn as plainly as "Verified" — an absent mark would let the
 * interface imply something it has not earned.
 *
 * The state is carried by a rule down the left edge as well as by the words, so
 * it survives being glanced at, being read by somebody who does not read
 * English comfortably, and being printed in greyscale.
 *
 * This component is the product's whole claim and it was, until now, imported
 * by exactly one file out of a hundred and eighteen.
 */

import { Icon } from "@/components/portal/icons";
import { STATE_LABEL, type TrustState } from "@/lib/trust";

const GLYPH: Record<TrustState, "verification" | "clock" | "info" | "warning"> = {
  verified: "verification",
  pending: "clock",
  unverified: "info",
  expired: "warning",
};

export function Stamp({
  state,
  what,
  on,
  by,
  className = "",
}: {
  state: TrustState;
  /** What was checked: "Landlord identity", "Property ownership". */
  what: string;
  /** When the decision was made. Omitted only for states that never had one. */
  on?: string;
  /** Who or what checked it, where that is meaningful to the reader. */
  by?: string;
  className?: string;
}) {
  const detail = [on, by].filter(Boolean).join(" · ");

  return (
    <span
      className={`stamp stamp-${state} ${className}`.trim()}
      aria-label={`${what}: ${STATE_LABEL[state]}${on ? `, ${on}` : ""}`}
    >
      <Icon name={GLYPH[state]} />
      <span>
        <span className="stamp-what">
          {STATE_LABEL[state]} · {what}
        </span>
        {detail ? <span className="stamp-when">{detail}</span> : null}
      </span>
    </span>
  );
}
