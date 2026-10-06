import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, StyleSheet, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import {
  EDGE,
  Fact,
  Footnote,
  GroupLabel,
  Lead,
  LinkRow,
  MUTED,
  RecordPanel,
  type RecordTone,
} from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { theme } from "@/theme";
import { listMyTenancies, tenancyLabel, type Tenancy } from "@/tenancy";

/**
 * One tenancy — the tenant's own home.
 *
 * Identified by the route parameter, which is the point: a tenant may hold
 * several, and which one they are looking at has to be something they chose
 * rather than something the previous screen left in shared state. That
 * inheritance is how a second home became invisible.
 *
 * Refined on review (2026-09-21): the home is recognised by its photograph, and
 * the money leads — what is due, or that nothing is. The agreement and the rent
 * account are rows out to their own records rather than two cards restating
 * what those records already say.
 */
export default function TenancyScreen() {
  const router = useRouter();
  const { tenancyId } = useLocalSearchParams<{ tenancyId: string }>();
  const [tenancy, setTenancy] = useState<Tenancy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageBottom = useSafeBottom(space[8]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listMyTenancies();
      setTenancy(rows.find((row) => row.id === tenancyId) ?? null);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this home.");
    } finally {
      setLoading(false);
    }
  }, [tenancyId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading && !tenancy) return <TenancySkeleton />;

  if (!tenancy) {
    return (
      <View style={{ padding: space[5], gap: space[3] }}>
        <Notice
          tone={error ? "error" : "info"}
          title={error || "This tenancy is not one of yours"}
          body={error ? undefined : "It may have ended, or the link may be wrong."}
        />
      </View>
    );
  }

  const due = tenancy.rent?.next_due ?? null;
  const outstanding = tenancy.rent?.outstanding_count ?? 0;
  const tone: RecordTone = due?.is_overdue ? "alert" : outstanding > 0 ? "waiting" : "good";
  const place = [tenancy.property.locality, tenancy.property.district].filter(Boolean).join(", ");

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}>
      <RecordPanel>
        <View style={styles.identity}>
          <Shot uri={tenancy.photo_url} />
          <View style={styles.identityBody}>
            <Type variant="bodyStrong" numberOfLines={2} style={styles.title}>{tenancy.property.title}</Type>
            <Type variant="caption" numberOfLines={2} style={styles.place}>
              {[tenancyLabel(tenancy), place].filter(Boolean).join(" · ")}
            </Type>
          </View>
        </View>
        <View style={styles.rule} />
        {due && outstanding > 0 ? (
          <Lead
            label={due.is_overdue ? "Overdue" : "Due next"}
            value={due.amount_formatted ?? "Amount unavailable"}
            note={`${due.kind_display} · ${due.is_overdue ? "was due" : "due"} ${shortDate(due.due_on)}${outstanding > 1 ? ` · ${outstanding} items outstanding` : ""}`}
            tone={tone}
          />
        ) : (
          <Lead
            label="Rent"
            value={tenancy.lease?.rent_formatted ?? "Not set"}
            note={tenancy.lease ? `per ${tenancy.lease.rent_period === "yearly" ? "year" : "month"} · nothing outstanding` : "Waiting for an agreement"}
            tone={tenancy.lease ? "good" : "waiting"}
          />
        )}
      </RecordPanel>

      {tenancy.lease ? (
        <View style={styles.section}>
          <GroupLabel>Your agreement</GroupLabel>
          <RecordPanel>
            <Fact first label="Standing" value={tenancy.lease.status_display} />
            {tenancy.lease.starts_on ? (
              <Fact
                label={tenancy.status === "upcoming" ? "Starts" : "Started"}
                value={shortDate(tenancy.lease.starts_on)}
              />
            ) : null}
            <LinkRow
              icon="document-text-outline"
              tone="action"
              label="Read the agreement"
              detail="The terms both sides accepted."
              onPress={() => router.push({ pathname: "/(app)/agreement/[id]", params: { id: tenancy.lease!.id } })}
            />
            <LinkRow
              icon="cash-outline"
              tone="action"
              label="Rent account"
              detail="What is due, what is paid, and every receipt."
              onPress={() => router.push({
                pathname: "/(app)/rent-account",
                params: {
                  leaseId: tenancy.lease!.id,
                  propertyTitle: tenancy.property.title,
                  unitLabel: tenancy.space.unit_label,
                  bedLabel: tenancy.space.bed_label ?? "",
                  tenancyId: tenancy.id,
                  mode: "tenant",
                },
              } as never)}
            />
          </RecordPanel>
        </View>
      ) : (
        <View style={styles.section}>
          <GroupLabel>Your agreement</GroupLabel>
          <RecordPanel>
            <Fact
              wide
              first
              label="Not sent yet"
              value="Your provider must send an agreement and you must accept it before Rooomly can activate this tenancy."
            />
          </RecordPanel>
        </View>
      )}

      {/* Repairs are about *this* home, so reporting starts here already on it. */}
      {tenancy.status === "active" ? (
        <View style={styles.section}>
          <GroupLabel>Maintenance</GroupLabel>
          <RecordPanel>
            <LinkRow
              first
              icon="construct-outline"
              tone="action"
              label="Report a problem"
              detail="A photo and a few words; your landlord is told at once."
              onPress={() => router.push({ pathname: "/(app)/maintenance-report", params: { tenancy: tenancy.id } } as never)}
            />
            <LinkRow
              icon="list-outline"
              label="Your requests"
              detail="Where each repair stands."
              onPress={() => router.push("/(app)/maintenance" as never)}
            />
          </RecordPanel>
        </View>
      ) : null}

      <Footnote>Rooomly records what was agreed and what has been paid. Rent is never collected here.</Footnote>
    </ScrollView>
  );
}

/** The home, at the size a thumb recognises rather than explores. */
function Shot({ uri }: { uri: string | null }) {
  return (
    <View style={styles.shot}>
      {uri ? (
        <Image source={{ uri }} accessible={false} resizeMode="cover" style={styles.shotImage} />
      ) : (
        <Ionicons name="home-outline" size={20} color={theme.color.ink["300"]} />
      )}
    </View>
  );
}

/** Shaped like the card it becomes, so nothing jumps when the tenancy arrives. */
function TenancySkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading this home" style={styles.page}>
      <RecordPanel style={styles.skeletonPanel}>
        <View style={styles.identity}>
          <Bone width={64} height={64} round={12} />
          <View style={styles.skeletonLines}>
            <Bone width="72%" height={15} />
            <Bone width="50%" />
          </View>
        </View>
        <Bone width="46%" height={28} />
        <Bone width="62%" />
      </RecordPanel>
      <RecordPanel style={styles.skeletonPanel}>
        <Bone width="38%" height={12} />
        <Bone height={44} />
      </RecordPanel>
    </View>
  );
}

function shortDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  page: {
    padding: space[4],
    gap: space[4],
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[4],
  },
  identityBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
  },
  place: {
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: space[4],
    backgroundColor: EDGE,
  },
  section: {
    gap: space[2],
  },
  shot: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["100"],
  },
  shotImage: {
    width: "100%",
    height: "100%",
  },
  skeletonPanel: {
    gap: space[3],
    padding: space[4],
  },
  skeletonLines: {
    flex: 1,
    gap: space[2],
  },
});
