import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, View } from "react-native";

import {
  agreedTerms,
  agreementFilters,
  homeOf,
  matchesAgreementFilter,
  money,
  months,
  per,
  standing,
  type AgreementFilter,
  type AgreementStage,
} from "@/agreementMeaning";
import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { listGrantedLeases, listMyLeases, type Lease } from "@/leases";
import { formatMinor } from "@/listings";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

/**
 * Tenancy agreements.
 *
 * Accepting one commits real money — often a year of it up front — so the
 * screen states the total before it offers the button, breaks it into the
 * parts it is made of, and says plainly when the advance exceeds what the Rent
 * Act allows. It does not hide the button: two-year advances are the market,
 * and a tenant who decides to take one deserves to do it informed rather than
 * be blocked by us.
 */
export default function LeasesScreen() {
  const { state } = useAuth();
  const provider = state.status === "signed_in" &&
    state.me.capabilities.active_workspace === "provider" &&
    state.me.capabilities.provider.workspace_access;
  return provider ? <ProviderLeasesScreen /> : <TenantLeasesScreen />;
}

type ProviderLeaseStage = "send" | "current" | "history";

function ProviderLeasesScreen() {
  const router = useRouter();
  // An agreement belongs to the Portfolio whose Property granted it.
  const { activeContext } = useAuth();
  const preferred = activeContext?.startsWith("organization:")
    ? activeContext.slice("organization:".length)
    : "";
  const [items, setItems] = useState<Lease[] | null>(null);
  const [stage, setStage] = useState<ProviderLeaseStage>("send");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setItems(null);
    try { setItems(await listGrantedLeases(preferred ? { organization: preferred } : undefined)); setError(""); }
    catch (cause) { setItems([]); setError(cause instanceof ApiFailure ? cause.error.message : "We could not load these agreements."); }
  }, [preferred]);
  useEffect(() => { void load(); }, [load]);
  const counts = useMemo(() => ({
    send: (items ?? []).filter((item) => providerLeaseStage(item) === "send").length,
    current: (items ?? []).filter((item) => providerLeaseStage(item) === "current").length,
    history: (items ?? []).filter((item) => providerLeaseStage(item) === "history").length,
  }), [items]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return (items ?? []).filter((item) => providerLeaseStage(item) === stage).filter((item) =>
      !needle || leaseSearchText(item).toLocaleLowerCase("en-GH").includes(needle),
    ).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [items, query, stage]);
  return <FlatList
    data={visible}
    keyExtractor={(item) => item.id}
    contentContainerStyle={{ padding: space[5], paddingBottom: space[12] }}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.kola["600"]} />}
    ListHeaderComponent={<View style={{ gap: space[4], marginBottom: space[3] }}>
      <View style={{ gap: space[1] }}><Type variant="label">AGREEMENTS</Type><Type variant="display2" accessibilityRole="header">Leases</Type><Type variant="body">Send prepared agreements, follow acceptance and keep the final record.</Type></View>
      {error ? <Notice tone="error" title={error} /> : null}
      <Field label="Search agreements" value={query} onChangeText={setQuery} placeholder="Tenant, Property or Unit" returnKeyType="search" />
      <View accessibilityRole="tablist" style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.color.field["200"] }}>
        {(["send", "current", "history"] as const).map((value) => <LeaseTab key={value} label={value === "send" ? "To send" : value === "current" ? "Current" : "History"} count={counts[value]} selected={stage === value} onPress={() => setStage(value)} />)}
      </View>
    </View>}
    ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: theme.color.field["200"] }} />}
    renderItem={({ item }) => <ProviderLeaseRow lease={item} onPress={() => router.push({ pathname: "/(app)/provider-lease", params: { leaseId: item.id } } as never)} />}
    ListEmptyComponent={items === null ? <Type variant="caption" style={{ paddingVertical: space[4] }}>Loading…</Type> : error ? null : <View style={{ paddingVertical: space[6], gap: space[2] }}><Type variant="bodyStrong">{query ? "No matching agreements" : stage === "send" ? "Nothing to send" : stage === "current" ? "No current agreements" : "No agreement history yet"}</Type><Type variant="caption">{query ? "Try a different tenant, Property or Unit." : stage === "send" ? "Prepare agreements from accepted tenancy requests. Saved drafts appear here before they are sent." : stage === "current" ? "Sent, accepted and active agreements appear here." : "Declined, withdrawn and ended agreements remain available as records."}</Type>{stage === "send" && !query ? <Button label="Open tenancy requests" variant="quiet" onPress={() => router.push("/(app)/provider-applications" as never)} /> : null}</View>}
  />;
}

function LeaseTab({ label, count, selected, onPress }: { label: string; count: number; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={`${label}, ${count}`} onPress={onPress} {...pressableFeedback(theme.color.field["100"])} style={{ flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: space[1], borderBottomWidth: 2, borderBottomColor: selected ? theme.color.kola["600"] : "transparent" }}><Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["500"], textAlign: "center" }}>{label} · {count}</Type></Pressable>;
}

