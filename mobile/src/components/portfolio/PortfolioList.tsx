import Ionicons from "@expo/vector-icons/Ionicons";
import { Fragment, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, TextInput, View, type ImageSourcePropType } from "react-native";

import { useHomeDensity } from "@/components/home/plinth";
import { Type, radius, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { isAndroid, maxFontSizeMultiplier, pressableFeedback } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * What a Portfolio list page is made of.
 *
 * Payments and Tenants are the same kind of page: a few figures, anything that
 * needs a decision, then one list that can be searched and filtered. They are
 * built from these parts so the two read as one product and cannot drift — the
 * glass, the one Filter control and its sheet, rows that never cut a figure
 * short, notes and empty states. What each page lists, and what its rows say, is
 * the page's own.
 */

export type IconName = keyof typeof Ionicons.glyphMap;

export const WHITE = theme.color.field["0"];
export const DEEP = theme.color.kola["900"];
export const INK = theme.color.ink["900"];
export const KOLA = theme.color.kola["600"];
export const KOLA_DEEP = theme.color.kola["800"];
export const LATERITE = theme.color.laterite["600"];
export const HARMATTAN = theme.color.harmattan["600"];
export const LAGOON = theme.color.lagoon["600"];

/** Frosted glass on the hub ground, settled by a line in its own green. */
export const GLASS = alpha(WHITE, 0.72);
export const EDGE = alpha(DEEP, 0.08);
export const RULE = alpha(DEEP, 0.08);
export const PRESSED = alpha(DEEP, 0.04);
/** Secondary words and figures' names, dark enough to read on glass. */
export const MUTED = alpha(INK, 0.7);
/** The quietest words — a method and a date, a fee — still at 4.5:1 on glass. */
export const FAINT = alpha(INK, 0.62);
export const LABEL = alpha(DEEP, 0.76);
export const CHEVRON = alpha(DEEP, 0.34);
export const PANEL_RADIUS = 16;

export type SummaryNote = { text: string; tone: "alert" | "calm" };

/**
 * The page's figures, in one panel. One figure leads, with a line under it that
 * is part of it; the rest sit side by side, because they are different facts.
 */
export function SummaryPanel({
  label,
  value,
  note,
  facts,
}: {
  label: string;
  value: string;
  note: SummaryNote;
  facts: { label: string; value: string }[];
}) {
  const density = useHomeDensity();
  const alert = note.tone === "alert";
  return (
    <View style={[styles.panel, styles.summary, isAndroid ? null : styles.lift]}>
      <View accessible accessibilityLabel={`${label}, ${value}. ${note.text}.`} style={{ gap: 2 }}>
        <Type variant="caption" style={styles.figureLabel}>{label}</Type>
        <Type
          variant="amountLg"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={{ fontSize: density.compact ? 27 : 30, lineHeight: density.compact ? 33 : 36, letterSpacing: -0.5, color: INK }}
        >
          {value}
        </Type>
        <View style={styles.noteLine}>
          <View style={[styles.dot, { backgroundColor: alert ? LATERITE : alpha(INK, 0.28) }]} />
          <Type variant="captionStrong" style={{ fontSize: 13, lineHeight: 18, color: alert ? LATERITE : MUTED }}>
            {note.text}
          </Type>
        </View>
      </View>
      <View style={styles.summaryRule} />
      <View style={styles.summaryFacts}>
        {facts.map((fact, index) => (
          <Fragment key={fact.label}>
            {index ? <View style={styles.factDivider} /> : null}
            <Figure label={fact.label} value={fact.value} />
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/** A figure and its name, read as one. */
export function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.figure}>
      <Type variant="caption" numberOfLines={1} style={styles.figureLabel}>{label}</Type>
      <Type variant="bodyStrong" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.figureValue}>{value}</Type>
    </View>
  );
}

/** Figures that belong together, two to a row, in one glass panel. */
export function FigureGrid({ figures }: { figures: { label: string; value: string }[] }) {
  return (
    <View style={[styles.panel, styles.figures]}>
      {figures.map((figure) => (
        <Figure key={figure.label} label={figure.label} value={figure.value} />
      ))}
    </View>
  );
}

/** A group's name, standing on the ground, with a count when one helps. */
export function GroupLabel({ children, count, tone }: { children: string; count?: number; tone?: string }) {
  return (
    <View style={styles.groupLabelRow}>
      <Type variant="label" accessibilityRole="header" style={[styles.groupLabel, tone ? { color: tone } : null]}>{children.toUpperCase()}</Type>
      {count !== undefined ? <Type variant="label" style={styles.groupCount}>{count}</Type> : null}
    </View>
  );
}

export type Signal = {
  key: string;
  icon: IconName;
  tone: string;
  wash: string;
  title: string;
  /** Said only when it is an instruction; everything else goes straight there. */
  detail?: string;
  hint?: string;
  onPress: () => void;
};

/**
 * What needs a decision, as one panel of rows that each go straight to it. Named
 * when it gathers different kinds of decision; a single row says enough itself.
 */
export function SignalPanel({ title, signals }: { title?: string; signals: Signal[] }) {
  if (!signals.length) return null;
  return (
    <View style={{ gap: space[2] }}>
      {title ? <GroupLabel>{title}</GroupLabel> : null}
      <View style={[styles.panel, styles.clip]}>
        {signals.map((signal, index) => (
          <Pressable
            key={signal.key}
            accessibilityRole="button"
            accessibilityLabel={signal.detail ? `${signal.title}. ${signal.detail}.` : `${signal.title}.`}
            accessibilityHint={signal.hint}
            onPress={signal.onPress}
            {...pressableFeedback(PRESSED)}
            style={({ pressed }) => [styles.signal, index ? styles.ruled : null, pressed && !isAndroid ? { backgroundColor: PRESSED } : null]}
          >
            <View style={[rowStyles.well, { backgroundColor: signal.wash }]}>
              <Ionicons name={signal.icon} size={16} color={signal.tone} />
            </View>
            <View style={rowStyles.rowBody}>
              <Type variant="bodyStrong" style={rowStyles.rowTitle}>{signal.title}</Type>
              {signal.detail ? <Type variant="caption" style={rowStyles.rowSub}>{signal.detail}</Type> : null}
            </View>
            <Ionicons name="chevron-forward" size={15} color={CHEVRON} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Something to know, not to do: a glass note with its colour in the glyph. */
export function InfoNote({ tone, icon, title, body }: { tone: "lagoon" | "laterite"; icon: IconName; title: string; body?: string }) {
  const palette = tone === "laterite"
    ? { ink: LATERITE, wash: theme.color.laterite["100"] }
    : { ink: LAGOON, wash: theme.color.lagoon["100"] };
  return (
    <View
      accessible
      accessibilityRole={tone === "laterite" ? "alert" : "summary"}
      accessibilityLabel={body ? `${title}. ${body}` : title}
      style={[styles.panel, styles.note]}
    >
      <View style={[rowStyles.well, { backgroundColor: palette.wash }]}>
        <Ionicons name={icon} size={16} color={palette.ink} />
      </View>
      <View style={rowStyles.rowBody}>
        <Type variant="bodyStrong" style={styles.noteTitle}>{title}</Type>
        {body ? <Type variant="caption" style={rowStyles.rowSub}>{body}</Type> : null}
      </View>
    </View>
  );
}

/** A sentence that qualifies the figures above it, quietly. */
export function Footnote({ children }: { children: ReactNode }) {
  return <Type variant="caption" style={styles.footnote}>{children}</Type>;
}

/** The list's name and how many it holds, beside the one way into every filter. */
export function ListHead({ title, count, filters, filterTone, onFilter }: { title: string; count: number; filters: number; filterTone?: FilterTone; onFilter: () => void }) {
  return (
    <View style={styles.listHead}>
      <View style={styles.listTitle}>
        <Type variant="title2" accessibilityRole="header" numberOfLines={1} style={styles.listTitleText}>{title}</Type>
        <Type variant="caption" style={styles.listCount}>{count}</Type>
      </View>
      <FilterButton count={filters} tone={filterTone} onPress={onFilter} />
    </View>
  );
}

/**
 * Glass beside figures that lead the page; kola where the list is the page and
 * the control should be found at a glance (Leases, 2026-09-15).
 */
export type FilterTone = "glass" | "kola";

/** The one way into every filter, carrying the count of what is on. */
export function FilterButton({ count, tone = "glass", onPress }: { count: number; tone?: FilterTone; onPress: () => void }) {
  const active = count > 0;
  const kola = tone === "kola";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={active ? `Filter, ${count} active` : "Filter"}
      hitSlop={space[1]}
      onPress={onPress}
      {...pressableFeedback(kola ? alpha(WHITE, 0.24) : theme.color.kola["50"])}
      style={({ pressed }) => [
        styles.filterButton,
        kola ? styles.filterButtonKola : active ? styles.filterButtonActive : null,
        pressed && !isAndroid ? { opacity: 0.8 } : null,
      ]}
    >
      <Ionicons name="options-outline" size={16} color={kola ? WHITE : active ? KOLA_DEEP : MUTED} />
      <Type variant="captionStrong" style={{ fontSize: 13.5, lineHeight: 18, color: kola ? WHITE : active ? KOLA_DEEP : INK }}>Filter</Type>
      {active ? (
        <View style={[styles.filterBadge, kola ? styles.filterBadgeKola : null]}>
          <Type variant="captionStrong" style={[styles.filterBadgeText, kola ? { color: KOLA_DEEP } : null]}>{count}</Type>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The one thing a list is for making.
 *
 * A list of what you own has a creative act, and it is not the same weight as
 * a control that narrows what is already there. Drawn in full kola with white
 * ink: an outlined pill on the green ground reads as unfinished, which is what
 * it looked like when this was a `QuietAction`.
 */
export function PrimaryAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={isAndroid ? { color: alpha(WHITE, 0.24) } : undefined}
      style={({ pressed }) => [styles.primaryAction, pressed && !isAndroid ? { opacity: 0.9 } : null]}
    >
      <Ionicons name={icon} size={17} color={WHITE} />
      <Type variant="bodyStrong" numberOfLines={1} style={styles.primaryActionText}>{label}</Type>
    </Pressable>
  );
}

/** What is on, said once, with the way to take it off. */
export function ActiveFilter({ label, tone, onClear }: { label: string; tone: string; onClear: () => void }) {
  return (
    <View style={{ flexDirection: "row" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Clear filter: ${label}`}
        hitSlop={space[2]}
        onPress={onClear}
        {...pressableFeedback(theme.color.kola["50"])}
        style={({ pressed }) => [styles.token, pressed && !isAndroid ? { opacity: 0.8 } : null]}
      >
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Type variant="captionStrong" style={{ fontSize: 13, lineHeight: 18, color: KOLA_DEEP }}>{label}</Type>
        <Ionicons name="close" size={14} color={KOLA_DEEP} />
      </Pressable>
    </View>
  );
}

export function SearchField({ label, placeholder, value, onChangeText }: { label: string; placeholder: string; value: string; onChangeText: (value: string) => void }) {
  return (
    <View style={[styles.panel, styles.search]}>
      <Ionicons name="search-outline" size={16} color={FAINT} />
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        returnKeyType="search"
        autoCorrect={false}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        placeholderTextColor={alpha(INK, 0.45)}
        selectionColor={KOLA}
        cursorColor={KOLA}
        style={styles.searchInput}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={space[2]} onPress={() => onChangeText("")}>
          <Ionicons name="close-circle" size={17} color={FAINT} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A secondary act beside a list, quiet glass with kola words. */
export function QuietAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => [styles.quietAction, pressed && !isAndroid ? { opacity: 0.8 } : null]}
    >
      <Ionicons name={icon} size={16} color={KOLA} />
      <Type variant="captionStrong" style={{ fontSize: 13.5, lineHeight: 18, color: KOLA_DEEP }}>{label}</Type>
    </Pressable>
  );
}

/**
 * A row's frame. The rows of one list read as one glass panel: the first and
 * the last carry its corners, and the separators between them are glass too.
 */
export function ListRow({ first, last, children }: { first: boolean; last: boolean; children: ReactNode }) {
  return <View style={[styles.rowFrame, first ? styles.rowFirst : null, last ? styles.rowLast : null]}>{children}</View>;
}

export function RowSeparator() {
  return (
    <View style={styles.separatorFrame}>
      <View style={styles.separator} />
    </View>
  );
}

/**
 * One line of a row: what it is on the left, and how much or how it stands on the
 * right. The right never gives way, so an amount or a status is never cut short;
 * the words on the left take whatever width is left.
 */
export function RowLine({ start, end }: { start: ReactNode; end?: ReactNode }) {
  return (
    <View style={styles.line}>
      <View style={styles.lineStart}>{start}</View>
      {end ? <View style={styles.lineEnd}>{end}</View> : null}
    </View>
  );
}

/**
 * An empty list: what is missing, and the way on when there is one.
 *
 * Where the whole page is empty (`hero`), the glyph sits large in a white disc.
 * The disc can also carry a small animation (`art`), whose own light ground
 * reads as part of it — no animation ships yet; the asset and its licence are
 * the product owner's call. Anybody who has asked for less motion gets the still
 * glyph instead: an animation that ignores that setting is not decoration.
 */
export function EmptyState({
  icon,
  art,
  hero = false,
  title,
  hint,
  action,
}: {
  icon: IconName;
  art?: ImageSourcePropType;
  hero?: boolean;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const disc = hero || Boolean(art);
  return (
    <View style={styles.empty}>
      {disc ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.artDisc, isAndroid ? null : styles.lift]}
        >
          {art && !reduceMotion ? (
            <Image source={art} resizeMode="contain" style={styles.art} />
          ) : (
            <Ionicons name={icon} size={36} color={KOLA} />
          )}
        </View>
      ) : (
        <View style={styles.emptyWell}>
          <Ionicons name={icon} size={20} color={KOLA} />
        </View>
      )}
      <Type variant="bodyStrong" style={{ color: INK, textAlign: "center" }}>{title}</Type>
      {hint ? <Type variant="caption" style={{ color: MUTED, textAlign: "center" }}>{hint}</Type> : null}
      {action}
    </View>
  );
}

/** Initials rather than a silhouette: a stranger's outline says less than a name. */
export function initialsOf(name: string) {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

/** A place's photograph, square on glass, with a quiet glyph when there is none. */
export function Thumb({ uri, size = 60 }: { uri: string | null; size?: number }) {
  return (
    <View style={[styles.thumb, { width: size, height: size }]}>
      {uri ? (
        <Image source={{ uri }} accessible={false} resizeMode="cover" style={styles.thumbImage} />
      ) : (
        <Ionicons name="image-outline" size={18} color={CHEVRON} />
      )}
    </View>
  );
}

/** A group of answers in the filter sheet: its name, then its choices as radios. */
export function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.filterGroup}>
      <GroupLabel>{title}</GroupLabel>
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.choices}>
        {children}
      </View>
    </View>
  );
}

export function ChoiceRow({
  first,
  icon,
  tone,
  label,
  count,
  selected,
  onPress,
}: {
  first: boolean;
  icon?: IconName;
  tone?: string;
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-selected={selected}
      accessibilityLabel={`${label}, ${count}`}
      onPress={onPress}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => [styles.choice, first ? null : styles.ruled, selected ? styles.choiceChosen : null, pressed && !isAndroid ? { opacity: 0.8 } : null]}
    >
      {icon ? (
        <Ionicons name={icon} size={17} color={selected ? KOLA : FAINT} />
      ) : (
        <View style={[styles.dot, { backgroundColor: tone ?? alpha(INK, 0.22) }]} />
      )}
      <Type variant={selected ? "bodyStrong" : "body"} style={[styles.choiceLabel, selected ? { color: KOLA_DEEP } : null]}>{label}</Type>
      <Type variant="caption" style={styles.choiceCount}>{count}</Type>
      <View style={styles.choiceCheck}>
        {selected ? <Ionicons name="checkmark" size={18} color={KOLA} /> : null}
      </View>
    </Pressable>
  );
}

/** The sheet's foot: Reset when there is something to reset, and what it will show. */
export function SheetFooter({ canReset, onReset, results, onShow }: { canReset: boolean; onReset: () => void; results: number; onShow: () => void }) {
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reset filter"
        aria-disabled={!canReset}
        disabled={!canReset}
        onPress={onReset}
        hitSlop={space[1]}
        style={({ pressed }) => [styles.reset, pressed && !isAndroid ? { opacity: 0.72 } : null]}
      >
        <Type variant="bodyStrong" style={{ color: canReset ? KOLA_DEEP : theme.color.ink["300"] }}>Reset</Type>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Show ${results} ${results === 1 ? "result" : "results"}`}
        onPress={onShow}
        android_ripple={isAndroid ? { color: alpha(WHITE, 0.2) } : undefined}
        style={({ pressed }) => [styles.show, pressed && !isAndroid ? { opacity: 0.9 } : null]}
      >
        <Type variant="bodyStrong" style={{ color: WHITE }}>Show {results} {results === 1 ? "result" : "results"}</Type>
      </Pressable>
    </>
  );
}

/** How a row says what it is: the same measures on every Portfolio list. */
export const rowStyles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  well: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
  },
  rowSub: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  rowMeta: {
    fontSize: 12,
    lineHeight: 16,
    color: FAINT,
  },
  rowAmount: {
    fontSize: 15,
    lineHeight: 20,
    color: INK,
    fontVariant: ["tabular-nums"],
  },
  rowStatus: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: "600",
    textAlign: "right",
  },
});

const styles = StyleSheet.create({
  panel: {
    borderRadius: PANEL_RADIUS,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: EDGE,
  },
  clip: {
    overflow: "hidden",
  },
  // A whisper of green shadow under the figures, off Android, where elevation
  // smudges through a translucent fill.
  lift: {
    shadowColor: DEEP,
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  summary: {
    padding: space[4],
    gap: space[3],
  },
  noteLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    marginTop: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: RULE,
  },
  summaryFacts: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: space[4],
  },
  factDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: RULE,
  },
  figures: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  figure: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 0,
    gap: 2,
  },
  figureLabel: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  figureValue: {
    fontSize: 16,
    lineHeight: 22,
    color: INK,
  },
  groupLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[2],
    paddingHorizontal: space[1],
  },
  groupLabel: {
    color: LABEL,
  },
  groupCount: {
    color: MUTED,
  },
  signal: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingVertical: space[2],
    paddingHorizontal: 14,
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  noteTitle: {
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  footnote: {
    paddingHorizontal: space[1],
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  listHead: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    paddingLeft: space[1],
  },
  listTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[2],
  },
  listTitleText: {
    flexShrink: 1,
    fontSize: 17.5,
    lineHeight: 23,
    letterSpacing: -0.2,
    color: INK,
  },
  listCount: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  filterButton: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  filterButtonActive: {
    borderColor: alpha(KOLA, 0.4),
    backgroundColor: theme.color.kola["50"],
  },
  filterBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: KOLA,
  },
  filterBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    color: WHITE,
  },
  token: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: alpha(KOLA, 0.3),
    backgroundColor: theme.color.kola["50"],
  },
  search: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    alignSelf: "stretch",
    fontSize: 15,
    color: INK,
    outlineWidth: 0,
  },
  quietAction: {
    minHeight: 40,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
  },
  rowFrame: {
    backgroundColor: GLASS,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: EDGE,
    overflow: "hidden",
  },
  rowFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: PANEL_RADIUS,
    borderTopRightRadius: PANEL_RADIUS,
  },
  rowLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: PANEL_RADIUS,
    borderBottomRightRadius: PANEL_RADIUS,
  },
  separatorFrame: {
    backgroundColor: GLASS,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: EDGE,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
    backgroundColor: RULE,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  lineStart: {
    flex: 1,
    minWidth: 0,
  },
  lineEnd: {
    flexShrink: 0,
    maxWidth: "62%",
    alignItems: "flex-end",
  },
  empty: {
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[8],
  },
  emptyWell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["50"],
  },
  artDisc: {
    width: 104,
    height: 104,
    marginBottom: space[2],
    borderRadius: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: WHITE,
  },
  art: {
    width: 72,
    height: 72,
  },
  thumb: {
    overflow: "hidden",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: EDGE,
    backgroundColor: alpha(DEEP, 0.06),
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  filterButtonKola: {
    borderColor: KOLA,
    backgroundColor: KOLA,
  },
  filterBadgeKola: {
    backgroundColor: WHITE,
  },
  filterGroup: {
    gap: space[2],
    paddingTop: space[4],
    paddingBottom: space[1],
  },
  choices: {
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.color.field["200"],
    backgroundColor: theme.color.field["50"],
  },
  choice: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
  },
  choiceChosen: {
    backgroundColor: theme.color.kola["50"],
  },
  choiceLabel: {
    flex: 1,
    minWidth: 0,
    color: INK,
  },
  choiceCount: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
    fontVariant: ["tabular-nums"],
  },
  choiceCheck: {
    width: 18,
    alignItems: "center",
  },
  reset: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: space[3],
  },
  show: {
    flex: 1,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: KOLA,
  },
  primaryAction: {
    minHeight: 48,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    backgroundColor: KOLA,
  },
  primaryActionText: {
    fontSize: 15,
    lineHeight: 20,
    color: WHITE,
  },
});
