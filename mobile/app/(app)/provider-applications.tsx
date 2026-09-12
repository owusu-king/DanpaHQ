import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

import { type RentalApplication, listReceivedApplications } from "@/applications";
import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Field, Notice, Type, space } from "@/components/ui";
import { type Lease, listGrantedLeases } from "@/leases";
import { getPortfolioSummary, listOrganizations, type PortfolioSummary } from "@/organizations";
import { useBlankOnPortfolioSwitch } from "@/portfolioScope";
import { theme } from "@/theme";

type Stage = "action" | "agreement" | "history";
type PrivateRequest = PortfolioSummary["tenancy_requests"][number];
type RequestItem =
  | { key: string; kind: "application"; application: RentalApplication; lease: Lease | null }
  | { key: string; kind: "private"; request: PrivateRequest; organizationId: string };

export default function ProviderApplicationsScreen() {
  const router = useRouter();
  const { activeContext } = useAuth();
  const [summaries, setSummaries] = useState<PortfolioSummary[] | null>(null);
  const [applications, setApplications] = useState<RentalApplication[] | null>(null);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [stage, setStage] = useState<Stage>("action");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // The private tenancy requests come from the Portfolio summary, so they too
  // go when the Portfolio does — a request answered on this screen decides
  // somebody's tenancy, and it must be one this Portfolio actually received.
  useBlankOnPortfolioSwitch(activeContext, () => {
    setSummaries(null);
    setApplications(null);
    setLeases([]);
  });

  const load = useCallback(async () => {
    // One Portfolio: the one being operated. Reading every Portfolio and
    // flattening them put a personal Portfolio's request beside a company's,
    // and answering it decided something this screen was not about.
    setApplications(null);
    try {
      const organizations = await listOrganizations();
      const preferred = activeContext?.startsWith("organization:")
        ? activeContext.slice("organization:".length)
        : "";
      const organization = organizations.find((row) => row.id === preferred) ?? organizations[0];
      if (!organization) {
        setSummaries([]); setApplications([]); setLeases([]); setError("");
        return;
      }
      const scope = { organization: organization.id };
      const [summary, nextApplications, nextLeases] = await Promise.all([
        getPortfolioSummary(organization.id),
        listReceivedApplications(false, scope),
        listGrantedLeases(scope),
      ]);
      setSummaries([summary]); setApplications(nextApplications); setLeases(nextLeases); setError("");
    } catch (cause) {
      setApplications([]);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load tenancy requests.");
    }
  }, [activeContext]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const items = useMemo<RequestItem[]>(() => {
    const leaseByApplication = new Map(leases.filter((lease) => lease.application).map((lease) => [lease.application!, lease]));
    return [
      ...(applications ?? []).map((application) => ({ key: `application:${application.id}`, kind: "application" as const, application, lease: leaseByApplication.get(application.id) ?? null })),
      ...(summaries ?? []).flatMap((summary) => summary.tenancy_requests.map((request) => ({ key: `private:${request.id}`, kind: "private" as const, request, organizationId: summary.organization.id }))),
    ].sort((a, b) => createdAt(b).localeCompare(createdAt(a)));
  }, [applications, leases, summaries]);
  const counts = useMemo(() => ({
    action: items.filter((item) => itemStage(item) === "action").length,
    agreement: items.filter((item) => itemStage(item) === "agreement").length,
    history: items.filter((item) => itemStage(item) === "history").length,
  }), [items]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GH");
    return items.filter((item) => itemStage(item) === stage).filter((item) => !needle || searchText(item).toLocaleLowerCase("en-GH").includes(needle));
  }, [items, query, stage]);

  return (
    <FlatList
      data={visible}
      keyExtractor={(item) => item.key}
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[2] }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.color.kola["600"]} />}
      ListHeaderComponent={<View style={{ gap: space[4], marginBottom: space[2] }}>
        <View style={{ gap: space[2] }}><Type variant="display2" accessibilityRole="header">Tenancy requests</Type><Type variant="body">Review people asking to rent, then prepare an agreement when you are ready.</Type></View>
        {error ? <Notice tone="error" title={error} /> : null}
        <Field label="Search requests" value={query} onChangeText={setQuery} placeholder="Person, Property or Unit" returnKeyType="search" />
        <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: space[1] }}>
          <RequestTab label="Action" count={counts.action} selected={stage === "action"} onPress={() => setStage("action")} />
          <RequestTab label="Agreement" count={counts.agreement} selected={stage === "agreement"} onPress={() => setStage("agreement")} />
          <RequestTab label="History" count={counts.history} selected={stage === "history"} onPress={() => setStage("history")} />
        </View>
      </View>}
      renderItem={({ item }) => <RequestRow item={item} onPress={() => router.push({ pathname: "/(app)/provider-application", params: { kind: item.kind, id: item.kind === "application" ? item.application.id : item.request.id, organizationId: item.kind === "private" ? item.organizationId : "" } } as never)} />}
      ListEmptyComponent={applications === null ? <Type variant="caption">Loading requests…</Type> : error ? null : <Notice tone="info" title={query ? "No matching requests" : stage === "action" ? "Nothing needs a decision" : stage === "agreement" ? "No agreements to prepare" : "No request history yet"} body={query ? "Try a different person, Property or Unit." : stage === "action" ? "New public applications and private tenancy requests appear here." : stage === "agreement" ? "Accepted requests stay here until their agreement is sent." : "Settled requests remain available as a record."} />}
    />
  );
}

