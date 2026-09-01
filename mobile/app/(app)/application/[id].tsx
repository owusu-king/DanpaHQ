import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Dimensions, Image, Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { placeOf, standing, timeline } from "@/applicationMeaning";
import { getApplication, withdrawApplication, type RentalApplication } from "@/applications";
import { ApplicationTimeline } from "@/components/applications/ApplicationTimeline";
import { StandingLine } from "@/components/applications/StandingLine";
import { Button, Notice, Type, space } from "@/components/ui";
import { listMyLeases, type Lease } from "@/leases";
import { theme } from "@/theme";

/**
 * One application, in full.
 *
 * The list answers where it stands. This answers what was actually sent, what
 * came back, and the one irreversible thing that can still be done about it.
 *
 * What the tenant wrote about themselves sits behind a disclosure: they know
 * what they said, and it is here to be checked rather than read. Withdrawing
 * asks first — it cannot be undone and it releases the Unit to somebody else.
 */
export default function ApplicationRecordScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [application, setApplication] = useState<RentalApplication | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [told, setTold] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const width = useRef(Dimensions.get("window").width).current;

  useEffect(() => {
    void Promise.all([getApplication(id), listMyLeases().catch(() => [] as Lease[])])
      .then(([record, myLeases]) => {
        setApplication(record);
        setLeases(myLeases);
      })
      .catch((cause) =>
        setLoadError(
          cause instanceof ApiFailure ? cause.error.message : "We could not open that application.",
        ),
      );
  }, [id]);

  if (loadError) {
    return <View style={{ padding: space[5] }}><Notice tone="error" title={loadError} /></View>;
  }
  if (!application) {
    return <RecordSkeleton />;
  }

  const state = standing(application, leases);
  const open = ["submitted", "under_review"].includes(application.status);
  const asked = application.advance_months_asked;
  const offered = application.advance_months_offered;
  // Orientation, not exploration: enough photograph to recognize the place
  // without pushing the facts off the screen.
  const heroHeight = Math.min(Math.round(width * 0.42), 190);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space[8] }}>
        <View
          style={{
            height: heroHeight,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.color.field["100"],
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
            <Ionicons name="image-outline" size={28} color={theme.color.ink["300"]} />
          )}
        </View>

        <View style={{ padding: space[5], gap: space[5] }}>
          <View style={{ gap: space[1] }}>
            <Type variant="display2" accessibilityRole="header">{application.listing_headline}</Type>
            <Type variant="caption">{placeOf(application)}</Type>
          </View>

          <View
            style={{
              gap: space[2],
              paddingVertical: space[3],
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: theme.color.field["200"],
            }}
          >
            <StandingLine standing={state} />
            <Type variant="caption">
              Applied {onDate(application.created_at)}
              {application.decided_at ? ` · answered ${onDate(application.decided_at)}` : ""}
            </Type>
          </View>

          {/* Where it stands is one line above. This is how it got there and
              what is still to come — the difference between a status word and
              knowing where you are. */}
          <View style={{ gap: space[3] }}>
            <Type variant="label" accessibilityRole="header">PROGRESS</Type>
            <ApplicationTimeline steps={timeline(application, leases)} />
          </View>

          {/* The landlord's own words, when there are any. */}
          {application.decision_note ? (
            <View
              style={{
                paddingVertical: space[2],
                paddingLeft: space[4],
                borderLeftWidth: 3,
                borderLeftColor: theme.color.field["300"],
              }}
            >
              <Type variant="body">{application.decision_note}</Type>
            </View>
          ) : null}

          <View style={{ gap: space[1] }}>
            <Fact
              label="Advance offered"
              value={`${offered} month${offered === 1 ? "" : "s"}${offered === asked ? "" : ` of ${asked}`}`}
            />
            <Fact label="Rent" value={application.rent_formatted ?? "—"} />
            <Fact
              label="Move in from"
              value={application.move_in_from ? onDate(application.move_in_from) : "Not stated"}
            />
            <Fact
              label="Household"
              value={application.household_size ? `${application.household_size} people` : "Not stated"}
            />
          </View>

          <View style={{ gap: space[2] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: told }}
              onPress={() => setTold((value) => !value)}
              style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: space[2] }}
            >
              <Ionicons
                name={told ? "chevron-down" : "chevron-forward"}
                size={16}
                color={theme.color.kola["600"]}
              />
              <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
                What you told them
              </Type>
            </Pressable>
            {told ? (
              <View style={{ gap: space[1] }}>
                <Fact label="Occupation" value={application.occupation || "Not stated"} />
                <Fact label="Employer" value={application.employer || "Not stated"} />
                <Fact
                  label="Guarantor"
                  value={
                    application.guarantor_name
                      ? `${application.guarantor_name}${application.guarantor_relationship ? ` · ${application.guarantor_relationship}` : ""}`
                      : "None given"
                  }
                />
                {application.message ? (
                  <View
                    style={{
                      marginTop: space[2],
                      paddingLeft: space[4],
                      borderLeftWidth: 3,
                      borderLeftColor: theme.color.field["300"],
                    }}
                  >
                    <Type variant="body">{application.message}</Type>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="link"
            onPress={() =>
              router.push({
                pathname: "/(app)/listing/[id]",
                params: { id: application.listing_id },
              })
            }
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
              View the listing →
            </Type>
          </Pressable>

          {actionError ? <Notice tone="error" title={actionError} /> : null}
        </View>
      </ScrollView>

      {/* One place for the consequential things, always reachable. */}
      {state.stage === "action" || open ? (
        <View
          style={{
            gap: space[2],
            padding: space[4],
            borderTopWidth: 1,
            borderTopColor: theme.color.field["200"],
            backgroundColor: theme.color.field["0"],
          }}
        >
          {/* The agreement this became, not the list of every agreement. The
              application already knows which one it is. */}
          {state.stage === "action" ? (
            <Button
              label="Review agreement"
              onPress={() =>
                state.leaseId
                  ? router.push({
                      pathname: "/(app)/agreement/[id]",
                      params: { id: state.leaseId },
                    })
                  : router.push("/(app)/leases" as never)
              }
            />
          ) : null}

          {open ? (
            confirming ? (
              <View style={{ gap: space[2] }}>
                <Type variant="caption">Withdraw this application? This cannot be undone.</Type>
                <Button
                  label="Yes, withdraw"
                  variant="destructive"
                  busy={busy}
                  onPress={async () => {
                    setBusy(true);
                    setActionError("");
                    try {
                      await withdrawApplication(application.id, "No longer needed");
                      router.back();
                    } catch (cause) {
                      setActionError(
                        cause instanceof ApiFailure ? cause.error.message : "That did not work.",
                      );
                      setBusy(false);
                    }
                  }}
                />
                <Button label="Keep it" variant="quiet" onPress={() => setConfirming(false)} />
              </View>
            ) : (
              <Button label="Withdraw" variant="quiet" onPress={() => setConfirming(true)} />
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The shape of the record, before it arrives.
 *
 * A caption reading "Loading…" on an otherwise blank screen, then the whole
 * page appearing at once. This holds the hero, the heading and the first rows.
 */
function RecordSkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading this application"
      style={{ flex: 1, opacity: 0.75 }}
    >
      <View style={{ height: 170, backgroundColor: theme.color.field["100"] }} />
      <View style={{ padding: space[5], gap: space[4] }}>
        <View style={{ width: "76%", height: 26, borderRadius: 6, backgroundColor: theme.color.field["200"] }} />
        <View style={{ width: "52%", height: 12, borderRadius: 4, backgroundColor: theme.color.field["100"] }} />
        <View style={{ height: 1, backgroundColor: theme.color.field["200"] }} />
        {[0, 1, 2].map((key) => (
          <View key={key} style={{ flexDirection: "row", gap: space[3], alignItems: "center" }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: theme.color.field["200"] }} />
            <View style={{ flex: 1, height: 12, borderRadius: 4, backgroundColor: theme.color.field["100"] }} />
          </View>
        ))}
      </View>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space[4],
      }}
    >
      <Type variant="caption">{label}</Type>
      <Type variant="bodyStrong" style={{ flexShrink: 1, textAlign: "right" }}>{value}</Type>
    </View>
  );
}

function onDate(value: string): string {
  const iso = value.length === 10 ? `${value}T12:00:00` : value;
  return new Date(iso).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
