import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Notice, Surface, Type, space } from "@/components/ui";
import { theme } from "@/theme";
import { listMyTenancies, tenancyLabel, type Tenancy } from "@/tenancy";

/**
 * One tenancy.
 *
 * Identified by the route parameter, which is the point: a tenant may hold
 * several, and which one they are looking at has to be something they chose
 * rather than something the previous screen left in shared state. That
 * inheritance is how a second home became invisible.
 *
 * Rent history, maintenance, notices and documents attach here as their phases
 * land. Explore, saved places, applications and the account stay outside every
 * tenancy — they belong to the person, not to a home.
 */
export default function TenancyScreen() {
  const router = useRouter();
  const { tenancyId } = useLocalSearchParams<{ tenancyId: string }>();
  const [tenancy, setTenancy] = useState<Tenancy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listMyTenancies();
      setTenancy(rows.find((row) => row.id === tenancyId) ?? null);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load this home.",
      );
    } finally {
      setLoading(false);
    }
  }, [tenancyId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const due = tenancy?.rent?.next_due ?? null;

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4] }}>
      {error ? <Notice tone="error" title={error} /> : null}

      {loading && !tenancy ? (
        <Notice tone="info" title="Loading" body="Fetching this tenancy…" />
      ) : !tenancy ? (
        <>
          <Notice
            tone="info"
            title="This tenancy is not one of yours"
            body="It may have ended, or the link may be wrong."
          />
          <Button label="Back to your homes" onPress={() => router.replace("/(app)/(tabs)" as never)} />
        </>
      ) : (
        <>
          <View style={{ gap: space[2] }}>
            <Type variant="label">YOUR HOME</Type>
            <Type variant="display2">{tenancy.property.title}</Type>
            <Type variant="body">
              {[tenancyLabel(tenancy), tenancy.property.locality, tenancy.property.district]
                .filter(Boolean)
                .join(" · ")}
            </Type>
          </View>

          {due?.is_overdue ? (
            <Notice
              tone="warning"
              title={`${due.kind_display} overdue`}
              body={`${due.amount_formatted ?? "An amount"} was due ${new Date(due.due_on).toLocaleDateString("en-GH")}.`}
            />
          ) : null}

          <Surface style={{ gap: space[3] }}>
            <View style={{ flexDirection: "row", gap: space[3], alignItems: "center" }}>
              <Ionicons name="document-text" size={24} color={theme.color.kola["600"]} />
              <Type variant="title2">Agreement</Type>
            </View>
            {tenancy.lease ? (
              <View style={{ gap: space[1] }}>
                <Type variant="bodyStrong">
                  {tenancy.lease.rent_formatted ?? "Rent not set"} per{" "}
                  {tenancy.lease.rent_period === "yearly" ? "year" : "month"}
                </Type>
                <Type variant="caption">Status: {tenancy.lease.status_display}</Type>
                {tenancy.lease.starts_on ? (
                  <Type variant="caption">
                    {tenancy.status === "upcoming" ? "Starts" : "Started"}{" "}
                    {new Date(tenancy.lease.starts_on).toLocaleDateString("en-GH")}
                  </Type>
                ) : null}
              </View>
            ) : (
              <Type variant="caption">
                Your provider must send a lease and you must accept it before Rooomly
                can activate this tenancy.
              </Type>
            )}
          </Surface>

          <Surface style={{ gap: space[3] }}>
            <View style={{ flexDirection: "row", gap: space[3], alignItems: "center" }}>
              <Ionicons name="cash" size={24} color={theme.color.kola["600"]} />
              <Type variant="title2">Rent</Type>
            </View>
            {tenancy.rent && tenancy.rent.outstanding_count > 0 && due ? (
              <View style={{ gap: space[1] }}>
                <Type variant="bodyStrong">
                  {due.amount_formatted ?? "Amount unavailable"}
                </Type>
                <Type variant="caption">
                  {due.kind_display} · due {new Date(due.due_on).toLocaleDateString("en-GH")}
                  {tenancy.rent.outstanding_count > 1
                    ? ` · ${tenancy.rent.outstanding_count} items outstanding`
                    : ""}
                </Type>
              </View>
            ) : (
              <Type variant="caption">
                Nothing outstanding. Charges appear here as your landlord raises them.
              </Type>
            )}
            <Button
              label="Open rent account"
              variant="secondary"
              disabled={!tenancy.lease}
              onPress={() => tenancy.lease && router.push({
                pathname: "/(app)/rent-account",
                params: {
                  leaseId: tenancy.lease.id,
                  propertyTitle: tenancy.property.title,
                  unitLabel: tenancy.space.unit_label,
                  bedLabel: tenancy.space.bed_label ?? "",
                  tenancyId: tenancy.id,
                  mode: "tenant",
                },
              } as never)}
            />
          </Surface>
        </>
      )}
    </ScrollView>
  );
}