function ProviderLeaseRow({ lease, onPress }: { lease: Lease; onPress: () => void }) {
  const terms = lease.agreement?.terms;
  const tenant = terms?.parties.tenant.name ?? lease.tenant_name;
  const property = terms?.property.title ?? lease.property_title;
  const unit = terms?.space.unit_label ?? lease.unit_label;
  const money = terms?.money;
  const status = providerLeaseStatus(lease);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${tenant}. ${property}${unit ? `, ${unit}` : ""}. ${status}. Open agreement.`} onPress={onPress} {...pressableFeedback(theme.color.field["100"])} style={({ pressed }) => ({ minHeight: 92, paddingVertical: space[4], flexDirection: "row", alignItems: "center", gap: space[3], opacity: pressed ? .8 : 1 })}>
    <View style={{ flex: 1, gap: space[1] }}><Type variant="bodyStrong">{tenant}</Type><Type variant="caption">{property}{unit ? ` · ${unit}` : ""}</Type><Type variant="caption">{money ? `${formatMinor(money.rent_minor, money.rent_currency)} / ${money.rent_period === "yearly" ? "year" : "month"}` : lease.rent_formatted ? `${lease.rent_formatted} / ${lease.rent_period === "yearly" ? "year" : "month"}` : "Rent not recorded"}</Type></View>
    <View style={{ alignItems: "flex-end", gap: space[1], maxWidth: "42%" }}><Type variant="bodyStrong" style={{ color: providerLeaseColor(lease), textAlign: "right" }}>{status}</Type><Type variant="caption" style={{ textAlign: "right" }}>{providerLeaseDate(lease)}</Type></View>
    <Type variant="title2" style={{ color: theme.color.ink["300"] }}>›</Type>
  </Pressable>;
}

function providerLeaseStage(lease: Lease): ProviderLeaseStage { return lease.status === "draft" ? "send" : ["offered", "awaiting_activation", "active"].includes(lease.status) ? "current" : "history"; }
function providerLeaseStatus(lease: Lease) { return ({ draft: "Ready to send", offered: "Waiting for tenant", awaiting_activation: "Awaiting activation", active: "Active", declined: "Declined", cancelled: "Withdrawn", ended: "Ended" } as Record<Lease["status"], string>)[lease.status]; }
function providerLeaseColor(lease: Lease) { return lease.status === "active" ? theme.color.kola["600"] : lease.status === "draft" ? theme.color.laterite["600"] : ["offered", "awaiting_activation"].includes(lease.status) ? theme.color.harmattan["600"] : theme.color.ink["500"]; }
function leaseSearchText(lease: Lease) { const terms = lease.agreement?.terms; return `${terms?.parties.tenant.name ?? lease.tenant_name} ${terms?.property.title ?? lease.property_title} ${terms?.space.unit_label ?? lease.unit_label} ${terms?.space.bed_label ?? lease.bed_label ?? ""}`; }
function providerLeaseDate(lease: Lease) { return lease.status === "active" || lease.status === "awaiting_activation" ? `Starts ${formatLeaseDate(lease.agreement?.terms.term.starts_on ?? lease.starts_on)}` : formatLeaseDate(lease.created_at); }

/**
 * The agreements this tenant holds.
 *
 * A row answers five of the six questions — which home, with whom, how much,
 * for how long, and what needs deciding. The sixth, *what am I agreeing to*, is
 * a document, and it opens on its own screen.
 *
 * The old card put "Accept agreement" and "Decline" above the money, the dates,
 * the conditions and the statutory advance notice, then asked the tenant to
 * confirm they had read "the advance-rent notice below". The most consequential
 * action in the product was offered before the reading. It now sits at the end
 * of the review, after the terms.
 */
function TenantLeasesScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Lease[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<AgreementFilter>("all");

  const load = useCallback(async () => {
    try {
      setItems(await listMyLeases());
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not load your agreements.",
      );
      setItems([]);
    }
  }, []);

  // Deciding happens on the review screen, so the list has to be right when it
  // comes back into view.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const rows = (items ?? []).map((lease) => ({ lease, state: standing(lease) }));
  const sections: readonly {
    id: AgreementStage;
    label: string;
    rows: typeof rows;
  }[] = [
    { id: "action", label: "Needs your decision", rows: rows.filter((row) => row.state.stage === "action") },
    { id: "active", label: "Active", rows: rows.filter((row) => row.state.stage === "active") },
    { id: "past", label: "Past", rows: rows.filter((row) => row.state.stage === "past") },
  ];
  const visibleSections = sections
    .filter((section) => matchesAgreementFilter(section.id, filter))
    .filter((section) => section.rows.length > 0);
  const counts: Record<AgreementFilter, number> = {
    all: rows.length,
    action: rows.filter((row) => row.state.stage === "action").length,
    active: rows.filter((row) => row.state.stage === "active").length,
    past: rows.filter((row) => row.state.stage === "past").length,
  };

  const open = (lease: Lease) =>
    router.push({ pathname: "/(app)/agreement/[id]", params: { id: lease.id } });

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
        <Type variant="caption">Loading…</Type>
      ) : items.length === 0 ? (
        <View style={{ gap: space[2], paddingTop: space[6] }}>
          <Type variant="bodyStrong">No agreement yet</Type>
          <Type variant="caption">
            When a landlord sends you one it waits here for your decision. Nothing binds you until
            you accept it.
          </Type>
        </View>
      ) : (
        <>
          <TenantAgreementFilters selected={filter} counts={counts} onSelect={setFilter} />

          {visibleSections.length ? (
            visibleSections.map((section) => (
              <TenantGroup
                key={section.id}
                heading={filter === "all" ? section.label : null}
                tone={section.id === "action" ? "action" : undefined}
              >
                {section.rows.map((row) => (
                  <TenantAgreementRow key={row.lease.id} {...row} onPress={() => open(row.lease)} />
                ))}
              </TenantGroup>
            ))
          ) : (
            <TenantAgreementFilterEmpty filter={filter} />
          )}
        </>
      )}
    </ScrollView>
  );
}

function TenantAgreementFilters({
  selected,
  counts,
  onSelect,
}: {
  selected: AgreementFilter;
  counts: Record<AgreementFilter, number>;
  onSelect: (filter: AgreementFilter) => void;
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
        {agreementFilters.map((option) => {
          const active = selected === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${option.label}, ${counts[option.id]} ${counts[option.id] === 1 ? "agreement" : "agreements"}`}
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

