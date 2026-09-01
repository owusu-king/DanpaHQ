/* Test-only JS mirror of money.ts, kept in step by src/lib/money.test.mjs.
   Node runs .mjs with no build step; money.ts is the file that ships. */
const EXPONENTS = { GHS: 2, USD: 2 };
const SYMBOLS = { GHS: "GH\u20b5", USD: "$" };

export function formatMoney(amount, options = {}) {
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

export function parseAmount(input, currency = "GHS") {
  const cleaned = input.replace(/[^\d.-]/g, "");
  if (!cleaned || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const exponent = EXPONENTS[currency] ?? 2;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return { minor: Math.round(value * 10 ** exponent), currency };
}
