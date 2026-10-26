import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Chip, Choice, Field, Notice, Surface, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import {
  draftLease,
  leaseAction,
  updateLease,
  type Lease,
  type LeaseStructuredTerms,
  type RenderedAgreement,
} from "@/leases";
import { theme } from "@/theme";

/**
 * Preparing a tenancy agreement, on a phone.
 *
 * This is the highest-trust thing a provider does in Danpa HQ, and the screen it
 * replaced was a modal with a rent box and one free-text field that sent the
 * offer the moment it was submitted. The difference is not decoration:
 *
 * **The provider supplies terms; Danpa HQ writes the agreement.** Nobody drafts
 * a tenancy agreement here. The seven stops below collect structured values and
 * the backend renders them into the versioned Ghana template. That is what
 * makes the standard clauses controlled rather than editable, and it is why
 * "Generate agreement" is a server round-trip and not a client-side preview.
 *
 * **Nothing already known is asked for again.** The parties and the rental
 * space arrive on the accepted request; the first two stops say so rather than
 * asking. They exist because a person walking a seven-step journey needs to see
 * what is already settled, not because there is anything to fill in.
 *
 * **Review shows the real document.** Not a summary of the inputs — the exact
 * rendered agreement that will be frozen, with the reference number and the
 * template version it came from. The edit links go back to the structured
 * section that owns each part, never into the wording.
 *
 * **Ready and Sent are two different acts.** Reaching Review marks the lease
 * Ready; sending is a separate deliberate press. An offer is the provider's
 * acceptance, so it should not be a side effect of finishing a form.
 *
 * The advance is *recorded* rather than policed. Whether Act 220's limit binds
 * a given tenancy is a legal question the backend's `advance_policy` answers
 * under a configured stance — see `docs/legal/`. A form is not the place to
 * decide it.
 */
