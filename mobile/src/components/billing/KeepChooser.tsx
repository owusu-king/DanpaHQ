import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";

import type { KeepActive, ResourceChoice } from "@/billing";
import {
  countLabel,
  keepPropertyNote,
  keptPropertyIds,
  propertiesNeedChoosing,
  propertyConsequence,
  propertyPlaces,
  unitConsequence,
  unitPlaces,
  unitsFor,
  unitsNeedChoosing,
  unitsOfKept,
} from "@/billingPresentation";
import { Type, radius, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * What stays fully active after a downgrade: the properties first, then — when
 * the ones kept hold more than the plan runs — their units.
 *
 * The web's chooser, for a thumb. It opens on the server's own selection, so the
 * documented fallback is shown, ticked, rather than applied unseen; and it asks
 * for a whole choice, so what the review says is exactly what happens.
 */
export function KeepChooser({
  plan,
  choice,
  keep,
  onKeep,
}: {
  plan: string;
  choice: ResourceChoice;
  keep: KeepActive;
  onKeep: (value: KeepActive) => void;
}) {
  const places = propertyPlaces(choice);
  const pickingProperties = propertiesNeedChoosing(choice);
  const kept = keptPropertyIds(choice, keep);
  const units = unitsOfKept(choice, kept);
  const unitRoom = unitPlaces(choice, kept);

  // Changing the properties carries the units along: ticked ones that still
  // apply stay ticked, and any room left fills in the server's order.
  const keepProperties = (property_ids: string[]) =>
    onKeep({
      property_ids,
      unit_ids: unitsFor(choice, keptPropertyIds(choice, { property_ids, unit_ids: [] }), keep.unit_ids),
    });

  return (
    <View style={{ gap: space[8] }}>
      {pickingProperties ? (
        <KeepSet
          using={`You're using ${countLabel(choice.properties.length, "Properties")}`}
          includes={`${plan} includes ${places}`}
          question={
            places === 1
              ? "Choose the property you want to keep fully active."
              : `Choose the ${places} properties you want to keep fully active.`
          }
          places={places}
          options={choice.properties.map((property) => ({
            id: property.id,
            label: property.title,
            note: keepPropertyNote(property),
          }))}
          chosen={keep.property_ids}
          onChoose={keepProperties}
          consequence={propertyConsequence(choice)}
        />
      ) : null}
      {unitsNeedChoosing(choice, kept) ? (
        <KeepSet
          using={
            pickingProperties
              ? `${kept.length === 1 ? "The property you keep has" : "The properties you keep have"} ${countLabel(units.length, "Units")}`
              : `You're using ${countLabel(units.length, "Units")}`
          }
          includes={`${plan} includes ${unitRoom}`}
          question={
            unitRoom === 1
              ? "Choose the unit you want to keep fully active."
              : `Choose the ${unitRoom} units you want to keep fully active.`
          }
          places={unitRoom}
          options={units.map((unit) => ({
            id: unit.id,
            label: unit.label,
            note: [kept.length > 1 ? unit.propertyTitle : "", unit.running ? "Tenancy in progress" : "No tenancy in progress"]
              .filter(Boolean)
              .join(" · "),
          }))}
          chosen={keep.unit_ids}
          onChoose={(unit_ids) => onKeep({ ...keep, unit_ids })}
          consequence={unitConsequence(choice, kept)}
        />
      ) : null}
    </View>
  );
}

/** One question: what the plan includes, the options, and what happens to the rest. */
function KeepSet({
  using,
  includes,
  question,
  places,
  options,
  chosen,
  onChoose,
  consequence,
}: {
  using: string;
  includes: string;
  question: string;
  places: number;
  options: { id: string; label: string; note: string }[];
  chosen: string[];
  onChoose: (ids: string[]) => void;
  consequence: string;
}) {
  // At the limit, the rest wait: a swap starts by unticking one.
  const atLimit = chosen.length >= places;
  const kind = places === 1 ? "radio" : "checkbox";
  return (
    <View style={{ gap: space[4] }}>
      <View style={{ gap: 2 }}>
        <Type variant="title2" accessibilityRole="header">
          {using}
        </Type>
        <Type variant="body" style={{ color: theme.color.ink["700"] }}>
          {includes}
        </Type>
      </View>
      {places > 0 ? (
        <View style={{ gap: space[2] }}>
          <Type variant="bodyStrong">{question}</Type>
          {places > 1 ? (
            <Type variant="caption" accessibilityLiveRegion="polite" style={{ fontVariant: ["tabular-nums"] }}>
              {`${chosen.length} of ${places} chosen`}
            </Type>
          ) : null}
          <View
            accessibilityRole={kind === "radio" ? "radiogroup" : undefined}
            style={{
              overflow: "hidden",
              borderWidth: 1,
              borderColor: theme.color.field["200"],
              borderRadius: radius.md,
            }}
          >
            {options.map((option, index) => {
              const checked = chosen.includes(option.id);
              return (
                <KeepRow
                  key={option.id}
                  kind={kind}
                  first={index === 0}
                  label={option.label}
                  note={option.note}
                  checked={checked}
                  disabled={kind === "checkbox" && !checked && atLimit}
                  onPress={() => {
                    if (kind === "radio") onChoose([option.id]);
                    else onChoose(checked ? chosen.filter((id) => id !== option.id) : [...chosen, option.id]);
                  }}
                />
              );
            })}
          </View>
        </View>
      ) : null}
      {consequence ? (
        <Type variant="body" style={{ color: theme.color.ink["700"] }}>
          {consequence}
        </Type>
      ) : null}
    </View>
  );
}

/**
 * A whole row to press, with a circle or a box that says whether it is kept.
 *
 * The mark keeps one size whether ticked or not, so a choice never nudges the
 * text beside it; and the state is carried by the role and a tick, not by colour.
 */
function KeepRow({
  kind,
  first,
  label,
  note,
  checked,
  disabled,
  onPress,
}: {
  kind: "radio" | "checkbox";
  first: boolean;
  label: string;
  note: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={kind}
      // Checked, for a radio as for a box: it is the state both announce.
      aria-checked={checked} aria-disabled={disabled}
      accessibilityLabel={`${label}. ${note}`}
      accessibilityHint={disabled ? "Untick one first to keep this instead" : undefined}
      disabled={disabled}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[4],
        paddingVertical: space[3],
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.color.field["200"],
        backgroundColor: checked ? theme.color.field["50"] : theme.color.field["0"],
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: kind === "radio" ? 11 : 5,
          borderWidth: checked ? 0 : 1.5,
          borderColor: theme.color.field["300"],
          backgroundColor: checked ? theme.color.kola["600"] : theme.color.field["0"],
        }}
      >
        {checked ? (
          kind === "radio" ? (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.field["0"] }} />
          ) : (
            <Ionicons name="checkmark" size={15} color={theme.color.field["0"]} />
          )
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Type variant="bodyStrong">{label}</Type>
        <Type variant="caption">{note}</Type>
      </View>
    </Pressable>
  );
}
