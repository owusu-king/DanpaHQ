import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Keyboard, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { ReviewLine, ReviewList, WizardFrame, type WizardStep } from "@/components/creation/WizardFrame";
import { Select } from "@/components/form/Select";
import { useStackHeaderHeight } from "@/components/nav/StackHeader";
import { Pill, RecordPanel } from "@/components/record/RecordSurfaces";
import { Chip, Choice, Field, Notice, Type, radius, space } from "@/components/ui";
import {
  draftLease,
  getLease,
  leaseAction,
  updateLease,
  type Lease,
  type LeaseStructuredTerms,
  type RenderedAgreement,
} from "@/leases";
import { formatMinor } from "@/listings";
import { formatLeaseDate } from "@/providerLeaseMeaning";
import { theme } from "@/theme";

const STEPS = [
  { key: "overview", label: "Tenancy details", icon: "home-outline" },
  { key: "term", label: "Tenancy term", icon: "calendar-outline" },
  { key: "payments", label: "Rent & payments", icon: "wallet-outline" },
  { key: "duties", label: "Responsibilities", icon: "construct-outline" },
  { key: "additions", label: "Additional terms", icon: "list-outline", hint: "Optional terms for this tenancy." },
  { key: "review", label: "Review agreement", icon: "document-text-outline", hint: "Read the agreement before sending it to the tenant." },
] as const satisfies readonly Omit<WizardStep, "done" | "reachable">[];
type Step = (typeof STEPS)[number]["key"];
const PROVIDER_RESPONSIBILITIES = [
  ["structural_repairs", "Structural repairs"],
  ["shared_areas", "Shared areas"],
  ["property_rates", "Property rates"],
] as const;
const TENANT_RESPONSIBILITIES = [
  ["routine_cleaning", "Routine cleaning"],
  ["report_damage", "Report damage"],
  ["respect_neighbours", "Respect neighbours"],
  ["residential_use", "Residential use only"],
] as const;
type UtilityParty = "tenant" | "provider" | "included" | "shared" | "not_applicable";
type FormState = {
  rent: string;
  rentPeriod: "monthly" | "yearly";
  advance: string;
  deposit: string;
  agencyFee: string;
  startsOn: string;
  term: string;
  paymentDue: string;
  water: UtilityParty;
  electricity: UtilityParty;
  providerResponsibilities: string[];
  tenantResponsibilities: string[];
  occupants: string;
  conditions: string;
  customTitle: string;
  customBody: string;
};

export default function LeaseBuilderScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const leaseId = one(params.leaseId);
  if (!leaseId) return <LeaseBuilder params={params} />;
  return <SavedLeaseBuilder key={leaseId} leaseId={leaseId} params={params} />;
}

type BuilderParams = Record<string, string | string[]>;

function SavedLeaseBuilder({ leaseId, params }: { leaseId: string; params: BuilderParams }) {
  const [saved, setSaved] = useState<Lease | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    void getLease(leaseId).then((lease) => {
      if (!current) return;
      if (lease.workflow_version === "canonical_v1" && (lease.status === "draft" || lease.status === "ready")) {
        setSaved(lease);
      } else {
        setError("This agreement is no longer editable.");
      }
    }).catch((cause) => {
      if (current) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load the agreement.");
    });
    return () => { current = false; };
  }, [leaseId]);

  if (saved) return <LeaseBuilder params={params} saved={saved} />;
  return (
    <View style={styles.panel}>
      {error ? <Notice tone="error" title={error} /> : <Type variant="caption">Loading agreement…</Type>}
    </View>
  );
}

