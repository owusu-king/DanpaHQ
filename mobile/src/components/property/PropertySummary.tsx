import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Pressable, View } from "react-native";

import { Type, radius, space } from "@/components/ui";

import type { Property } from "@/provider";
import { theme } from "@/theme";

const TYPE_LABEL: Record<string, string> = {
  residential: "Residential",
  commercial: "Commercial",
  hostel: "Hostel",
  land: "Land",
};

function value(raw: string): string | null {
  if (!raw || raw === "unknown") return null;
  return raw.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

/**
 * The property somebody just built, shown as a property.
 *
 * The review step listed step names against their status — "Photos: 2 of 5
 * added", "What the compound has: 3 recorded". Somebody had just photographed a
 * building, named it and said how its water arrives, and the last thing they
 * saw before pressing *Create property* was a progress table.
 *
 * Nothing here is new information. It is the same answers, arranged as the
 * record they add up to.
 *
 * The twin of `web/src/components/property/PropertySummary.tsx` in what it
 * says, not in markup.
 */
export function PropertySummary({
  property,
  onEdit,
}: {
  property: Property;
  /** Which step to open. Keys match `propertySetup`. */
  onEdit: (step: string) => void;
}) {
  const where = property.address
    ? [property.address.locality_name, property.address.district_name].filter(Boolean).join(", ")
    : null;

  const characteristics = [
    ["Water", value(property.water_source)],
    ["Power", value(property.power_meter_type)],
    ["Compound", value(property.compound_type)],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  // A sale shows its price and headline; land has no water, power, compound or
  // shared amenities to show, so those groups are not drawn for it.
  const selling = property.purpose === "sale";
  const land = selling && property.property_type === "land";

  return (
    <View
      style={{
        gap: space[4],
        padding: space[4],
        borderWidth: 1,
        borderColor: theme.color.field["200"],
        borderRadius: radius.lg,
        backgroundColor: theme.color.field["0"],
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[4] }}>
        <View
          style={{
            width: 96,
            aspectRatio: 4 / 3,
            borderRadius: radius.md,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.color.field["100"],
          }}
        >
          {property.cover_url ? (
            <Image
              source={{ uri: property.cover_url }}
              accessible={false}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          ) : (
            <Ionicons name="image-outline" size={22} color={theme.color.ink["300"]} />
          )}
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Type variant="title2" numberOfLines={2} style={{ fontSize: 18 }}>
            {property.title || "Untitled property"}
          </Type>
          <Type variant="label">
            {(TYPE_LABEL[property.property_type] ?? value(property.property_type) ?? "Property").toUpperCase()}
            {selling ? " · FOR SALE" : ""}
          </Type>
          {where ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
              <Ionicons name="location-outline" size={13} color={theme.color.ink["500"]} />
              <Type variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                {where}
              </Type>
            </View>
          ) : null}
        </View>
      </View>

      <View
        style={{
          gap: space[3],
          paddingTop: space[4],
          borderTopWidth: 1,
          borderTopColor: theme.color.field["200"],
        }}
      >
        {selling ? (
          <Group label="Sale" onEdit={() => onEdit("sale")}>
            {property.sale?.price_formatted ? (
              <Type variant="body" style={{ fontSize: 14 }}>
                <Type variant="bodyStrong" style={{ fontSize: 14 }}>{property.sale.price_formatted}</Type>
                {property.sale.headline ? ` · ${property.sale.headline}` : ""}
              </Type>
            ) : (
              <Type variant="caption">No price yet</Type>
            )}
          </Group>
        ) : null}

        {land ? null : (
        <Group label="Details" onEdit={() => onEdit("details")}>
          {characteristics.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              {characteristics.map(([label, text]) => (
                <View
                  key={label}
                  style={{
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: space[2],
                    paddingVertical: space[1],
                    paddingHorizontal: space[3],
                    borderRadius: radius.sm,
                    backgroundColor: theme.color.field["50"],
                  }}
                >
                  <Type variant="caption" style={{ fontSize: 12 }}>{label}</Type>
                  <Type variant="body" style={{ fontSize: 14 }}>{text}</Type>
                </View>
              ))}
            </View>
          ) : (
            <Type variant="caption">Not recorded yet</Type>
          )}
        </Group>
        )}

        {land ? null : (
        <Group label="Shared amenities" onEdit={() => onEdit("amenities")}>
          {property.amenities.length ? (
            <Type variant="body" style={{ fontSize: 14 }}>
              {property.amenities.map((amenity) => amenity.name).join(" · ")}
            </Type>
          ) : (
            <Type variant="caption">Nothing shared</Type>
          )}
        </Group>
        )}
      </View>
    </View>
  );
}

/** Edit sits beside the group it changes, not at the end of the screen. */
function Group({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <Type variant="label" style={{ flex: 1 }}>{label.toUpperCase()}</Type>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${label}`}
          onPress={onEdit}
          hitSlop={space[2]}
          style={({ pressed }) => ({
            minHeight: 32,
            justifyContent: "center",
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <Type variant="caption" style={{ color: theme.color.kola["600"], fontWeight: "600" }}>
            Edit
          </Type>
        </Pressable>
      </View>
      {children}
    </View>
  );
}
