import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Notice, Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";
import {
  bySoonest,
  matchesViewingFilter,
  placeOf,
  standing,
  viewingFilters,
  whenLabel,
  type ViewingFilter,
  type ViewingGroup,
} from "@/viewingMeaning";
import { listMyViewings, type Viewing } from "@/viewings";

/**
 * The tenant's schedule.
 *
 * A viewing is an appointment, not a status. So a row says the two things
 * somebody standing at a junction needs — where, and when — and everything the
 * lifecycle might allow at that moment lives one tap away.
 *
 * The old card carried the whole machine at once, on every row, forever: the
 * slot picker, the exact directions, the appointment history, the contact
 * number, the check-in button, the post-viewing follow-up, the attendance panel
 * and three quiet buttons. A tenant with three viewings read that machine three
 * times to find out what time to be somewhere.
 */
export default function ViewingsScreen() {
  const router = useRouter();
  const [viewings, setViewings] = useState<Viewing[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ViewingFilter>("all");

  const load = useCallback(async () => {
    try {
      setViewings(await listMyViewings());
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not load your viewings.",
      );
      setViewings([]);
    }
  }, []);

  // Confirming, cancelling and checking in all happen on the detail screen, so
  // the schedule has to be right when it comes back into view.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const rows = (viewings ?? []).map((viewing) => ({ viewing, state: standing(viewing) }));
  const sections: readonly {
    id: ViewingGroup;
    label: string;
    rows: typeof rows;
  }[] = [
    {
      id: "upcoming",
      label: "Upcoming",
      rows: rows
        .filter((row) => row.state.group === "upcoming")
        .sort((a, b) => bySoonest(a.viewing, b.viewing)),
    },
    { id: "action", label: "Needs you", rows: rows.filter((row) => row.state.group === "action") },
    { id: "past", label: "Past", rows: rows.filter((row) => row.state.group === "past") },
  ];
  const visibleSections = sections
    .filter((section) => matchesViewingFilter(section.id, filter))
    .filter((section) => section.rows.length > 0);
  const counts: Record<ViewingFilter, number> = {
    all: rows.length,
    upcoming: rows.filter((row) => row.state.group === "upcoming").length,
    action: rows.filter((row) => row.state.group === "action").length,
    past: rows.filter((row) => row.state.group === "past").length,
  };

  const open = (viewing: Viewing) =>
    router.push({ pathname: "/(app)/viewing/[id]", params: { id: viewing.id } });

  return (
    <ScrollView
      contentContainerStyle={{ padding: space[5], gap: space[5], paddingBottom: space[10] }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          tintColor={theme.color.kola["600"]}
        />
      }
    >
      {error ? <Notice tone="error" title={error} /> : null}

      {viewings === null ? (
        <Type variant="caption">Loading…</Type>
      ) : viewings.length === 0 ? (
        <View style={{ gap: space[2], paddingTop: space[6] }}>
          <Type variant="bodyStrong">No viewings yet</Type>
          <Type variant="caption">Ask to see a place and the landlord offers you times.</Type>
        </View>
      ) : (
        <>
          <ViewingFilters selected={filter} counts={counts} onSelect={setFilter} />

          {visibleSections.length ? (
            visibleSections.map((section) => (
              <Group
                key={section.id}
                heading={filter === "all" ? section.label : null}
                tone={section.id === "action" ? "action" : undefined}
              >
                {section.rows.map((row) => (
                  <Row key={row.viewing.id} {...row} onPress={() => open(row.viewing)} />
                ))}
              </Group>
            ))
          ) : (
            <ViewingFilterEmpty filter={filter} />
          )}
        </>
      )}
    </ScrollView>
  );
}