function LeaseBuilder({ params, saved }: { params: BuilderParams; saved?: Lease }) {
  const router = useRouter();
  const headerHeight = useStackHeaderHeight();
  const [step, setStep] = useState<Step>(saved ? "term" : "overview");
  const [lease, setLease] = useState<Lease | null>(saved ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const at = STEPS.findIndex((item) => item.key === step);
  const tenantName = saved?.tenant_name || one(params.tenantName);
  const rentalLabel = saved
    ? [saved.property_title, saved.unit_label, saved.bed_label].filter(Boolean).join(" · ")
    : one(params.rentalLabel);
  const document = lease?.builder_preview?.rendered_document ?? null;
  const savedTerms = saved?.structured_terms;
  const rentCurrency = saved?.rent_currency ?? "GHS";
  const [form, setForm] = useState<FormState>({
    rent: saved ? String(saved.rent_minor / 100) : Number(one(params.rentMinor)) > 0 ? String(Number(one(params.rentMinor)) / 100) : "",
    rentPeriod: saved?.rent_period === "yearly" ? "yearly" : "monthly",
    advance: saved ? String(saved.advance_months) : one(params.advanceMonths) || "1",
    deposit: String(saved?.deposit_months ?? 0),
    agencyFee: String(saved?.agency_fee_months ?? 0),
    startsOn: saved?.starts_on ?? "",
    term: String(saved?.term_months ?? 12),
    paymentDue: savedTerms?.payment_due ?? "on the first day of each rental period",
    water: savedTerms?.utilities?.water ?? "tenant",
    electricity: savedTerms?.utilities?.electricity ?? "tenant",
    providerResponsibilities: savedTerms?.provider_responsibilities ?? PROVIDER_RESPONSIBILITIES.map(([value]) => value),
    tenantResponsibilities: savedTerms?.tenant_responsibilities ?? TENANT_RESPONSIBILITIES.map(([value]) => value),
    occupants: savedTerms?.occupants?.map(({ name }) => name).join("\n") ?? "",
    conditions: saved?.conditions ?? "",
    customTitle: savedTerms?.additional_terms?.[0]?.title ?? "",
    customBody: savedTerms?.additional_terms?.[0]?.body ?? "",
  });
  const structured = useMemo<LeaseStructuredTerms>(
    () => ({
      payment_due: form.paymentDue,
      utilities: { ...savedTerms?.utilities, water: form.water, electricity: form.electricity },
      occupants: form.occupants
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => savedTerms?.occupants?.find((occupant) => occupant.name === name) ?? { name }),
      provider_responsibilities: form.providerResponsibilities,
      tenant_responsibilities: form.tenantResponsibilities,
      notice_channels: savedTerms?.notice_channels ?? ["Danpa HQ", "written notice"],
      additional_terms: [
        ...(form.customTitle.trim() && form.customBody.trim()
          ? [{ title: form.customTitle.trim(), body: form.customBody.trim() }]
          : []),
        ...(savedTerms?.additional_terms?.slice(1) ?? []),
      ],
    }),
    [form, savedTerms],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setError("");
    setForm((current) => ({ ...current, [key]: value }));
  }
  function toggle(key: "providerResponsibilities" | "tenantResponsibilities", value: string) {
    setError("");
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
  }
  function issue() {
    if (step === "term" && !validStartDate(form.startsOn)) return "Enter a valid start date in YYYY-MM-DD format.";
    if (step === "term" && (Number(form.term) < 1 || Number(form.term) > 120)) return "Enter a term from 1 to 120 months.";
    if (step === "payments") {
      const rent = Number(form.rent);
      if (!/^\d*(?:\.\d{0,2})?$/.test(form.rent) || rent <= 0 || !Number.isSafeInteger(Math.round(rent * 100))) {
        return "Enter a rent amount with up to two decimal places.";
      }
      if (Number(form.advance) > 36) return "Enter an advance from 0 to 36 months.";
      if (Number(form.deposit) > 12) return "Enter a deposit from 0 to 12 months.";
      if (Number(form.agencyFee) > 6) return "Enter an agency fee from 0 to 6 months.";
    }
    if (
      step === "duties" &&
      (!form.providerResponsibilities.length || !form.tenantResponsibilities.length)
    )
      return "Choose responsibilities for both parties.";
    if (step === "additions" && Boolean(form.customTitle.trim()) !== Boolean(form.customBody.trim()))
      return "Give the additional term both a title and its complete wording.";
    return "";
  }

  async function prepareReview() {
    const payload = {
      rent_minor: Math.round(Number(form.rent) * 100),
      rent_currency: rentCurrency,
      rent_period: form.rentPeriod,
      advance_months: Number(form.advance || 0),
      deposit_months: Number(form.deposit || 0),
      agency_fee_months: Number(form.agencyFee || 0),
      starts_on: form.startsOn,
      term_months: Number(form.term),
      conditions: form.conditions,
      structured_terms: structured,
    } as const;
    setBusy(true);
    setError("");
    try {
      let current = lease;
      if (current) current = await updateLease(current.id, payload);
      else
        current = await draftLease({
          workflow_version: "canonical_v1",
          unit_id: required(params, "unitId"),
          tenant_id: required(params, "tenantId"),
          ...(one(params.bedId) ? { bed_id: one(params.bedId) } : {}),
          ...(one(params.sourceKind) === "join_request"
            ? { join_request_id: required(params, "sourceId") }
            : {}),
          ...(one(params.sourceKind) === "application"
            ? { application_id: required(params, "sourceId") }
            : {}),
          ...(one(params.listingId) ? { listing_id: one(params.listingId) } : {}),
          ...payload,
        });
      // Keep the saved draft if requesting the preview fails.
      setLease(current);
      current = await leaseAction(current.id, "ready");
      setLease(current);
      setStep("review");
    } catch (cause) {
      if (cause instanceof ApiFailure && cause.error.details.reason === "lease_term_expired") {
        setStep("term");
      }
      setError(
        cause instanceof ApiFailure
          ? cause.error.message
          : "We could not prepare the agreement preview.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!lease || !document || busy) return;
    setBusy(true);
    setError("");
    try {
      const sent = await leaseAction(lease.id, "offer");
      router.replace({ pathname: "/(app)/provider-lease", params: { leaseId: sent.id } } as never);
    } catch (cause) {
      if (cause instanceof ApiFailure && cause.error.details.reason === "lease_term_expired") {
        setStep("term");
      }
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not send the agreement.",
      );
    } finally {
      setBusy(false);
    }
  }
  function next() {
    const problem = issue();
    if (problem) {
      setError(problem);
      return;
    }
    if (step === "additions") {
      Keyboard.dismiss();
      void prepareReview();
    } else {
      const nextStep = STEPS[at + 1];
      if (nextStep) goTo(nextStep.key);
    }
  }

  function goTo(target: Step) {
    if (busy) return;
    Keyboard.dismiss();
    setError("");
    setStep(target);
  }

  function confirmSend() {
    Alert.alert(
      "Send this agreement?",
      "The tenant will receive the agreement for review and acceptance.",
      [{ text: "Keep reviewing", style: "cancel" }, { text: "Send", onPress: () => void send() }],
    );
  }

  return (
    <WizardFrame
      current={step}
      keyboardOffset={headerHeight}
      steps={STEPS.map((item, index) => ({
        ...item,
        done: index < at,
        reachable: index < at && !busy,
      }))}
      onGo={(key) => {
        const target = STEPS.find((item) => item.key === key);
        if (target) goTo(target.key);
      }}
      feedback={error ? <Notice tone="error" title={error} /> : null}
      footer={
        <>
          {at > 0 ? (
            <Pill label="Back" tone="quiet" disabled={busy} onPress={() => goTo(STEPS[at - 1]!.key)} />
          ) : null}
          <Pill
            grow
            icon={step === "review" ? "send-outline" : step === "additions" ? "document-text-outline" : "arrow-forward"}
            label={step === "review" ? "Send to tenant" : step === "additions" ? "Generate agreement" : "Continue"}
            busy={busy}
            busyLabel={step === "review" ? "Sending…" : "Generating…"}
            disabled={step === "review" && !document}
            onPress={step === "review" ? confirmSend : next}
          />
        </>
      }
    >
      {step === "overview" ? (
        <ReviewList>
          <ReviewLine first icon="person-outline" term="Tenant" value={tenantName || "Tenant linked to this agreement"} />
          <ReviewLine icon="home-outline" term="Rental space" value={rentalLabel || "Rental space linked to this agreement"} />
        </ReviewList>
      ) : null}
      {step === "term" ? (
        <RecordPanel style={styles.panel}>
          <Field
            label="Start date"
            value={form.startsOn}
            onChangeText={(value) => {
              const digits = value.replace(/\D/g, "").slice(0, 8);
              update("startsOn", [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)].filter(Boolean).join("-"));
            }}
            keyboardType="number-pad"
            placeholder="YYYY-MM-DD"
            maxLength={10}
          />
          <Field
            label="Length (months)"
            value={form.term}
            onChangeText={(value) => update("term", value.replace(/\D/g, ""))}
            keyboardType="number-pad"
          />
        </RecordPanel>
      ) : null}
      {step === "payments" ? (
        <>
          <RecordPanel style={styles.panel}>
            <Type variant="bodyStrong">Rent schedule</Type>
            <Field
              label="Rent amount"
              prefix={rentCurrency === "GHS" ? "GH₵" : rentCurrency}
              value={form.rent}
              onChangeText={(value) => update("rent", value.replace(/[^0-9.]/g, ""))}
              keyboardType="decimal-pad"
            />
            <Choice
              label="Payment frequency"
              value={form.rentPeriod}
              options={[
                { value: "monthly", label: "Monthly" },
                { value: "yearly", label: "Yearly" },
              ]}
              onChange={(value) => update("rentPeriod", value)}
            />
            <Field label="Payment due" value={form.paymentDue} onChangeText={(value) => update("paymentDue", value)} />
          </RecordPanel>
          <RecordPanel style={styles.panel}>
            <Type variant="bodyStrong">Upfront payments</Type>
            {([
              ["advance", "Advance (months)"],
              ["deposit", "Deposit (months)"],
              ["agencyFee", "Agency fee (months)"],
            ] as const).map(([key, label]) => (
              <Field
                key={key}
                label={label}
                value={form[key]}
                onChangeText={(value) => update(key, value.replace(/\D/g, ""))}
                keyboardType="number-pad"
              />
            ))}
          </RecordPanel>
        </>
      ) : null}
      {step === "duties" ? <Responsibilities form={form} update={update} toggle={toggle} /> : null}
      {step === "additions" ? (
        <>
          <RecordPanel style={styles.panel}>
            <Field
              label="Other permitted occupants"
              hint="Enter one name per line."
              value={form.occupants}
              onChangeText={(value) => update("occupants", value)}
              editable={!busy}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              style={styles.multiline}
            />
            <Field
              label="Practical conditions"
              value={form.conditions}
              onChangeText={(value) => update("conditions", value)}
              editable={!busy}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              style={styles.multiline}
            />
          </RecordPanel>
          <RecordPanel style={styles.panel}>
            <Type variant="bodyStrong">Custom clause</Type>
            <Field
              label="Term title"
              value={form.customTitle}
              onChangeText={(value) => update("customTitle", value)}
              editable={!busy}
            />
            <Field
              label="Complete wording"
              value={form.customBody}
              onChangeText={(value) => update("customBody", value)}
              editable={!busy}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              style={styles.multiline}
            />
          </RecordPanel>
        </>
      ) : null}
      {step === "review" ? (
        <AgreementPreview document={document} form={form} currency={rentCurrency} onEdit={busy ? undefined : goTo} />
      ) : null}
    </WizardFrame>
  );
}

