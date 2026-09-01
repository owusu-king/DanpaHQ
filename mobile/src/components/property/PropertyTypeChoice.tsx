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
    <View accessibilityRole="radiogroup" style={{ gap: space[2] }}>
      <Type variant="label">WHAT KIND OF PROPERTY IS THIS?</Type>
      <Type variant="caption">It decides what you can let inside it.</Type>

      <View style={{ gap: space[2], marginTop: space[1] }}>
        {types.map((type) => {
          const selected = type.value === value;
          return (
            <Pressable
              key={type.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${type.label}. ${type.space_types.map((s) => s.label).join(", ")}.`}
              onPress={() => onChange(type.value)}
              android_ripple={isAndroid ? { color: theme.color.kola["50"] } : undefined}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space[3],
                minHeight: 64,
                paddingVertical: space[3],
                paddingHorizontal: space[4],
                borderRadius: radius.lg,
                // The ring is a second inset border rather than a thicker one,
                // so choosing does not move the row it is inside.
                borderWidth: 1,
                borderColor: selected ? theme.color.kola["600"] : theme.color.field["200"],
                backgroundColor: selected ? theme.color.kola["50"] : theme.color.field["0"],
                opacity: pressed && !isAndroid ? 0.82 : 1,
              })}
            >
              <Ionicons
                name={GLYPH[type.value] ?? "business-outline"}
                size={22}
                color={selected ? theme.color.kola["600"] : theme.color.ink["500"]}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Type
                  variant="bodyStrong"
                  style={{ fontSize: 15, color: selected ? theme.color.kola["600"] : theme.color.ink["900"] }}
                >
                  {type.label}
                </Type>
                {type.space_types.length ? (
                  <Type variant="caption" numberOfLines={2} style={{ fontSize: 13 }}>
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
