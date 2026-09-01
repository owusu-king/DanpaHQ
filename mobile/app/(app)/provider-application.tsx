import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";

import { decideApplication, getApplication, type RentalApplication } from "@/applications";
import { apiFetch, ApiFailure, idempotentMutation } from "@/api";
import { ApplicationLeaseActions, RequestLeaseActions } from "@/components/tenant/LeaseActions";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { listGrantedLeases, type Lease } from "@/leases";
import { getPortfolioSummary, type PortfolioSummary } from "@/organizations";
import { theme } from "@/theme";

type PrivateRequest = PortfolioSummary["tenancy_requests"][number];

export default function ProviderApplicationDetailScreen() {
  const router = useRouter();
  const { kind, id, organizationId } = useLocalSearchParams<{ kind?: "application" | "private"; id?: string; organizationId?: string }>();
  const [application, setApplication] = useState<RentalApplication | null>(null);
  const [request, setRequest] = useState<PrivateRequest | null>(null);
  const [lease, setLease] = useState<Lease | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id || !kind) return;
    setLoading(true);
    try {
      if (kind === "application") {
        const [nextApplication, leases] = await Promise.all([getApplication(id), listGrantedLeases()]);
        setApplication(nextApplication); setRequest(null);
        setLease(leases.find((row) => row.application === id) ?? null);
        setNote(nextApplication.decision_note ?? "");
      } else {
        if (!organizationId) throw new Error("Portfolio missing");
        const summary = await getPortfolioSummary(organizationId);
        const nextRequest = summary.tenancy_requests.find((row) => row.id === id) ?? null;
        if (!nextRequest) throw new Error("Request missing");
        setRequest(nextRequest); setApplication(null); setLease(null);
        setNote(nextRequest.decision_note ?? "");
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load this tenancy request.");
    } finally { setLoading(false); }
  }, [id, kind, organizationId]);

  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await work(); await load(); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "That action did not work."); }
    finally { setBusy(false); }
  }

  function decidePrivate(approved: boolean) {
    if (!request) return Promise.resolve();
    return apiFetch(`/join-requests/${request.id}/decision/`, { method: "POST", body: { approved, note: note.trim() }, ...idempotentMutation() });
  }

  if (loading) return <View style={{ padding: space[5] }}><Type variant="caption">Loading request…</Type></View>;
  if (!application && !request) return <View style={{ padding: space[5] }}><Notice tone="error" title={error || "This request is no longer available."} /></View>;

  const publicRequest = Boolean(application);
  const title = application?.applicant_name ?? request!.requester_display;
  const place = application?.listing_headline ?? `${request!.property_title} · ${request!.unit_label}${request!.bed_label ? ` · ${request!.bed_label}` : ""}`;
  const open = application ? ["submitted", "under_review"].includes(application.status) : request!.status === "pending";
  const agreementNeeded = application ? application.status === "accepted" && (!lease || lease.status === "draft") : request!.status === "approved" && (!request!.lease_id || request!.lease_status === "draft");

  return <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[5] }} keyboardShouldPersistTaps="handled">
    <View style={{ gap: space[1] }}><Type variant="label">{publicRequest ? "PUBLIC LISTING" : "DIRECT REQUEST"}</Type><Type variant="display2" accessibilityRole="header">{title}</Type><Type variant="body">{place}</Type><Type variant="caption">{statusLabel(application, request, lease)}</Type></View>
    {error ? <Notice tone="error" title={error} /> : null}
    {application ? <ApplicationDetails application={application} /> : request!.message ? <Quote>{request!.message}</Quote> : null}
    {(application?.decision_note && !open) || request?.decision_note ? <Notice tone="info" title="Decision note" body={application?.decision_note || request?.decision_note} /> : null}

    {open ? <Section title="Decision">
      {application ? <Field label="Note to the applicant (optional)" value={note} onChangeText={setNote} maxLength={300} multiline numberOfLines={3} textAlignVertical="top" style={{ minHeight: 76 }} /> : null}
      {application?.status === "submitted" ? <Button label="Mark under review" variant="secondary" busy={busy} onPress={() => void run(() => decideApplication(application.id, "review", note.trim()))} /> : null}
      <Button label="Accept request" busy={busy} disabled={request ? !request.can_manage : false} onPress={() => void run(() => application ? decideApplication(application.id, "accept", note.trim()) : decidePrivate(true))} />
      <Button label="Decline" variant="destructive" disabled={busy || Boolean(request && !request.can_manage)} onPress={() => Alert.alert("Decline this request?", "The person will see that the request was not accepted.", [{ text: "Go back", style: "cancel" }, { text: "Decline", style: "destructive", onPress: () => void run(() => application ? decideApplication(application.id, "reject", note.trim()) : decidePrivate(false)) }])} />
      {request && !request.can_manage ? <Notice tone="info" title="View only" body="An Owner, Admin or assigned property manager must act." /> : null}
    </Section> : null}

    {agreementNeeded ? <Section title="Next: prepare the agreement">
      <Type variant="caption">Acceptance permits an agreement to be prepared. The tenancy starts only after the tenant accepts and activation completes.</Type>
      {application ? <ApplicationLeaseActions applicationId={application.id} listingId={application.listing_id} unitId={application.unit_id} tenantId={application.tenant_id} rentMinor={application.rent_minor} advanceMonths={application.advance_months_offered} leaseId={lease?.id ?? null} leaseStatus={lease?.status ?? null} onChanged={load} /> : <RequestLeaseActions requestId={request!.id} unitId={request!.unit_id} bedId={request!.bed_id} tenantId={request!.requester_id} leaseId={request!.lease_id} leaseStatus={request!.lease_status} onChanged={load} />}
    </Section> : null}

    {!open && !agreementNeeded && (lease || request?.lease_id) ? <Notice tone={lease?.status === "active" || request?.lease_status === "active" ? "success" : "info"} title={statusLabel(application, request, lease)} /> : null}
    <Section title="Related record"><Button label={publicRequest ? "View listing" : "View Unit"} variant="quiet" onPress={() => publicRequest ? router.push({ pathname: "/(app)/listing/[id]", params: { id: application!.listing_id } }) : router.push({ pathname: "/(app)/space", params: { propertyId: request!.property_id, unitId: request!.unit_id } } as never)} /></Section>
  </ScrollView>;
}

