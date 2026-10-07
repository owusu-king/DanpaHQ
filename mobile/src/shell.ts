/**
 * Rooomly's shell: its green, an ivory page, and paper surfaces.
 *
 * Header, page and tab bar once stood on one beige (`field-100`, the token for
 * quiet fills), which read as plain. A pass that followed the tokens' letter —
 * ink chrome and a gold accent — read as dark and brown instead, and the product
 * owner asked for Rooomly's green, used harmoniously. So:
 *
 * - **The chrome is kola** (`kola-600`): the band behind the status bar and every
 *   header, with titles and glyphs in white and header controls as translucent
 *   white wells the green shows through.
 * - **The page is warm ivory** (`field-50`), and cards, sheets, inputs and the
 *   tab bar are paper (`field-0`), separated by hairlines first.
 * - **The tab you are on is kola too**: a pale kola indicator behind a deep kola
 *   glyph, with the other tabs in a muted kola rather than a brown grey.
 *
 * - **The two Homes are dashboards**: they stand on the chrome's green let down
 *   into the ivory, so their white cards lift by tone alone (`HomeGround`).
 */

import { DefaultTheme, type Theme } from "expo-router";

import { ph } from "@/components/home/plinth";
import { theme } from "@/theme";

/** A token at an opacity, so a tint stays the token it came from. */
export const alpha = (hex: string, opacity: number) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
};

export const shell = {
  /** The band behind the status bar and every header: Rooomly's green. */
  chrome: theme.color.kola["600"],
  /** A control on the chrome: a white well the green shows through. */
  chromeRaised: alpha(theme.color.field["0"], 0.14),
  chromePressed: alpha(theme.color.field["0"], 0.24),
  /** Titles and glyphs on the chrome. White reads at 6.5:1 on `kola-600`. */
  onChrome: theme.color.field["0"],
  /** Quieter type on the chrome. */
  onChromeMuted: alpha(theme.color.field["0"], 0.78),
  /** The mark's three o's on the chrome. */
  markOnChrome: theme.color.kola["50"],
  canvas: theme.color.field["50"],
  /** Where the two Homes stand: the chrome's green softened into the ivory. */
  dashboard: ph.ground,
  /**
   * Where a pushed record stands (owner, 2026-10-06): the same green at its
   * lightest, so a Unit, a Property or a Viewing reads as the same product as
   * the dashboards and lists it was opened from, not a flat ivory page.
   */
  record: ph.groundLow,
  /** Cards, sheets and inputs — and the tab bar. */
  paper: theme.color.field["0"],
  rule: theme.color.field["200"],
  /** The tab you are on: deep kola, 8:1 on its indicator and 9:1 on paper. */
  active: theme.color.kola["800"],
  /** The indicator behind the tab you are on. */
  activeGround: theme.color.kola["50"],
  /** Every other tab: kola's darkest shade muted to a green-grey, 5.4:1 on paper. */
  resting: alpha(theme.color.kola["900"], 0.72),
} as const;

/**
 * React Navigation's own surfaces in Rooomly's palette.
 *
 * Scenes, cards and anything else the navigators paint without being asked take
 * their colours from here, so a screen that sets no background stands on ivory
 * instead of on a default nobody chose.
 */
export const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: theme.color.kola["600"],
    background: shell.canvas,
    card: shell.chrome,
    text: theme.color.ink["900"],
    border: shell.rule,
    notification: theme.color.laterite["600"],
  },
};