const STEPS = [
  "Parties",
  "Property & Unit",
  "Term",
  "Rent & payments",
  "Responsibilities",
  "Additional terms",
  "Review",
] as const;
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
  const pageBottom = useSafeBottom(space[12]);
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const [step, setStep] = useState(0);
  const [lease, setLease] = useState<Lease | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>({
    rent: Number(one(params.rentMinor)) > 0 ? String(Number(one(params.rentMinor)) / 100) : "",
    rentPeriod: "monthly",
    advance: one(params.advanceMonths) || "1",
    deposit: "0",
    agencyFee: "0",
    startsOn: "",
    term: "12",
    paymentDue: "on the first day of each rental period",
    water: "tenant",
    electricity: "tenant",
    providerResponsibilities: PROVIDER_RESPONSIBILITIES.map(([value]) => value),
    tenantResponsibilities: TENANT_RESPONSIBILITIES.map(([value]) => value),
    occupants: "",
    conditions: "",
    customTitle: "",
    customBody: "",
  });
  const structured = useMemo<LeaseStructuredTerms>(
    () => ({
      payment_due: form.paymentDue,
      utilities: { water: form.water, electricity: form.electricity },
      occupants: form.occupants
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
      provider_responsibilities: form.providerResponsibilities,
      tenant_responsibilities: form.tenantResponsibilities,
      notice_channels: ["Danpa HQ", "written notice"],
      additional_terms:
        form.customTitle.trim() && form.customBody.trim()
          ? [{ title: form.customTitle.trim(), body: form.customBody.trim() }]
          : [],
    }),
    [form],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  function toggle(key: "providerResponsibilities" | "tenantResponsibilities", value: string) {
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
  }
  function issue() {
    if (step === 2 && !form.startsOn) return "Choose when the tenancy starts.";
    if (step === 2 && Number(form.term) < 1) return "Enter a valid term.";
    if (step === 3 && Number(form.rent) <= 0) return "Enter the rent amount.";
    if (
      step === 4 &&
      (!form.providerResponsibilities.length || !form.tenantResponsibilities.length)
    )
      return "Choose responsibilities for both parties.";
    if (step === 5 && Boolean(form.customTitle.trim()) !== Boolean(form.customBody.trim()))
      return "Give the additional term both a title and its complete wording.";
    return "";
  }

  async function prepareReview() {
    const problem = issue();
    if (problem) {
      setError(problem);
      return;
    }
    const payload = {
      rent_minor: Math.round(Number(form.rent) * 100),
      rent_currency: "GHS",
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
      current = await leaseAction(current.id, "ready");
      setLease(current);
      setStep(6);
    } catch (cause) {
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
    if (!lease) return;
    setBusy(true);
    setError("");
    try {
      const sent = await leaseAction(lease.id, "offer");
      router.replace({ pathname: "/(app)/provider-lease", params: { leaseId: sent.id } } as never);
    } catch (cause) {
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
    setError("");
    if (step === 5) void prepareReview();
    else setStep((current) => Math.min(current + 1, 6));
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[5] }}
    >
      <View style={{ gap: space[2] }}>
        <Type variant="label">AGREEMENT BUILDER</Type>
        <Type variant="display2" accessibilityRole="header">
          Prepare the tenancy agreement
        </Type>
        <Type variant="caption">
          Known identities and rental details stay attached to the accepted request. You only set
          the negotiable terms.
        </Type>
      </View>
      <Checkpoint step={step} />
      <View style={{ gap: space[1] }}>
        <Type variant="caption">
          {step + 1} of {STEPS.length}
        </Type>
        <Type variant="title1" accessibilityRole="header">
          {STEPS[step]}
        </Type>
      </View>
      {step === 0 ? (
        <Known
          title="Parties are already known"
          body="The provider comes from your current Danpa HQ account. The tenant comes from the accepted request. Both identities are copied into the frozen agreement."
        />
      ) : null}
      {step === 1 ? (
        <Known
          title="The home stays connected"
          body="The selected Property, Unit and any bed remain linked to the approved request. No address or unit details need to be typed again."
        />
      ) : null}
      {step === 2 ? (
        <View style={{ gap: space[4] }}>
          <Field
            label="Tenancy starts (YYYY-MM-DD)"
            value={form.startsOn}
            onChangeText={(value) => update("startsOn", value)}
            autoCapitalize="none"
            placeholder="2026-09-01"
          />
          <Field
            label="Length (months)"
            value={form.term}
            onChangeText={(value) => update("term", value.replace(/\D/g, ""))}
            keyboardType="number-pad"
          />
        </View>
      ) : null}
      {step === 3 ? (
        <View style={{ gap: space[4] }}>
          <Field
            label="Rent (GH₵)"
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
          <Field
            label="Advance months"
            value={form.advance}
            onChangeText={(value) => update("advance", value.replace(/\D/g, ""))}
            keyboardType="number-pad"
          />
          <Field
            label="Deposit months"
            value={form.deposit}
            onChangeText={(value) => update("deposit", value.replace(/\D/g, ""))}
            keyboardType="number-pad"
          />
          <Field
            label="Agency fee months"
            value={form.agencyFee}
            onChangeText={(value) => update("agencyFee", value.replace(/\D/g, ""))}
            keyboardType="number-pad"
          />
          <Field
            label="Payment due"
            value={form.paymentDue}
            onChangeText={(value) => update("paymentDue", value)}
          />
        </View>
      ) : null}
      {step === 4 ? <Responsibilities form={form} update={update} toggle={toggle} /> : null}
      {step === 5 ? (
        <View style={{ gap: space[4] }}>
          <Field
            label="Other permitted occupants (one per line)"
            value={form.occupants}
            onChangeText={(value) => update("occupants", value)}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            style={{ minHeight: 92 }}
          />
          <Field
            label="Practical conditions (optional)"
            value={form.conditions}
            onChangeText={(value) => update("conditions", value)}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            style={{ minHeight: 92 }}
          />
          <View style={{ height: 1, backgroundColor: theme.color.field["300"] }} />
          <Type variant="bodyStrong">Additional custom term</Type>
          <Type variant="caption">
            Provider-supplied wording is labelled separately from Danpa HQ standard clauses.
          </Type>
          <Field
            label="Term title"
            value={form.customTitle}
            onChangeText={(value) => update("customTitle", value)}
          />
          <Field
            label="Complete wording"
            value={form.customBody}
            onChangeText={(value) => update("customBody", value)}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            style={{ minHeight: 110 }}
          />
        </View>
      ) : null}
      {step === 6 ? (
        <AgreementPreview
          document={lease?.builder_preview?.rendered_document ?? null}
          onEdit={setStep}
        />
      ) : null}
      {error ? <Notice tone="error" title={error} /> : null}
      <View
        style={{
          gap: space[2],
          paddingTop: space[4],
          borderTopWidth: 1,
          borderTopColor: theme.color.field["200"],
        }}
      >
        {step < 6 ? (
          <Button
            label={step === 5 ? "Generate agreement" : "Continue"}
            busy={busy}
            busyLabel="Generating preview…"
            onPress={next}
          />
        ) : (
          <Button
            label="Send to tenant"
            busy={busy}
            busyLabel="Sending…"
            onPress={() => void send()}
          />
        )}
        {step > 0 ? (
          <Button
            label="Back"
            variant="quiet"
            disabled={busy}
            onPress={() => setStep((current) => current - 1)}
          />
        ) : (
          <Button label="Exit builder" variant="quiet" onPress={() => router.back()} />
        )}
      </View>
    </ScrollView>
  );
}