function ApplicationDetails({ application }: { application: RentalApplication }) {
  return <View style={{ gap: space[4] }}>
    <View style={{ padding: space[4], gap: space[1], backgroundColor: application.meets_advance ? theme.color.kola["50"] : theme.color.harmattan["100"], borderLeftWidth: 3, borderLeftColor: application.meets_advance ? theme.color.kola["600"] : theme.color.harmattan["600"] }}><Type variant="bodyStrong">{application.meets_advance ? `Offers the requested ${application.advance_months_asked} months advance` : `${application.advance_shortfall_months} month${application.advance_shortfall_months === 1 ? "" : "s"} below the requested advance`}</Type><Type variant="caption">Offers {application.advance_months_offered}; asking {application.advance_months_asked}.</Type></View>
    <View style={{ gap: space[2] }}><Fact label="Move-in" value={application.move_in_from ? formatDate(application.move_in_from) : "Not stated"} /><Fact label="Household" value={application.household_size ? `${application.household_size} people` : "Not stated"} /><Fact label="Occupation" value={application.occupation || "Not stated"} /><Fact label="Employer" value={application.employer || "Not stated"} /></View>
    <Section title="Guarantor"><Type variant="caption">{application.guarantor_name ? `${application.guarantor_name}${application.guarantor_relationship ? ` · ${application.guarantor_relationship}` : ""}${application.guarantor_phone ? ` · ${application.guarantor_phone}` : ""}` : "None provided"}</Type></Section>
    {application.message ? <Quote>{application.message}</Quote> : null}
  </View>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View style={{ gap: space[3], paddingTop: space[4], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}><Type variant="title2" accessibilityRole="header">{title}</Type>{children}</View>; }
function Quote({ children }: { children: string }) { return <View style={{ padding: space[4], backgroundColor: theme.color.field["100"], borderLeftWidth: 3, borderLeftColor: theme.color.field["300"] }}><Type variant="body">“{children}”</Type></View>; }
function Fact({ label, value }: { label: string; value: string }) { return <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[4] }}><Type variant="caption">{label}</Type><Type variant="bodyStrong" style={{ flex: 1, textAlign: "right" }}>{value}</Type></View>; }
function statusLabel(application: RentalApplication | null, request: PrivateRequest | null, lease: Lease | null) { if (application) return lease ? agreementLabel(lease.status) : application.status_display; if (request?.status === "pending") return "Decision needed"; return request?.lease_status ? agreementLabel(request.lease_status) : "Agreement needed"; }
function agreementLabel(status: string) { return ({ draft: "Agreement ready to send", offered: "Waiting for tenant", awaiting_activation: "Waiting for activation", active: "Tenancy active", declined: "Agreement declined", cancelled: "Agreement cancelled", ended: "Tenancy ended" } as Record<string, string>)[status] ?? "Request settled"; }
function formatDate(value: string) { return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" }); }
