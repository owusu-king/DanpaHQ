import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, ScrollView, View } from "react-native";

import { decideApplication, getApplication, type RentalApplication } from "@/applications";
import { apiFetch, ApiFailure, idempotentMutation } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import { EntityHeader, StatusLine, type StatusTone } from "@/components/property/WorkspacePatterns";
import {
  ActionBar,
  Fact,
  Footnote,
  GroupLabel,
  Lead,
  LinkRow,
  MUTED,
  Pill,
  Quote,
  QuietAct,
  RecordPanel,
} from "@/components/record/RecordSurfaces";
import { ApplicationLeaseActions, RequestLeaseActions } from "@/components/tenant/LeaseActions";
import { Field, Notice, Type, space } from "@/components/ui";
import { listGrantedLeases, type Lease } from "@/leases";
import { getPortfolioSummary, type PortfolioSummary } from "@/organizations";
import { useSafeBottom } from "@/platform";

type PrivateRequest = PortfolioSummary["tenancy_requests"][number];
type Mode = "none" | "accept" | "decline";

/**
 * One tenancy request, and the decision it is waiting for.
 *
 * Two kinds arrive here — an application against a public listing, and a direct
 * request from somebody holding a Unit's access code — and they are the same
 * question: let this person rent this home, or not. So they are read the same
 * way, and only the evidence differs.
 *
 * Refined on review (2026-09-21): whether the advance offered meets the advance
 * asked leads, because that is what the decision usually turns on. The decision
 * itself sits in the bar, and choosing either side gives the page over to it so
 * the note is written deliberately rather than into a field beside two buttons.
 */