function Checkpoint({ step }: { step: number }) {
  const previous = STEPS[Math.max(step - 1, 0)];
  const current = STEPS[step];
  const next = STEPS[Math.min(step + 1, STEPS.length - 1)];
  return (
    <View
      accessible
      accessibilityLabel={`Step ${step + 1} of ${STEPS.length}, ${current}`}
      style={{
        paddingVertical: space[4],
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: theme.color.field["200"],
        gap: space[2],
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space[2],
        }}
      >
        <Type variant="caption" style={{ flex: 1 }}>
          {step > 0 ? `✓ ${previous}` : "Start"}
        </Type>
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: theme.color.kola["600"],
          }}
        />
        <Type variant="bodyStrong" style={{ flex: 1, textAlign: "center" }}>
          {current}
        </Type>
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: theme.color.field["300"],
          }}
        />
        <Type variant="caption" style={{ flex: 1, textAlign: "right" }}>
          {step < 6 ? next : "Ready"}
        </Type>
      </View>
      <Type variant="label" style={{ textAlign: "center" }}>
        {step + 1} OF {STEPS.length}
      </Type>
    </View>
  );
}
function Known({ title, body }: { title: string; body: string }) {
  return (
    <Surface style={{ gap: space[2], borderRadius: 2 }}>
      <Type variant="title2">{title}</Type>
      <Type variant="body">{body}</Type>
    </Surface>
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
    <View style={{ gap: space[5] }}>
      <Choice
        label="Water"
        value={form.water}
        options={utilities}
        onChange={(value) => update("water", value)}
      />
      <Choice
        label="Electricity"
        value={form.electricity}
        options={utilities}
        onChange={(value) => update("electricity", value)}
      />
      <View style={{ gap: space[2] }}>
        <Type variant="bodyStrong">Provider responsibilities</Type>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {PROVIDER_RESPONSIBILITIES.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={form.providerResponsibilities.includes(value)}
              onPress={() => toggle("providerResponsibilities", value)}
            />
          ))}
        </View>
      </View>
      <View style={{ gap: space[2] }}>
        <Type variant="bodyStrong">Tenant responsibilities</Type>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {TENANT_RESPONSIBILITIES.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              selected={form.tenantResponsibilities.includes(value)}
              onPress={() => toggle("tenantResponsibilities", value)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
function AgreementPreview({
  document,
  onEdit,
}: {
  document: RenderedAgreement | null;
  onEdit: (step: number) => void;
}) {
  if (!document) return <Type variant="caption">Generating agreement…</Type>;
  return (
    <View style={{ gap: space[5] }}>
      <Surface style={{ borderRadius: 2, gap: space[3] }}>
        <Type variant="label" style={{ textAlign: "center" }}>
          {document.reference_number}
        </Type>
        <Type variant="title1" style={{ textAlign: "center" }}>
          {document.title}
        </Type>
        <Type variant="caption" style={{ textAlign: "center" }}>
          Template {document.template.version}
        </Type>
        {document.production_notice ? (
          <Notice
            tone="warning"
            title="Pre-production legal review"
            body={document.production_notice}
          />
        ) : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
          {[
            [2, "Edit term"],
            [3, "Edit payments"],
            [4, "Edit duties"],
            [5, "Edit additions"],
          ].map(([target, label]) => (
            <Pressable
              key={String(label)}
              accessibilityRole="button"
              onPress={() => onEdit(Number(target))}
              style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: space[2] }}
            >
              <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
                {label}
              </Type>
            </Pressable>
          ))}
        </View>
        {document.sections.map((section) => (
          <View
            key={section.id}
            style={{
              gap: space[2],
              paddingTop: space[4],
              borderTopWidth: 1,
              borderTopColor: theme.color.field["200"],
            }}
          >
            <Type variant="bodyStrong">{section.title}</Type>
            <Type variant="body" selectable style={{ lineHeight: 26 }}>
              {section.body}
            </Type>
          </View>
        ))}
      </Surface>
    </View>
  );
}
function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
function required(params: Record<string, string | string[]>, key: string) {
  const value = one(params[key]);
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}