function RequestTab({ label, count, selected, onPress }: { label: string; count: number; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => ({ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: space[1], borderBottomWidth: 2, borderBottomColor: selected ? theme.color.kola["600"] : "transparent", opacity: pressed ? .7 : 1 })}><Type variant="bodyStrong" style={{ color: selected ? theme.color.kola["600"] : theme.color.ink["500"], textAlign: "center" }}>{label} · {count}</Type></Pressable>;
}

function RequestRow({ item, onPress }: { item: RequestItem; onPress: () => void }) {
  const application = item.kind === "application" ? item.application : null;
  const request = item.kind === "private" ? item.request : null;
  const tone = itemStage(item) === "action" ? theme.color.laterite["600"] : itemStage(item) === "agreement" ? theme.color.harmattan["600"] : theme.color.kola["600"];
  return <Pressable accessibilityRole="link" accessibilityLabel={`${application?.applicant_name ?? request?.requester_display}, ${statusLabel(item)}, ${application?.listing_headline ?? `${request?.property_title}, ${request?.unit_label}`}`} onPress={onPress} style={({ pressed }) => ({ minHeight: 92, paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: theme.color.field["200"], opacity: pressed ? .7 : 1 })}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
      <View style={{ flex: 1, gap: space[1] }}><Type variant="bodyStrong">{application?.applicant_name ?? request?.requester_display}</Type><Type variant="caption" numberOfLines={2}>{application?.listing_headline ?? `${request?.property_title} · ${request?.unit_label}${request?.bed_label ? ` · ${request.bed_label}` : ""}`}</Type><Type variant="caption" style={{ color: tone }}>{statusLabel(item)} · {formatDate(createdAt(item))}</Type></View>
      <Type variant="title2" style={{ color: theme.color.kola["600"] }}>›</Type>
    </View>
  </Pressable>;
}

function itemStage(item: RequestItem): Stage {
  if (item.kind === "application") { if (["submitted", "under_review"].includes(item.application.status)) return "action"; if (item.application.status === "accepted" && (!item.lease || item.lease.status === "draft")) return "agreement"; return "history"; }
  if (item.request.status === "pending") return "action";
  if (item.request.status === "approved" && (!item.request.lease_id || item.request.lease_status === "draft")) return "agreement";
  return "history";
}
function statusLabel(item: RequestItem) { if (item.kind === "application") return item.lease ? agreementLabel(item.lease.status) : item.application.status_display; if (item.request.status === "pending") return "Decision needed"; return item.request.lease_status ? agreementLabel(item.request.lease_status) : "Agreement needed"; }
function agreementLabel(status: string) { return ({ draft: "Agreement ready to send", offered: "Waiting for tenant", awaiting_activation: "Waiting for activation", active: "Tenancy active", declined: "Agreement declined", cancelled: "Agreement cancelled", ended: "Tenancy ended" } as Record<string, string>)[status] ?? "Request settled"; }
function createdAt(item: RequestItem) { return item.kind === "application" ? item.application.created_at : item.request.created_at; }
function searchText(item: RequestItem) { return item.kind === "application" ? `${item.application.applicant_name} ${item.application.listing_headline} ${item.application.locality_name ?? ""}` : `${item.request.requester_display} ${item.request.property_title} ${item.request.unit_label} ${item.request.bed_label ?? ""}`; }
function formatDate(value: string) { return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" }); }
