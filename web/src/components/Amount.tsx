import { formatMoney, type Money } from "@/lib/money";

/**
 * Every cedi figure in the product renders through this.
 *
 * Set in tabular mono so that a column of amounts aligns on the decimal - the
 * mobile-money receipt is the reference, and a rent schedule that does not line
 * up is harder to check at a glance. The machine-readable value is exposed to
 * screen readers and to copy/paste through the `data-minor` attribute.
 */
export function Amount({
  value,
  size = "amount",
  tone = "default",
}: {
  value: Money;
  size?: "amount" | "amount-lg";
  tone?: "default" | "credit" | "debit" | "muted";
}) {
  const color =
    tone === "credit"
      ? "var(--color-kola-600)"
      : tone === "debit"
        ? "var(--color-laterite-600)"
        : tone === "muted"
          ? "var(--color-ink-500)"
          : "var(--color-ink-900)";

  return (
    <span
      className={`type-${size}`}
      style={{ color, whiteSpace: "nowrap" }}
      data-minor={value.minor}
      data-currency={value.currency}
    >
      {formatMoney(value)}
    </span>
  );
}
