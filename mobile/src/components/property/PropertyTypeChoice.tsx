import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";

import { Type, radius, space } from "@/components/ui";
import { isAndroid } from "@/platform";
import type { PropertyTypeOption } from "@/propertyTypes";
import { theme } from "@/theme";

const GLYPH: Record<string, keyof typeof Ionicons.glyphMap> = {
  residential: "home-outline",
  commercial: "storefront-outline",
  hostel: "people-outline",
};

/**
 * What kind of property this is, as a choice rather than a list of chips.
 *
 * There are exactly three categories and this is the most consequential field
 * on the screen: it decides what may be *let* inside the property, which the
 * backend enforces through `space_rules`. `Choice` renders a wrapping row of
 * labels, which is right for a water source and wrong here — it can say
 * "Hostel" but not what choosing Hostel gets you.
 *
 * Each row says that from the API's own `space_types` rather than from copy
 * written here, so a change to the vocabulary reaches this screen without
 * anybody editing it, and nothing can describe a combination the backend would
 * refuse.
 *
 * The twin of `web/src/components/property/PropertyTypeChoice.tsx` in
 * information, not in markup: same question, same source, same three answers.
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
    <View accessibilityRole="radiogroup" accessibilityLabel="Kind of property" style={{ gap: space[2] }}>
      {/* No heading of its own: it stands under the group that names it, and a
          second label there was the same question asked twice. */}
      <Type variant="caption" style={{ color: theme.color.ink["700"] }}>Kind of property</Type>

      <View style={{ gap: space[2] }}>
        {types.map((type) => {
          const selected = type.value === value;
          return (
            <Pressable
              key={type.value}
              accessibilityRole="radio"
              aria-selected={selected}
              accessibilityLabel={`${type.label}. ${type.space_types.map((s) => s.label).join(", ")}.`}
              onPress={() => onChange(type.value)}
              android_ripple={isAndroid ? { color: theme.color.kola["50"] } : undefined}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space[3],
                minHeight: 60,
                paddingVertical: space[3] - 2,
                paddingHorizontal: space[3],
                borderRadius: radius.lg,
                // The ring is a second inset border rather than a thicker one,
                // so choosing does not move the row it is inside.
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.color.kola["600"] : theme.color.field["200"],
                backgroundColor: selected ? theme.color.kola["50"] : theme.color.field["0"],
                opacity: pressed && !isAndroid ? 0.82 : 1,
              })}
            >
              {/* A washed disc rather than a bare glyph: the row carries some
                  colour before it is chosen, not only after. */}
              <View
                style={{
                  width: 34,
                  height: 34,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 11,
                  backgroundColor: selected ? theme.color.kola["600"] : theme.color.kola["50"],
                }}
              >
                <Ionicons
                  name={GLYPH[type.value] ?? "business-outline"}
                  size={18}
                  color={selected ? theme.color.field["0"] : theme.color.kola["600"]}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                <Type
                  variant="bodyStrong"
                  numberOfLines={1}
                  style={{ fontSize: 15, lineHeight: 20, color: selected ? theme.color.kola["800"] : theme.color.ink["900"] }}
                >
                  {type.label}
                </Type>
                {type.space_types.length ? (
                  <Type variant="caption" numberOfLines={1} style={{ fontSize: 13, lineHeight: 17 }}>
                    {type.space_types.map((space_) => space_.label).join(" · ")}
                  </Type>
                ) : null}
              </View>
              {selected ? (
                <Ionicons name="checkmark-circle" size={20} color={theme.color.kola["600"]} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