export default function ProviderApplicationDetailScreen() {
  const router = useRouter();
  const { kind, id, organizationId } = useLocalSearchParams<{ kind?: "application" | "private"; id?: string; organizationId?: string }>();
  const [application, setApplication] = useState<RentalApplication | null>(null);
  const [request, setRequest] = useState<PrivateRequest | null>(null);
  const [lease, setLease] = useState<Lease | null>(null);
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<Mode>("none");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pageBottom = useSafeBottom(space[8]);

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
    try { await work(); setMode("none"); await load(); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "That action did not work."); }
    finally { setBusy(false); }
  }

  function decidePrivate(approved: boolean) {
    if (!request) return Promise.resolve();
    return apiFetch(`/join-requests/${request.id}/decision/`, { method: "POST", body: { approved, note: note.trim() }, ...idempotentMutation() });
  }

  if (loading && !application && !request) return <RequestSkeleton />;
  if (!application && !request) {
    return <View style={{ padding: space[5] }}><Notice tone="error" title={error || "This request is no longer available."} /></View>;
  }

  const publicRequest = Boolean(application);
  const who = application?.applicant_name ?? request!.requester_display;
  const place = application?.listing_headline ?? `${request!.property_title} · ${request!.unit_label}${request!.bed_label ? ` · ${request!.bed_label}` : ""}`;
  const open = application ? ["submitted", "under_review"].includes(application.status) : request!.status === "pending";
  const mayManage = request ? request.can_manage : true;
  const agreementNeeded = application
    ? application.status === "accepted" && (!lease || lease.status === "draft")
    : request!.status === "approved" && (!request!.lease_id || request!.lease_status === "draft");
  const message = application?.message || request?.message || "";
  const decided = (application?.decision_note && !open) || request?.decision_note;
  const focused = mode !== "none";
  const barShown = open && mayManage && !focused;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.page, { paddingBottom: barShown ? space[6] : pageBottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <EntityHeader
          eyebrow={publicRequest ? "Public listing" : "Direct request"}
          title={who}
          subtitle={place}
          status={<StatusLine label={statusLabel(application, request, lease)} tone={statusTone(open, agreementNeeded)} />}
        />

        {error ? <Notice tone="error" title={error} /> : null}

        {focused ? (
          <View style={styles.section}>
            <GroupLabel>{mode === "accept" ? "Accept this request?" : "Decline this request?"}</GroupLabel>
            <RecordPanel style={styles.formPanel}>
              <Type variant="caption" style={styles.formNote}>
                {mode === "accept"
                  ? "Accepting lets you prepare an agreement. The tenancy starts only once the tenant accepts it and activation completes."
                  : "The person will see that the request was not accepted. You can say why."}
              </Type>
              {application ? (
                <Field
                  label="Note to the applicant (optional)"
                  value={note}
                  onChangeText={setNote}
                  maxLength={300}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  style={{ minHeight: 76 }}
                />
              ) : null}
              <Pill
                grow
                tone={mode === "decline" ? "danger" : "primary"}
                label={mode === "accept" ? "Yes, accept it" : "Yes, decline it"}
                busy={busy}
                busyLabel="Sending…"
                onPress={() => void run(() =>
                  application
                    ? decideApplication(application.id, mode === "accept" ? "accept" : "reject", note.trim())
                    : decidePrivate(mode === "accept"),
                )}
              />
              <QuietAct label="Go back" disabled={busy} onPress={() => setMode("none")} />
            </RecordPanel>
          </View>
        ) : (
          <>
            {/* What the decision usually turns on, said before anything else. */}
            {application ? (
              <RecordPanel>
                <Lead
                  label="Advance offered"
                  value={`${application.advance_months_offered} month${application.advance_months_offered === 1 ? "" : "s"}`}
                  note={
                    application.meets_advance
                      ? `Meets the ${application.advance_months_asked} asked for`
                      : `${application.advance_shortfall_months} month${application.advance_shortfall_months === 1 ? "" : "s"} below the ${application.advance_months_asked} asked for`
                  }
                  tone={application.meets_advance ? "good" : "waiting"}
                />
              </RecordPanel>
            ) : null}

            {message ? <Quote>{message}</Quote> : null}

            {application ? (
              <View style={styles.section}>
                <GroupLabel>About them</GroupLabel>
                <RecordPanel>
                  <Fact first label="Rent" value={application.rent_formatted ?? "Not stated"} />
                  <Fact label="Move-in" value={application.move_in_from ? formatDate(application.move_in_from) : "Not stated"} />
                  <Fact label="Household" value={application.household_size ? `${application.household_size} people` : "Not stated"} />
                  <Fact label="Occupation" value={application.occupation || "Not stated"} />
                  <Fact label="Employer" value={application.employer || "Not stated"} />
                  <Fact
                    label="Guarantor"
                    value={application.guarantor_name
                      ? `${application.guarantor_name}${application.guarantor_relationship ? ` · ${application.guarantor_relationship}` : ""}`
                      : "None provided"}
                  />
                </RecordPanel>
              </View>
            ) : null}

            {decided ? (
              <View style={styles.section}>
                <GroupLabel>Your decision note</GroupLabel>
                <RecordPanel>
                  <Fact wide first label="What you said" value={application?.decision_note || request?.decision_note || ""} />
                </RecordPanel>
              </View>
            ) : null}

            {agreementNeeded ? (
              <View style={styles.section}>
                <GroupLabel>Next: prepare the agreement</GroupLabel>
                <RecordPanel style={styles.formPanel}>
                  <Type variant="caption" style={styles.formNote}>
                    Acceptance permits an agreement to be prepared. The tenancy starts only after the
                    tenant accepts and activation completes.
                  </Type>
                  {application ? (
                    <ApplicationLeaseActions
                      applicationId={application.id}
                      listingId={application.listing_id}
                      unitId={application.unit_id}
                      tenantId={application.tenant_id}
                      rentMinor={application.rent_minor}
                      advanceMonths={application.advance_months_offered}
                      leaseId={lease?.id ?? null}
                      leaseStatus={lease?.status ?? null}
                      onChanged={load}
                    />
                  ) : (
                    <RequestLeaseActions
                      requestId={request!.id}
                      unitId={request!.unit_id}
                      bedId={request!.bed_id}
                      tenantId={request!.requester_id}
                      leaseId={request!.lease_id}
                      leaseStatus={request!.lease_status}
                      onChanged={load}
                    />
                  )}
                </RecordPanel>
              </View>
            ) : null}

            {open && application?.status === "submitted" ? (
              <RecordPanel>
                <LinkRow
                  first
                  icon="eye-outline"
                  label="Mark under review"
                  detail="Tells the applicant you are looking at it."
                  onPress={() => void run(() => decideApplication(application.id, "review", note.trim()))}
                />
              </RecordPanel>
            ) : null}

            <RecordPanel>
              <LinkRow
                first
                icon={publicRequest ? "home-outline" : "cube-outline"}
                label={publicRequest ? "View listing" : "View Unit"}
                onPress={() => publicRequest
                  ? router.push({ pathname: "/(app)/listing/[id]", params: { id: application!.listing_id } })
                  : router.push({ pathname: "/(app)/space", params: { propertyId: request!.property_id, unitId: request!.unit_id } } as never)}
              />
            </RecordPanel>

            {open && !mayManage ? (
              <Footnote>An Owner, Admin or assigned property manager must answer this request.</Footnote>
            ) : null}
          </>
        )}
      </ScrollView>

      {barShown ? (
        <ActionBar>
          <Pill grow icon="checkmark-outline" label="Accept request" onPress={() => setMode("accept")} />
          <QuietAct icon="close-outline" label="Decline" onPress={() => setMode("decline")} />
        </ActionBar>
      ) : null}
    </View>
  );
}

/** Shaped like the record it becomes, so nothing jumps when the request arrives. */
function RequestSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading this request" style={styles.page}>
      <Bone width="34%" height={13} />
      <Bone width="58%" height={22} />
      <RecordPanel style={styles.formPanel}>
        <Bone width="40%" height={12} />
        <Bone width="46%" height={30} />
        <Bone height={40} />
      </RecordPanel>
    </View>
  );
}

function statusLabel(application: RentalApplication | null, request: PrivateRequest | null, lease: Lease | null) {
  if (application) return lease ? agreementLabel(lease.status) : application.status_display;
  if (request?.status === "pending") return "Decision needed";
  return request?.lease_status ? agreementLabel(request.lease_status) : "Agreement needed";
}

function statusTone(open: boolean, agreementNeeded: boolean): StatusTone {
  return open ? "attention" : agreementNeeded ? "waiting" : "good";
}

function agreementLabel(status: string) {
  return ({
    draft: "Agreement ready to send",
    offered: "Waiting for tenant",
    awaiting_activation: "Waiting for activation",
    active: "Tenancy active",
    declined: "Agreement declined",
    cancelled: "Agreement cancelled",
    ended: "Tenancy ended",
  } as Record<string, string>)[status] ?? "Request settled";
}

function formatDate(value: string) {
  return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString("en-GH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  page: {
    padding: space[4],
    gap: space[4],
  },
  section: {
    gap: space[2],
  },
  formPanel: {
    gap: space[3],
    padding: space[4],
  },
  formNote: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
});