function TenantAgreementFilterEmpty({ filter }: { filter: AgreementFilter }) {
  const copy: Record<AgreementFilter, { title: string; body: string }> = {
    all: { title: "No agreements here", body: "Your agreements will appear here." },
    action: { title: "Nothing needs your decision", body: "You have reviewed every agreement sent to you." },
    active: { title: "No active agreements", body: "Accepted agreements will remain easy to find here." },
    past: { title: "No past agreements", body: "Declined, withdrawn, and ended agreements will appear here." },
  };
  return (
    <View accessibilityRole="summary" style={{ gap: space[1], paddingVertical: space[6] }}>
      <Type variant="bodyStrong">{copy[filter].title}</Type>
      <Type variant="caption">{copy[filter].body}</Type>
    </View>
  );
}

function TenantGroup({
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

function TenantAgreementRow({
  lease,
  state,
  onPress,
}: {
  lease: Lease;
  state: ReturnType<typeof standing>;
  onPress: () => void;
}) {
  const terms = agreedTerms(lease);
  const decide = state.decisionOpen;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${homeOf(terms)}. With ${terms.landlordName}. ${money(terms.rentMinor, terms.rentCurrency)} per ${per(terms.rentPeriod)}. ${state.line}.`}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["200"])}
      style={{
        gap: space[3],
        paddingHorizontal: space[3],
        paddingVertical: space[4],
        borderBottomWidth: 1,
        borderBottomColor: theme.color.field["200"],
        backgroundColor: decide ? theme.color.kola["50"] : "transparent",
      }}
    >
      <View style={{ gap: 2 }}>
        <Type variant="title2">{homeOf(terms)}</Type>
        <Type variant="caption">
          With {terms.landlordName}
          {lease.locality_name ? ` · ${lease.locality_name}` : ""}
        </Type>
      </View>

      <View style={{ gap: 2 }}>
        <Type variant="bodyStrong">
          {money(terms.rentMinor, terms.rentCurrency)}
          <Type variant="caption"> / {per(terms.rentPeriod)}</Type>
        </Type>
        <Type variant="caption">
          {money(terms.moveInTotalMinor, terms.rentCurrency)} to move in
          {terms.startsOn ? ` · starts ${shortDate(terms.startsOn)}` : ""}
          {` · ${months(terms.termMonths)}`}
        </Type>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space[2],
          paddingTop: space[3],
          borderTopWidth: 1,
          borderTopColor: theme.color.field["200"],
        }}
      >
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor:
              state.stage === "action"
                ? theme.color.kola["600"]
                : state.stage === "active"
                  ? theme.color.kola["300"]
                  : theme.color.ink["300"],
          }}
        />
        <Type
          variant="bodyStrong"
          style={{
            flex: 1,
            fontSize: 14,
            color: decide ? theme.color.kola["600"] : theme.color.ink["700"],
          }}
        >
          {state.line}
        </Type>
        <Type variant="bodyStrong" style={{ fontSize: 14, color: theme.color.kola["600"] }}>
          {decide ? "Review →" : "Open →"}
        </Type>
      </View>
    </Pressable>
  );
}

function shortDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
  });
}

function formatLeaseDate(value: string | null | undefined) {
  if (!value) return "a date to be agreed";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