function Responsibilities({
  form,
  update,
  toggle,
}: {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  toggle: (key: "providerResponsibilities" | "tenantResponsibilities", value: string) => void;
}) {
  const utilities = [
    { value: "tenant" as const, label: "Tenant pays" },
    { value: "provider" as const, label: "Provider pays" },
    { value: "included" as const, label: "Included" },
    { value: "shared" as const, label: "Shared" },
    { value: "not_applicable" as const, label: "N/A" },
  ];
  return (
    <>
      <RecordPanel style={styles.panel}>
        <Type variant="bodyStrong">Who pays for utilities?</Type>
        <Select label="Water" value={form.water} options={utilities} onChange={(value) => update("water", value)} />
        <Select label="Electricity" value={form.electricity} options={utilities} onChange={(value) => update("electricity", value)} />
      </RecordPanel>
      <RecordPanel style={styles.panel}>
        <Type variant="bodyStrong">Provider responsibilities</Type>
        <View style={styles.chips}>
          {PROVIDER_RESPONSIBILITIES.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={form.providerResponsibilities.includes(value)}
              onPress={() => toggle("providerResponsibilities", value)}
            />
          ))}
        </View>
      </RecordPanel>
      <RecordPanel style={styles.panel}>
        <Type variant="bodyStrong">Tenant responsibilities</Type>
        <View style={styles.chips}>
          {TENANT_RESPONSIBILITIES.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={form.tenantResponsibilities.includes(value)}
              onPress={() => toggle("tenantResponsibilities", value)}
            />
          ))}
        </View>
      </RecordPanel>
    </>
  );
}
function AgreementPreview({
  document,
  form,
  currency,
  onEdit,
}: {
  document: RenderedAgreement | null;
  form: FormState;
  currency: string;
  onEdit?: (step: Step) => void;
}) {
  if (!document) {
    return <Notice tone="error" title="The agreement preview is unavailable" body="Go back and generate the agreement again." />;
  }
  const editRows = [
    ["term", "Tenancy term", `${formatLeaseDate(form.startsOn)} · ${form.term} months`],
    ["payments", "Rent & payments", `${formatMinor(Math.round(Number(form.rent) * 100), currency)} per ${form.rentPeriod === "yearly" ? "year" : "month"}`],
    ["duties", "Responsibilities", "Utilities and each party’s duties"],
    ["additions", "Additional terms", form.customTitle.trim() || "Occupants, conditions and clauses"],
  ] as const;
  return (
    <>
      <ReviewList>
        {editRows.map(([target, label, value], index) => (
          <ReviewLine
            key={target}
            first={index === 0}
            icon={STEPS.find((item) => item.key === target)!.icon}
            term={label}
            value={value}
            onEdit={onEdit ? () => onEdit(target) : undefined}
          />
        ))}
      </ReviewList>
      <RecordPanel style={styles.document}>
        <View style={styles.documentHeader}>
          <View style={styles.documentIcon}>
            <Ionicons name="document-text-outline" color={theme.color.kola["800"]} size={23} />
          </View>
          <View style={styles.documentHeading}>
            <Type variant="title2" accessibilityRole="header">{document.title}</Type>
            <Type variant="caption" selectable>
              {document.reference_number} · Template {document.template.version}
            </Type>
          </View>
        </View>
        {document.production_notice ? (
          <Notice tone="warning" title="Pre-production legal review" body={document.production_notice} />
        ) : null}
        {document.sections.map((section) => (
          <View key={section.id} style={styles.clause}>
            <Type variant="bodyStrong" accessibilityRole="header">{section.title}</Type>
            <Type variant="body" selectable>{section.body}</Type>
          </View>
        ))}
      </RecordPanel>
    </>
  );
}
function validStartDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const styles = StyleSheet.create({
  panel: { padding: space[4], gap: space[4] },
  multiline: { minHeight: 100 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  document: { padding: space[4], gap: space[4] },
  documentHeader: { flexDirection: "row", alignItems: "center", gap: space[3] },
  documentHeading: { flex: 1, gap: space[1] },
  documentIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["50"],
  },
  clause: {
    gap: space[2],
    paddingTop: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.field["300"],
  },
});

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
function required(params: Record<string, string | string[]>, key: string) {
  const value = one(params[key]);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}