function ViewingFilters({ selected, counts, onSelect }: {
  selected: ViewingFilter;
  counts: Record<ViewingFilter, number>;
  onSelect: (filter: ViewingFilter) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -space[5] }}
      contentContainerStyle={{ paddingHorizontal: space[5] }}
      accessibilityRole="tablist"
    >
      <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
        {viewingFilters.map((option) => {
          const active = selected === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${option.label}, ${counts[option.id]} ${counts[option.id] === 1 ? "viewing" : "viewings"}`}
              onPress={() => onSelect(option.id)}
              {...pressableFeedback(theme.color.kola["50"])}
              style={{
                minHeight: 48,
                paddingHorizontal: space[3],
                flexDirection: "row",
                alignItems: "center",
                gap: space[2],
                borderBottomWidth: 2,
                borderBottomColor: active ? theme.color.kola["600"] : "transparent",
              }}
            >
              <Type variant="caption" style={{ color: active ? theme.color.kola["600"] : theme.color.ink["500"], fontWeight: active ? "700" : "500" }}>{option.label}</Type>
              <Type variant="label" style={{ color: active ? theme.color.kola["600"] : theme.color.ink["300"] }}>{counts[option.id]}</Type>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

function ViewingFilterEmpty({ filter }: { filter: ViewingFilter }) {
  const copy: Record<ViewingFilter, { title: string; body: string }> = {
    all: { title: "No viewings here", body: "Your viewing requests will appear here." },
    upcoming: { title: "No upcoming visits", body: "Confirmed visits and requests waiting for a time will appear here." },
    action: { title: "Nothing needs you", body: "You are up to date on every viewing." },
    past: { title: "No past viewings", body: "Completed and cancelled visits will remain available here." },
  };
  return (
    <View accessibilityRole="summary" style={{ gap: space[1], paddingVertical: space[6] }}>
      <Type variant="bodyStrong">{copy[filter].title}</Type>
      <Type variant="caption">{copy[filter].body}</Type>
    </View>
  );
}

function Group({
  heading,
  tone,
  children,
}: {
  heading: string | null;
  tone?: "action";
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: space[3] }}>
      {heading ? (
        <Type
          variant="label"
          accessibilityRole="header"
          style={tone === "action" ? { color: theme.color.kola["600"] } : undefined}
        >
          {heading.toUpperCase()}
        </Type>
      ) : null}
      {children}
    </View>
  );
}

const THUMB = 76;

/** Where, when, and one way in. Nothing else. */
function Row({
  viewing,
  state,
  onPress,
}: {
  viewing: Viewing;
  state: ReturnType<typeof standing>;
  onPress: () => void;
}) {
  const when = whenLabel(viewing.confirmed_starts_at);
  const act = state.group === "action";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${viewing.listing_headline}. ${placeOf(viewing)}. ${when ?? state.line}. ${state.callToAction ?? "View details"}.`}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={{
        flexDirection: "row",
        gap: space[3],
        paddingHorizontal: space[3],
        paddingVertical: space[4],
        borderBottomWidth: 1,
        borderBottomColor: theme.color.field["200"],
        backgroundColor: act ? theme.color.kola["50"] : "transparent",
      }}
    >
      <View
        style={{
          width: THUMB,
          height: Math.round((THUMB * 3) / 4),
          borderRadius: 8,
          backgroundColor: theme.color.field["100"],
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {viewing.photo_url ? (
          <Image
            source={{ uri: viewing.photo_url }}
            accessible={false}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
        ) : (
          <Ionicons name="image-outline" size={18} color={theme.color.ink["300"]} />
        )}
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Type variant="bodyStrong" numberOfLines={2}>{viewing.listing_headline}</Type>
        <Type variant="caption" numberOfLines={1}>{placeOf(viewing) || "Ghana"}</Type>
        {when ? (
          <Type variant="title2" style={{ marginTop: space[1] }}>{when}</Type>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], marginTop: 2 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: act
                ? theme.color.kola["600"]
                : state.group === "upcoming"
                  ? theme.color.kola["300"]
                  : theme.color.ink["300"],
            }}
          />
          <Type
            variant="caption"
            style={act ? { color: theme.color.kola["600"], fontWeight: "600" } : undefined}
          >
            {state.line}
          </Type>
        </View>
      </View>

      <Type variant="title2" style={{ alignSelf: "center", color: theme.color.ink["300"] }}>
        ›
      </Type>
    </Pressable>
  );
}
