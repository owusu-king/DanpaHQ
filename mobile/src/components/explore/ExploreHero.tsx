import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { HeaderChromeBackground } from "@/components/nav/HeaderChromeBackground";
import { Type, radius, space } from "@/components/ui";
import { pressableFeedback, safeHeaderTop } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

const WHITE = theme.color.field["0"];
const KOLA = theme.color.kola["600"];
const KOLA_DEEP = theme.color.kola["800"];
const GOLD = theme.color.gold["300"];

/** Everything, to rent, or to buy. Explore opens on everything. */
export type ExploreMode = "all" | "rent" | "buy";

/** The radius of the corners that flare out below the band. */
export const HERO_FLARE = 20;

/**
 * The top of Explore, as one piece (owner, 2026-09-29).
 *
 * It was four things stacked on two grounds: a green title band, then — on the
 * ivory page — a Rent/Buy pill, a search bar and a Filters button, and under
 * those a sentence and a count. Now the band carries everything that decides
 * *what* is shown — the page's name and its two shortcuts, the side of the
 * market, where, and the filters — on the same glass-green material as every
 * header. Below it, `ExploreResults` says what those choices produced, and the
 * cards follow. Rent and Buy share both, so switching sides changes the search
 * and never the frame.
 *
 * Its bottom corners curve the other way from a card's (owner, 2026-09-29):
 * the green runs straight across and flares out into the page at each side, so
 * the band reads as poured into the screen rather than set on top of it.
 *
 * The title always stays, and so does the full-width Rent/Buy switch: list
 * view and map view keep the same header (owner, 2026-09-29 — hiding the title
 * on scroll, and shrinking the switch to two small keys beside the search, both
 * made it unclear what the switch was). The room for the list comes from the
 * header being compact throughout.
 *
 * Inside the tabs it is the header too, reaching up under the status bar. As
 * the pushed `/search` route it sits under that route's own header, so it
 * drops the title row rather than naming the page twice.
 */
export function ExploreHero({
  inTabs,
  actions,
  mode,
  search,
  filterCount,
  onFilters,
}: {
  inTabs: boolean;
  /** Saved and profile, in the title row. Tabs only. */
  actions?: ReactNode;
  mode: ExploreMode;
  search: ReactNode;
  /** Every side has filters now; the first row of each sheet is Show (All / To rent / To buy). */
  filterCount: number;
  onFilters: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.hero, { paddingTop: inTabs ? safeHeaderTop(insets.top) : space[2] }]}>
      <HeaderChromeBackground edge={false} />

      {inTabs ? (
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Type accessibilityRole="header" variant="title1" maxFontSizeMultiplier={1.2} style={styles.title}>
              Explore
            </Type>
            <View style={styles.tagline}>
              <Ionicons name="shield-checkmark" size={11} color={GOLD} />
              <Type variant="caption" numberOfLines={1} maxFontSizeMultiplier={1.2} style={styles.taglineText}>
                {mode === "buy" ? "Verified properties for sale" : mode === "rent" ? "Verified rentals across Ghana" : "Verified places to rent and buy"}
              </Type>
            </View>
          </View>
            {actions}
        </View>
      ) : null}

      <View style={styles.controls}>
        {/* The All / Rent / Buy bar that stood above the search is gone (owner,
            2026-10-05): what to show is the first row of the Filters sheet. */}
        <View style={styles.searchRow}>
          <View style={{ flex: 1, minWidth: 0 }}>{search}</View>
          <FiltersButton count={filterCount} onPress={onFilters} />
        </View>
      </View>

      <Flare side="left" />
      <Flare side="right" />
    </View>
  );
}

/**
 * One corner that curves outward: the green filling the corner of a small
 * square below the band, with a quarter circle of whatever is beneath carved
 * out of it. Drawn, not masked, so it works over the map as well as the page.
 * The band's edges are its deepest green, so the flare takes that tone.
 */
function Flare({ side }: { side: "left" | "right" }) {
  const r = HERO_FLARE;
  const d = side === "left"
    ? `M0 0 H${r} A${r} ${r} 0 0 0 0 ${r} Z`
    : `M0 0 H${r} V${r} A${r} ${r} 0 0 0 0 0 Z`;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.flare, side === "left" ? { left: 0 } : { right: 0 }]}
    >
      <Svg width={r} height={r}>
        <Path d={d} fill={KOLA_DEEP} />
      </Svg>
    </View>
  );
}

