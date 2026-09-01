import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  applicationBucket,
  applicationFilters,
  matchesApplicationFilter,
  placeOf,
  shortfallNote,
  standing,
  type ApplicationBucket,
  type ApplicationFilter,
  type ApplicationStanding,
} from "@/applicationMeaning";
import { listMyApplications, type RentalApplication } from "@/applications";
import { StandingLine } from "@/components/applications/StandingLine";
import { Notice, Type, space } from "@/components/ui";
import { listMyLeases, type Lease } from "@/leases";
import { timeAgo } from "@/notifications";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * Places this person has applied for.
 *
 * Four questions in one glance: where did I apply, where does it stand, is
 * anything needed from me, and what happens next. The photograph answers the
 * first, and `standing()` collapses the other three into one line — so a row
 * never carries a status word *and* a sentence explaining that status word,
 * which is what the old cards did.
 *
 * What the tenant themselves wrote — the advance, the guarantor, the message —
 * is in the record behind the row. Nobody scanning five applications is
 * re-reading their own occupation.
 */
export default function ApplicationsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<RentalApplication[] | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ApplicationFilter>("all");

  const load = useCallback(async () => {
    try {
      // Acceptance is not the end of the story and the story lives in the
      // lease, so the agreements the tenant can already read are joined in.
      const [applications, myLeases] = await Promise.all([
        listMyApplications(),
        listMyLeases().catch(() => [] as Lease[]),
      ]);
      setItems(applications);
      setLeases(myLeases);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not load your applications.",
      );
      setItems([]);
    }
  }, []);

  // Withdrawing happens on the record screen, so the list has to be right when
  // it comes back into view.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const rows = (items ?? []).map((application) => ({
    application,
    state: standing(application, leases),
    bucket: applicationBucket(application, leases),
  }));
  const sections: readonly {
    id: ApplicationBucket;
    label: string;
    rows: typeof rows;
  }[] = [
    { id: "action", label: "Needs you", rows: rows.filter((row) => row.bucket === "action") },
    { id: "open", label: "In progress", rows: rows.filter((row) => row.bucket === "open") },
    { id: "approved", label: "Approved", rows: rows.filter((row) => row.bucket === "approved") },
    { id: "past", label: "Past", rows: rows.filter((row) => row.bucket === "past") },
  ];
  const visibleSections = sections
    .filter((section) => matchesApplicationFilter(section.id, filter))
    .filter((section) => section.rows.length > 0);
  const counts: Record<ApplicationFilter, number> = {
    all: rows.length,
    action: rows.filter((row) => row.bucket === "action").length,
    open: rows.filter((row) => row.bucket === "open").length,
    approved: rows.filter((row) => row.bucket === "approved").length,
    past: rows.filter((row) => row.bucket === "past").length,
  };

  const open = (application: RentalApplication) =>
    router.push({ pathname: "/(app)/application/[id]", params: { id: application.id } });

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

      {items === null ? (
        <ApplicationSkeleton />
      ) : items.length === 0 ? (
        <View style={{ gap: space[2], paddingTop: space[6] }}>
          <Type variant="bodyStrong">No applications yet</Type>
          <Type variant="caption">
            Applying puts you in front of the landlord with your checks already attached.
          </Type>
        </View>
      ) : (
        <>
          <ApplicationFilters selected={filter} counts={counts} onSelect={setFilter} />

          {visibleSections.length ? (
            visibleSections.map((section) => (
              <Group
                key={section.id}
                heading={filter === "all" ? section.label : null}
                tone={section.id === "action" ? "action" : undefined}
              >
                {section.rows.map((row) => (
                  <Row key={row.application.id} {...row} onPress={() => open(row.application)} />
                ))}
              </Group>
            ))
          ) : (
            <ApplicationFilterEmpty filter={filter} />
          )}
        </>
      )}
    </ScrollView>
  );
}

