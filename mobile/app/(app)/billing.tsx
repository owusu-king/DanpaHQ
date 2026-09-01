import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Notice, Surface, Type, space } from "@/components/ui";
import {
  getPlanCatalogue,
  getPortfolioBilling,
  listOrganizations,
  type EntitlementMeta,
  type EntitlementValue,
  type Organization,
  type PlanCatalogue,
  type PortfolioBilling,
} from "@/organizations";
import { theme } from "@/theme";

/**
 * Plan & billing.
 *
 * A provider opens this to answer one question — "can I add another property"
 * — so the meters come first and the plan ladder sits under them.
 *
 * Nothing here decides anything. Every limit shown is checked again on the
 * server inside the transaction that takes the slot; this renders the numbers
 * the backend enforces with, and if the two disagree the server is right.
 * Names and grouping come from the catalogue, so moving a capability between
 * plans stays a backend change rather than an app release.
 *
 * There is no checkout. Paid plans are not live, and choosing one says so
 * instead of starting a payment that nothing behind it could finish.
 */

/** Which live count answers which limit. */
const USAGE_FOR: Record<string, string> = {
  PROPERTY_LIMIT: "PROPERTY_COUNT",
  UNIT_LIMIT: "UNIT_COUNT",
  TEAM_MEMBER_LIMIT: "TEAM_MEMBER_COUNT",
};

export default function BillingScreen() {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [billing, setBilling] = useState<PortfolioBilling | null>(null);
  const [catalogue, setCatalogue] = useState<PlanCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const orgs = await listOrganizations();
      const target = orgs[0] ?? null;
      setOrganization(target);
      if (!target) {
        setBilling(null);
        return;
      }
      const [plans, snapshot] = await Promise.all([
        getPlanCatalogue(),
        getPortfolioBilling(target.id),
      ]);
      setCatalogue(plans);
      setBilling(snapshot);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your plan.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const meters = useMemo(() => {
    if (!billing || !catalogue) return [];
    return catalogue.headline_limits.map((key) => ({
      key,
      name: catalogue.entitlements.find((item) => item.key === key)?.name ?? key,
      used: billing.usage[USAGE_FOR[key] ?? ""] ?? 0,
      limit: billing.limits[key] ?? null,
    }));
  }, [billing, catalogue]);

  if (loading) {
    return (
      <View style={{ padding: space[5] }}>
        <Type variant="caption">Loading your plan…</Type>
      </View>
    );
  }

  const selected = catalogue?.plans.find((row) => row.code === chosen) ?? null;
  const currentIndex = catalogue && billing ? catalogue.upgrade_order.indexOf(billing.plan.code) : -1;
  const canManage =
    organization?.current_user_role === "owner" || organization?.current_user_role === "admin";

  return (
    <ScrollView
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[6] }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      <View style={{ gap: space[1] }}>
        <Type variant="label">{(organization?.name ?? "YOUR PORTFOLIO").toUpperCase()}</Type>
        <Type variant="display2" accessibilityRole="header">
          Plan
        </Type>
      </View>

      {error ? <Notice tone="warning" title="Could not load this" body={error} /> : null}

      {!organization ? (
        <Notice
          tone="info"
          title="No Portfolio yet"
          body="A plan belongs to a property business, not to your account. Create a Portfolio and it starts on Free."
        />
      ) : null}

      {billing && catalogue ? (
        <>
          <Surface style={{ padding: space[4], gap: space[2] }}>
            <Type variant="label">CURRENT PLAN</Type>
            <Type variant="title1">{billing.plan.name}</Type>
            <Type variant="caption">
              {billing.plan.monthly_price_minor === 0
                ? "No charge."
                : `${money(billing.plan.monthly_price_minor, billing.plan.currency)} a month.`}{" "}
              Everyone you invite works inside this plan — it belongs to the business, not to a
              person.
            </Type>
          </Surface>

          {billing.over_limit.length ? (
            <Notice
              tone="warning"
              title="You hold more than this plan includes"
              body={`${describeOver(billing.over_limit, catalogue.entitlements)} Nothing has been removed and nothing will be. What changes is that you cannot add more until you move to a larger plan.`}
            />
          ) : null}

          <View style={{ gap: space[3] }}>
            <Type variant="label">WHAT YOU ARE USING</Type>
            {meters.map(({ key, ...meter }) => (
              <Meter key={key} {...meter} />
            ))}
          </View>

          <View style={{ gap: space[3] }}>
            <Type variant="label">PLANS</Type>
            {catalogue.plans.map((row) => {
              const isCurrent = row.code === billing.plan.code;
              const rank = catalogue.upgrade_order.indexOf(row.code);
              return (
                <Surface
                  key={row.code}
                  style={{
                    padding: space[4],
                    gap: space[2],
                    borderWidth: isCurrent ? 2 : 0,
                    borderColor: theme.color.kola["600"],
                  }}
                >
                  <Type variant="bodyStrong">{row.name}</Type>
                  <Type variant="title2">{money(row.monthly_price_minor, row.currency)}</Type>
                  <Type variant="caption">{row.description}</Type>
                  {isCurrent ? (
                    <Type variant="caption" style={{ color: theme.color.kola["600"] }}>
                      Your current plan
                    </Type>
                  ) : rank > currentIndex && canManage ? (
                    <Type
                      variant="bodyStrong"
                      accessibilityRole="button"
                      onPress={() => setChosen(row.code)}
                      style={{ color: theme.color.kola["600"], paddingTop: space[1] }}
                    >
                      Upgrade to {row.name} →
                    </Type>
                  ) : rank > currentIndex ? (
                    <Type variant="caption">
                      Only an owner or administrator can change the plan.
                    </Type>
                  ) : null}
                </Surface>
              );
            })}
          </View>

          {selected ? (
            <Notice
              tone="info"
              title={`${selected.name} is not available to buy yet`}
              body="Paid plans are still being finished. Nothing has been charged and your plan has not changed. We will let you know the moment they open."
            />
          ) : null}

          <View style={{ gap: space[3] }}>
            <Type variant="label">WHAT EACH PLAN INCLUDES</Type>
            {catalogue.groups.map((group) => (
              <Group
                key={group}
                title={group}
                entitlements={catalogue.entitlements.filter((item) => item.group === group)}
                catalogue={catalogue}
                currentCode={billing.plan.code}
              />
            ))}
          </View>

          <Type variant="caption">
            Moving to a smaller plan never deletes properties, tenants, leases or payment records.
          </Type>
        </>
      ) : null}
    </ScrollView>
  );
}