/** The one way into every filter: white on the green, with a gold count when any is on. */
function FiltersButton({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `Filters, ${count} active` : "Filters"}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => [styles.filters, pressed ? { backgroundColor: theme.color.kola["50"] } : null]}
    >
      <Ionicons name="options-outline" size={16} color={KOLA} />
      {count ? (
        <View style={styles.badge}>
          <Type variant="label" style={styles.badgeText}>{count}</Type>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Where to look, as a white field on the green. The ring is drawn outside the
 * field in translucent white, so focusing moves nothing.
 */
export function HeroSearch({
  value,
  onChangeText,
  onClear,
  placeholder,
  label,
  icon = "search",
}: {
  value: string;
  onChangeText: (value: string) => void;
  onClear: () => void;
  placeholder: string;
  label: string;
  icon?: IconName;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View>
      {focused ? <View pointerEvents="none" style={styles.ring} /> : null}
      <View style={styles.field}>
        <Ionicons name={icon} size={15} color={KOLA} />
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={theme.color.ink["500"]}
          returnKeyType="search"
          // Place names are not dictionary words; autocorrect only mangles them.
          autoCorrect={false}
          clearButtonMode="never"
          maxFontSizeMultiplier={1.3}
          style={styles.input}
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={4}
            onPress={onClear}
            {...pressableFeedback(theme.color.field["200"])}
            style={({ pressed }) => [styles.clear, pressed ? { backgroundColor: theme.color.field["100"] } : null]}
          >
            <Ionicons name="close" size={14} color={theme.color.ink["700"]} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * What the search produced, at the top of the page it produced: a mark for the
 * side of the market, the count, where, and the one way to undo the filters.
 */
export function ExploreResults({
  mode,
  busy,
  line,
  detail,
  onClear,
  trailing,
}: {
  mode: ExploreMode;
  busy: boolean;
  line: string;
  detail?: string;
  onClear?: () => void;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.results}>
      <View style={styles.resultsMark}>
        {busy ? (
          <ActivityIndicator size="small" color={KOLA} />
        ) : (
          <Ionicons name={mode === "buy" ? "pricetags-outline" : mode === "rent" ? "home-outline" : "albums-outline"} size={15} color={KOLA_DEEP} />
        )}
      </View>
      <View style={styles.resultsBody}>
        <Type variant="bodyStrong" accessibilityLiveRegion="polite" numberOfLines={1} style={styles.resultsLine}>
          {line}
        </Type>
        {detail ? (
          <Type variant="caption" numberOfLines={1} style={styles.resultsDetail}>{detail}</Type>
        ) : null}
      </View>
      {onClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          hitSlop={6}
          onPress={onClear}
          {...pressableFeedback(theme.color.kola["50"])}
          style={({ pressed }) => [styles.clearAll, pressed ? { backgroundColor: theme.color.kola["50"] } : null]}
        >
          <Ionicons name="refresh" size={13} color={KOLA_DEEP} />
          <Type variant="captionStrong" style={{ color: KOLA_DEEP }}>Clear all</Type>
        </Pressable>
      ) : null}
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingBottom: space[2] + 2,
    backgroundColor: KOLA,
  },
  flare: {
    position: "absolute",
    top: "100%",
    width: HERO_FLARE,
    height: HERO_FLARE,
  },
  titleRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: space[5],
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: WHITE,
  },
  tagline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  taglineText: {
    fontSize: 11,
    lineHeight: 13,
    color: alpha(WHITE, 0.78),
  },
  controls: {
    gap: 6,
    paddingHorizontal: space[4],
    paddingTop: 6,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  ring: {
    position: "absolute",
    top: -3,
    right: -3,
    bottom: -3,
    left: -3,
    borderRadius: radius.pill,
    backgroundColor: alpha(WHITE, 0.32),
  },
  field: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingLeft: space[3] + 2,
    paddingRight: 3,
    borderRadius: radius.pill,
    backgroundColor: WHITE,
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    paddingVertical: 0,
    paddingRight: space[3],
    color: theme.color.ink["900"],
    fontSize: 14,
    fontWeight: "600",
    includeFontPadding: false,
  },
  clear: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: theme.color.field["50"],
  },
  filters: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: WHITE,
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: KOLA,
    backgroundColor: GOLD,
  },
  badgeText: {
    fontSize: 10.5,
    lineHeight: 12,
    letterSpacing: 0,
    color: theme.color.ink["950"],
  },
  results: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  resultsMark: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: theme.color.kola["50"],
  },
  resultsBody: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  resultsLine: {
    fontSize: 15,
    lineHeight: 20,
    color: theme.color.ink["900"],
  },
  resultsDetail: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.color.ink["500"],
  },
  clearAll: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.kola["300"],
  },
});