function ApplicationFilters({
  selected,
  counts,
  onSelect,
}: {
  selected: ApplicationFilter;
  counts: Record<ApplicationFilter, number>;
  onSelect: (filter: ApplicationFilter) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -space[5] }}
      contentContainerStyle={{ paddingHorizontal: space[5] }}
      accessibilityRole="tablist"
    >
      <View
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderBottomColor: theme.color.field["200"],
        }}
      >
        {applicationFilters.map((option) => {
          const active = selected === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${option.label}, ${counts[option.id]} ${counts[option.id] === 1 ? "application" : "applications"}`}
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
              <Type
                variant="caption"
                style={{
                  color: active ? theme.color.kola["600"] : theme.color.ink["500"],
                  fontWeight: active ? "700" : "500",
                }}
              >
                {option.label}
              </Type>
              <Type
                variant="label"
                style={{ color: active ? theme.color.kola["600"] : theme.color.ink["300"] }}
              >
                {counts[option.id]}
              </Type>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

function ApplicationFilterEmpty({ filter }: { filter: ApplicationFilter }) {
  const copy: Record<ApplicationFilter, { title: string; body: string }> = {
    all: { title: "No applications here", body: "Your applications will appear here." },
    action: { title: "Nothing needs you", body: "You are up to date on every application." },
    open: { title: "Nothing in progress", body: "No application is waiting for a decision." },
    approved: { title: "No approvals yet", body: "Approved applications will stay easy to find here." },
    past: { title: "No past applications", body: "Rejected and withdrawn applications will appear here." },
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

const THUMB = 88;

/**
 * The shape of an application row, before the applications arrive.
 *
 * A caption reading "Loading…" told somebody something was happening and then
 * moved the page under them when it finished. This holds the space the rows
 * will take: thumbnail, two lines, and the standing footer.
 */
function ApplicationSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading your applications" style={{ gap: space[3] }}>
      {[0, 1].map((key) => (
        <View
          key={key}
          style={{
            borderBottomWidth: 1,
            borderBottomColor: theme.color.field["200"],
            backgroundColor: "transparent",
            overflow: "hidden",
            opacity: 0.75,
          }}
        >
          <View style={{ flexDirection: "row", gap: space[3], padding: space[3] }}>
            <View
              style={{
                width: THUMB,
                height: Math.round((THUMB * 3) / 4),
                borderRadius: 8,
                backgroundColor: theme.color.field["100"],
              }}
            />
            <View style={{ flex: 1, justifyContent: "center", gap: space[2] }}>
              <View style={{ width: "72%", height: 14, borderRadius: 4, backgroundColor: theme.color.field["200"] }} />
              <View style={{ width: "48%", height: 10, borderRadius: 4, backgroundColor: theme.color.field["100"] }} />
              <View style={{ width: "32%", height: 10, borderRadius: 4, backgroundColor: theme.color.field["100"] }} />
            </View>
          </View>
          <View
            style={{
              paddingHorizontal: space[3],
              paddingVertical: space[3],
              borderTopWidth: 1,
              borderTopColor: theme.color.field["200"],
            }}
          >
            <View style={{ width: "56%", height: 10, borderRadius: 4, backgroundColor: theme.color.field["100"] }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function Row({
  application,
  state,
  onPress,
}: {
  application: RentalApplication;
  state: ApplicationStanding;
  onPress: () => void;
}) {
  const short = shortfallNote(application);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${application.listing_headline}. ${placeOf(application)}. ${state.line}. Applied ${timeAgo(application.created_at)}.`}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={{
        borderBottomWidth: 1,
        borderBottomColor: theme.color.field["200"],
        backgroundColor: "transparent",
        overflow: "hidden",
      }}
    >
      <View style={{ flexDirection: "row", gap: space[3], padding: space[3] }}>
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
          {application.photo_url ? (
            <Image
              source={{ uri: application.photo_url }}
              accessible={false}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          ) : (
            <Ionicons name="image-outline" size={20} color={theme.color.ink["300"]} />
          )}
        </View>

        <View style={{ flex: 1, justifyContent: "center", gap: 2 }}>
          <Type variant="bodyStrong" numberOfLines={2}>{application.listing_headline}</Type>
          <Type variant="caption" numberOfLines={1}>{placeOf(application)}</Type>
          <Type variant="bodyStrong" style={{ fontSize: 14 }}>
            {application.rent_formatted ?? ""}
            <Type variant="caption"> / month</Type>
          </Type>
          {short ? (
            <Type variant="caption" style={{ color: theme.color.harmattan["600"] }}>{short}</Type>
          ) : null}
        </View>
      </View>

      <View
        style={{
          paddingHorizontal: space[3],
          paddingVertical: space[2],
          borderTopWidth: 1,
          borderTopColor: theme.color.field["200"],
        }}
      >
        <StandingLine standing={state} trailing={timeAgo(application.created_at)} />
      </View>
    </Pressable>
  );
}
