import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";

import { Type, radius, space } from "@/components/ui";

import type { FeatureOption } from "@/propertyTypes";
import { theme } from "@/theme";

type Glyph = keyof typeof Ionicons.glyphMap;

/**
 * The same rows `PropertyTypeChoice` draws, for choices that are not the
 * letting categories: why the property is here, and — for a sale — what kind
 * of thing is being sold. The twin of the web `PurposeChoice.tsx`.
 */
function Rows({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string; holds: string; glyph: Glyph }[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: space[2] }}>
      <Type variant="caption" style={{ color: theme.color.ink["700"] }}>{label}</Type>
      <View style={{ gap: space[2] }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              aria-selected={selected}
              accessibilityLabel={`${option.label}. ${option.holds}.`}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space[3],
                minHeight: 60,
                paddingVertical: space[3] - 2,
                paddingHorizontal: space[3],
                borderRadius: radius.lg,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.color.kola["600"] : theme.color.field["200"],
                backgroundColor: selected ? theme.color.kola["50"] : theme.color.field["0"],
                opacity: pressed ? 0.82 : 1,
              })}
            >
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
                  name={option.glyph}
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
                  {option.label}
                </Type>
                <Type variant="caption" numberOfLines={2} style={{ fontSize: 13, lineHeight: 17 }}>
                  {option.holds}
                </Type>
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

/**
 * To let, or for sale — asked first, because it decides everything after it.
 * A property for sale is sold whole, takes no Units, and goes public by itself
 * once verified (owner, 2026-09-28). Fixed once the property exists.
 */
export function PurposeChoice({
  value,
  onChange,
}: {
  value: "letting" | "sale";
  onChange: (next: "letting" | "sale") => void;
}) {
  return (
    <Rows
      label="What are you doing with it?"
      value={value}
      onChange={(next) => onChange(next as "letting" | "sale")}
      options={[
        { value: "letting", label: "Letting it", holds: "Units, rooms or bed spaces, each let to a tenant", glyph: "key-outline" },
        { value: "sale", label: "Selling it", holds: "Sold whole, and public once it is verified", glyph: "pricetag-outline" },
      ]}
    />
  );
}

const SALE_GLYPH: Record<string, Glyph> = {
  residential: "home-outline",
  commercial: "storefront-outline",
  land: "map-outline",
};

const SALE_HOLDS: Record<string, string> = {
  residential: "Bedrooms and bathrooms",
  commercial: "Its use and floor area",
  land: "Its size, and a surveyed site plan",
};

/** What is being sold, from the backend's own sale vocabulary. */
export function SaleTypeChoice({
  types,
  value,
  onChange,
}: {
  types: FeatureOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Rows
      label="What are you selling?"
      value={value}
      onChange={onChange}
      options={types.map((type) => ({
        value: type.value,
        label: type.label,
        holds: SALE_HOLDS[type.value] ?? "",
        glyph: SALE_GLYPH[type.value] ?? "business-outline",
      }))}
    />
  );
}
