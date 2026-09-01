import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { PlinthCard, ph, useHomeDensity } from "@/components/home/plinth";
import { Type, space } from "@/components/ui";
import type { UpcomingEntry } from "@/homeMeaning";

/**
 * What is still ahead.
 *
 * Read as one thing with the activity list below it, because both were plain
 * rows of two lines in identical type. They answer opposite questions, so they
 * are drawn as opposites: this one is **dated** — every row carries a date on a
 * left rail against a vertical rule, which is what a schedule looks like — and
 * the one below is **past tense**, with a relative time trailing at the end of
 * the line.
 *
 * Nothing in the list is a control. A tenant does not act on "rent due in nine
 * days" from a schedule; they read it and plan. The things that genuinely want
 * a decision are already in the attention panel above. The one control is the
 * way to viewings in the card's head, which is navigation rather than an
 * instruction about any single row.
 */
export function ComingUp({
  entries,
  onViewings,
}: {
  entries: UpcomingEntry[];
  onViewings: () => void;
}) {
  const density = useHomeDensity();

  return (
    <PlinthCard
      eyebrow="COMING UP"
      title="What happens next"
      action={{ label: "All viewings", onPress: onViewings }}
    >
      {entries.length ? (
        <View style={{ marginTop: density.compact ? 2 : space[1] }}>
          {entries.map((entry, index) => (
            <View
              key={entry.id}
              accessible
              accessibilityLabel={`${whenLabel(entry.when)}. ${entry.what}. ${entry.place}.`}
              style={{ flexDirection: "row", gap: density.compact ? space[2] : space[3] }}
            >
              {/* Wide enough for "Tomorrow" at this size. It truncated to
                  "Tomorr…" at 52, which is the one word on the rail a reader
                  should never have to reconstruct. */}
              <View style={{ width: density.veryCompact ? 58 : density.compact ? 64 : 70, paddingTop: density.compact ? 9 : 11 }}>
                <Type variant="bodyStrong" numberOfLines={1} style={{ fontSize: density.compact ? 11.5 : 12.5, lineHeight: 16, color: ph.ink }}>
                  {whenLabel(entry.when)}
                </Type>
                {/* The weekday, not the date again: for anything past tomorrow
                    the line above is already the date. */}
                <Type variant="caption" numberOfLines={1} style={{ fontSize: density.compact ? 9.75 : 10.75, lineHeight: 14, color: ph.ink38 }}>
                  {weekday(entry.when)}
                </Type>
              </View>

              {/* The rail. Continuous between rows, stopped at the last one, so
                  the group reads as a single run of time rather than as
                  separate items that happen to be stacked. */}
              <View style={{ alignItems: "center", width: 11 }}>
                <View style={{ width: 1, height: density.compact ? 11 : 13, backgroundColor: index === 0 ? "transparent" : ph.line }} />
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: index === 0 ? ph.gold : ph.paper,
                    borderWidth: index === 0 ? 0 : 1.5,
                    borderColor: ph.goldSoft,
                  }}
                />
                {index < entries.length - 1 ? (
                  <View style={{ flex: 1, width: 1, backgroundColor: ph.line }} />
                ) : null}
              </View>

              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  paddingTop: density.compact ? 8 : 10,
                  paddingBottom: index === entries.length - 1 ? 0 : density.compact ? 10 : 12,
                }}
              >
                <Type variant="bodyStrong" numberOfLines={1} style={{ fontSize: density.compact ? 12.5 : 13.5, lineHeight: 18, color: ph.ink }}>
                  {entry.what}
                </Type>
                <Type variant="caption" numberOfLines={1} style={{ fontSize: density.compact ? 10.5 : 11.5, lineHeight: 15, color: ph.ink55 }}>
                  {entry.place}
                </Type>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View
          style={{
            marginTop: space[1],
            paddingTop: density.compact ? space[3] : space[4],
            alignItems: "center",
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: ph.lineStrong,
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <Type variant="bodyStrong" style={{ fontSize: density.compact ? 12.25 : 13, lineHeight: 17, color: ph.ink }}>Nothing scheduled.</Type>
          <Type variant="caption" style={{ textAlign: "center", paddingHorizontal: space[3], fontSize: density.compact ? 11 : 12, lineHeight: 16, color: ph.ink55 }}>
            Rent dates and confirmed viewings appear here as they are set.
          </Type>
          {/* The empty state is the one place on this screen with room to
              spare, so it gets the thing the product is actually about, drawn
              the way the rest of the page is drawn. It carries no information,
              which is why it is hidden from the reader. */}
          <StreetElevation />
        </View>
      )}
    </PlinthCard>
  );
}

/** A drafted street elevation: hairlines, a ground line, one gold accent. */
function StreetElevation() {
  const density = useHomeDensity();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: "100%", marginTop: density.compact ? space[2] : space[3], opacity: 0.55 }}
    >
      <Svg width="100%" height={density.compact ? 46 : 54} viewBox="0 0 260 62" fill="none">
      <Path d="M0 61h260" stroke={ph.ink38} strokeWidth={1} />
      <Path d="M10 61V31h34v30M10 31h34" stroke={ph.ink38} strokeWidth={0.9} />
      <Path d="M18 39h8v9h-8zM30 39h8v9h-8z" stroke={ph.ink38} strokeWidth={0.6} />
      <Path d="M54 61V17l20-13 20 13v44M54 17h40" stroke={ph.ink38} strokeWidth={0.9} />
      <Path d="M62 26h9v10h-9zM77 26h9v10h-9z" stroke={ph.ink38} strokeWidth={0.6} />
      <Path d="M66 61V48h12v13" stroke={ph.ink38} strokeWidth={0.7} />
      <Path d="M104 61V37h30v24M104 37h30" stroke={ph.ink38} strokeWidth={0.9} />
      <Path d="M112 44h7v8h-7zM123 44h7v8h-7z" stroke={ph.ink38} strokeWidth={0.6} />
      {/* the gold one: a home of one's own */}
      <Path d="M146 61V25l17-11 17 11v36M146 25h34" stroke={ph.gold} strokeWidth={1} />
      <Path d="M154 33h8v9h-8zM168 33h8v9h-8z" stroke={ph.gold} strokeWidth={0.7} />
      <Path d="M157 61V50h12v11" stroke={ph.gold} strokeWidth={0.8} />
      <Path d="M190 61V33h28v28M190 33h28" stroke={ph.ink38} strokeWidth={0.9} />
      <Path d="M197 41h7v8h-7zM208 41h7v8h-7z" stroke={ph.ink38} strokeWidth={0.6} />
      {/* a dimension, with its ticks */}
      <Path d="M238 9v52M234 9h8M234 61h8M236 22h4M236 35h4M236 48h4" stroke={ph.ink38} strokeWidth={0.6} />
      </Svg>
    </View>
  );
}

/** The day of the week, so the rail's second line is never the first repeated. */
function weekday(value: string): string {
  const parsed = new Date(value.length <= 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleDateString("en-GH", { weekday: "short" });
}

/** "Today", "Tomorrow", or a short date. A schedule reads in days, not stamps. */
function whenLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(parsed) - start(new Date())) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return parsed.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}