function Meter({ name, used, limit }: { name: string; used: number; limit: number | null }) {
  const over = limit !== null && used > limit;
  const near = !over && limit !== null && limit > 0 && used / limit >= 0.8;
  const fill = limit === null || limit <= 0 ? (used > 0 ? 1 : 0) : Math.min(1, used / limit);
  const rule = over
    ? theme.color.laterite["600"]
    : near
      ? theme.color.harmattan["500"]
      : theme.color.kola["600"];

  return (
    <Surface style={{ padding: space[4], gap: space[2] }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Type variant="caption">{name}</Type>
        <Type variant="bodyStrong">
          {used} of {limit === null ? "unlimited" : limit}
        </Type>
      </View>
      <View
        accessible
        accessibilityLabel={`${used} of ${limit === null ? "unlimited" : limit} ${name}`}
        style={{
          height: 6,
          borderRadius: 999,
          backgroundColor: theme.color.field["100"],
          overflow: "hidden",
        }}
      >
        <View style={{ width: `${Math.round(fill * 100)}%`, height: "100%", backgroundColor: rule }} />
      </View>
      <Type variant="caption" style={over ? { color: theme.color.laterite["600"] } : undefined}>
        {note(used, limit)}
      </Type>
    </Surface>
  );
}

function Group({
  title,
  entitlements,
  catalogue,
  currentCode,
}: {
  title: string;
  entitlements: EntitlementMeta[];
  catalogue: PlanCatalogue;
  currentCode: string;
}) {
  if (!entitlements.length) return null;
  return (
    <Surface style={{ padding: space[4], gap: space[3] }}>
      <Type variant="bodyStrong">{title}</Type>
      {entitlements.map((item) => (
        <View key={item.key} style={{ gap: space[1] }}>
          <Type variant="caption">{item.name}</Type>
          <View style={{ flexDirection: "row", gap: space[4] }}>
            {catalogue.plans.map((row) => (
              <View key={row.code} style={{ flex: 1, gap: 2 }}>
                <Type variant="label">{row.code}</Type>
                <Type
                  variant="body"
                  style={
                    row.code === currentCode ? { color: theme.color.kola["600"] } : undefined
                  }
                >
                  {describeValue(row.entitlements[item.key], item.value_type)}
                </Type>
              </View>
            ))}
          </View>
        </View>
      ))}
    </Surface>
  );
}

function describeValue(
  value: EntitlementValue | undefined,
  type: EntitlementMeta["value_type"],
): string {
  if (!value) return "—";
  // Unlimited is a flag, never a large number. "999999 properties" on a billing
  // screen teaches somebody something false about the product.
  if (value.unlimited) return "Unlimited";
  if (type === "boolean") return value.value ? "Yes" : "—";
  return value.value === null || value.value === undefined ? "—" : String(value.value);
}

function note(used: number, limit: number | null): string {
  if (limit === null) return "No limit on your plan.";
  if (used > limit) return `${used - limit} over what this plan includes.`;
  const left = limit - used;
  return left === 0 ? "You have used all of these." : `${left} left.`;
}

function describeOver(
  rows: PortfolioBilling["over_limit"],
  entitlements: EntitlementMeta[],
): string {
  return rows
    .map((row) => {
      const name =
        entitlements.find((item) => item.key === row.entitlement)?.name ?? row.entitlement;
      return `${name}: ${row.current} against a limit of ${row.limit}.`;
    })
    .join(" ");
}

function money(minor: number, currency: string): string {
  if (minor === 0) return "Free";
  const major = minor / 100;
  return `${currency === "GHS" ? "GH₵" : currency} ${major.toLocaleString("en-GH", {
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
