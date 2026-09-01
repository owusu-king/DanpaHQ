/**
 * Client-side mirror of the backend money primitive.
 *
 * Amounts cross the wire as `{ minor: number, currency: "GHS" }` and stay
 * integers here too. Formatting must agree with the server's byte for byte,
 * because a receipt that renders GH¢1,500.0 on the phone and GH¢1,500.00 in the
 * emailed copy is a support ticket.
 */

export type Money = { minor: number; currency: string };

const EXPONENTS: Record<string, number> = { GHS: 2, USD: 2 };
const SYMBOLS: Record<string, string> = { GHS: "GH\u20b5", USD: "$" };

export function formatMoney(
  amount: Money,
  options: { symbol?: boolean; group?: boolean } = {},
): string {
  const { symbol = true, group = true } = options;
  const exponent = EXPONENTS[amount.currency] ?? 2;
  const divisor = 10 ** exponent;

  const sign = amount.minor < 0 ? "-" : "";
  const absolute = Math.abs(amount.minor);
  const units = Math.floor(absolute / divisor);
  const sub = absolute % divisor;

  const whole = group ? units.toLocaleString("en-GH") : String(units);
  const text = `${whole}.${String(sub).padStart(exponent, "0")}`;
  return symbol ? `${sign}${SYMBOLS[amount.currency] ?? ""}${text}` : `${sign}${text}`;
}

/** Parses what a person types into an amount field: "1,500", "1500.5", "GH₵1500". */
export function parseAmount(input: string, currency = "GHS"): Money | null {
  const cleaned = input.replace(/[^\d.-]/g, "");
  if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const exponent = EXPONENTS[currency] ?? 2;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return { minor: Math.round(value * 10 ** exponent), currency };
}

/**
 * A chart-axis abbreviation: "GH₵26k", "GH₵1.2m".
 *
 * Lives here rather than in the chart because money formatting has one home,
 * and the lint rule that sends every amount through this module is right: an
 * axis tick that rounds differently from the tooltip beside it is the same
 * class of bug as a receipt that disagrees with its emailed copy.
 *
 * Deliberately lossy, and only ever for an axis. Anything a person reads as
 * *the* number — a total, a tooltip, a receipt — uses `formatMoney`.
 */
export function abbreviateMoney(amount: Money): string {
  const exponent = EXPONENTS[amount.currency] ?? 2;
  const symbol = SYMBOLS[amount.currency] ?? "";
  const sign = amount.minor < 0 ? "-" : "";
  const units = Math.abs(amount.minor) / 10 ** exponent;

  if (units >= 1_000_000) {
    const millions = units / 1_000_000;
    const rounded = units >= 10_000_000 ? Math.round(millions) : Math.round(millions * 10) / 10;
    return `${sign}${symbol}${rounded.toLocaleString("en-GH")}m`;
  }
  if (units >= 1000) {
    return `${sign}${symbol}${Math.round(units / 1000).toLocaleString("en-GH")}k`;
  }
  return `${sign}${symbol}${Math.round(units).toLocaleString("en-GH")}`;
}
