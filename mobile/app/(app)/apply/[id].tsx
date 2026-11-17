import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { submitApplication, type IncomeBand } from "@/applications";
import { Button, Choice, Field, Notice, Surface, Type, space } from "@/components/ui";
import { fieldErrorsFrom, summaryErrorFrom, type FieldErrors } from "@/formErrors";
import { useSafeBottom } from "@/platform";
import { getListing, type Listing } from "@/listings";
import { shell } from "@/shell";
import { theme } from "@/theme";

/**
 * Applying for a place.
 *
 * The form leads with the advance, because that is what the decision turns on
 * and because finding out you are short after a viewing wastes everyone's time.
 * The shortfall is shown as you type, plainly, without discouraging the person
 * from applying anyway — landlords do negotiate, and a tenant who is honest
 * about six months is a better prospect than one who disappears at signing.
 */
export default function ApplyScreen() {
  // Android draws edge-to-edge: the last row would sit under the
  // navigation buttons, which then look as though the page showed through.
  const pageBottom = useSafeBottom(space[8]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { state } = useAuth();

  const [listing, setListing] = useState<Listing | null>(null);
  const [advance, setAdvance] = useState("");
  const [household, setHousehold] = useState("");
  const [moveInFrom, setMoveInFrom] = useState("");
  const [occupation, setOccupation] = useState("");
  const [employer, setEmployer] = useState("");
  const [incomeBand, setIncomeBand] = useState<IncomeBand>("");
  const [message, setMessage] = useState("");
  const [guarantorName, setGuarantorName] = useState("");
  const [guarantorPhone, setGuarantorPhone] = useState("");
  const [guarantorRelationship, setGuarantorRelationship] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [workOpen, setWorkOpen] = useState(false);
  const [guarantorOpen, setGuarantorOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback((signal?: AbortSignal) => {
    getListing(id)
      .then((value) => {
        if (signal?.aborted) return;
        setListing(value);
        setAdvance(String(value.advance_months));
      })
      .catch((cause) => {
        if (!signal?.aborted) setLoadError(cause instanceof ApiFailure ? cause.error.message : "We could not open this listing.");
      });
  }, [id]);

  const [previousId, setPreviousId] = useState(id);
  if (previousId !== id) {
    setPreviousId(id);
    setLoadError("");
    setListing(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const asked = listing?.advance_months ?? 0;
  const offered = Number(advance || 0);
  const shortfall = Math.max(asked - offered, 0);

  async function submit() {
    if (busy || !listing) return;
    const fields: FieldErrors = {};
    if (!advance || !Number.isInteger(offered) || offered < 0 || offered > 36) fields.advance_months_offered = "Enter a whole number from 0 to 36.";
    const householdSize = household ? Number(household) : undefined;
    if (householdSize !== undefined && (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 30)) {
      fields.household_size = "Enter a household size from 1 to 30.";
    }
    if (moveInFrom) {
      const date = new Date(`${moveInFrom}T00:00:00Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== moveInFrom) {
        fields.move_in_from = "Enter a valid date in YYYY-MM-DD format.";
      }
    }
    if (Object.keys(fields).length) {
      setErrors(fields);
      setError("Check the highlighted fields above.");
      return;
    }
    setBusy(true);
    setError("");
    setErrors({});
    try {
      await submitApplication({
        listing_id: id,
        advance_months_offered: offered,
        household_size: householdSize,
        move_in_from: moveInFrom || null,
        occupation: occupation.trim(),
        employer: employer.trim(),
        income_band: incomeBand,
        message: message.trim(),
        guarantor_name: guarantorName.trim(),
        guarantor_phone: guarantorPhone.trim(),
        guarantor_relationship: guarantorRelationship.trim(),
      });
      setSent(true);
    } catch (cause) {
      const fieldErrors = fieldErrorsFrom(cause);
      setErrors(fieldErrors);
      if (fieldErrors.occupation || fieldErrors.employer || fieldErrors.income_band) setWorkOpen(true);
      if (fieldErrors.guarantor_name || fieldErrors.guarantor_phone || fieldErrors.guarantor_relationship) setGuarantorOpen(true);
      setError(summaryErrorFrom(cause, fieldErrors) || "Check the highlighted fields above.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <View style={{ padding: space[5], gap: space[3] }}>
        <Notice tone="error" title={loadError} />
        <Button label="Try again" variant="secondary" onPress={() => { setLoadError(""); setListing(null); load(); }} />
        <Button label="Back to rentals" variant="quiet" onPress={() => router.replace("/(app)/search")} />
      </View>
    );
  }

  if (!listing) {
    return (
      <View style={{ padding: space[5] }}>
        <Type variant="caption">Loading…</Type>
      </View>
    );
  }

  const area = [listing.locality_name, listing.district_name].filter(Boolean).join(", ");
  const rent = listing.rent_formatted
    ? `${listing.rent_formatted} / ${listing.rent_period === "yearly" ? "year" : "month"}`
    : "On request";

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Rental application" }} />
      <ScrollView key={sent ? "sent" : "application"} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}>
        {sent ? (
          <Surface style={styles.card}>
            <View style={styles.mark}><Ionicons name="checkmark" size={23} color={theme.color.kola["800"]} /></View>
            <Type variant="label" style={styles.eyebrow}>APPLICATION SENT</Type>
            <Type variant="title1" accessibilityRole="header">The provider has your application</Type>
            <Type variant="body">{listing.headline}</Type>
            <Type variant="caption">Follow the provider’s response in Applications.</Type>
            <Button label="View application status" onPress={() => router.replace("/(app)/applications")} />
          </Surface>
        ) : (
          <>
            <View style={styles.heading}>
              <Type variant="label" style={styles.eyebrow}>RENT WITH DANPA HQ</Type>
              <Type variant="display2" accessibilityRole="header">Rental application</Type>
              <Type variant="body">Tell the provider when you’d like to move and what you can offer.</Type>
            </View>

            <Surface style={styles.property}>
              <View style={styles.propertyTop}>
                <View style={styles.thumbnail}>
                  {listing.cover_url
                    ? <Image source={{ uri: listing.cover_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    : <Ionicons name="home-outline" size={24} color={theme.color.kola["800"]} />}
                </View>
                <View style={styles.propertyTitle}>
                  <Type variant="label" style={styles.eyebrow}>YOU’RE APPLYING FOR</Type>
                  <Type variant="bodyStrong">{listing.headline}</Type>
                  {area ? <Type variant="caption">{area}</Type> : null}
                </View>
              </View>
              <View style={styles.terms}>
                <Type variant="caption">Rent <Type variant="captionStrong">{rent}</Type></Type>
                <Type variant="caption">Advance requested <Type variant="captionStrong">{listing.advance_label}</Type></Type>
              </View>
            </Surface>

            <Surface style={styles.card}>
              <SectionHeading icon="home-outline" title="Move-in details" description="Start with the amount you can pay in advance. The date and household size are optional." />
              <Field label="Advance you can offer (months)" hint={`The provider asks for ${asked}. Enter 0 if you cannot pay an advance.`}
                value={advance} onChangeText={(value) => setAdvance(value.replace(/\D/g, ""))} keyboardType="number-pad" maxLength={2} error={errors.advance_months_offered} />
              {advance && offered <= 36 ? (
                <View style={styles.offer}>
                  <Ionicons name={shortfall ? "information-circle-outline" : "checkmark-circle-outline"} size={18} color={theme.color.kola["800"]} />
                  <Type variant="caption" accessibilityLiveRegion="polite" style={{ flex: 1 }}>
                    {shortfall ? `${shortfall} month${shortfall === 1 ? "" : "s"} below the requested advance. You can still apply.` : "Your offer meets the requested advance."}
                  </Type>
                </View>
              ) : null}
              <Field label="Preferred move-in date" placeholder="YYYY-MM-DD" hint="Year, month, day" value={moveInFrom}
                onChangeText={(value) => {
                  const digits = value.replace(/\D/g, "").slice(0, 8);
                  setMoveInFrom([digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)].filter(Boolean).join("-"));
                }} keyboardType="number-pad" maxLength={10} error={errors.move_in_from} />
              <Field label="Household size" placeholder="Number of people" value={household} onChangeText={(value) => setHousehold(value.replace(/\D/g, ""))}
                keyboardType="number-pad" maxLength={2} error={errors.household_size} />
            </Surface>

            <OptionalSection icon="briefcase-outline" title="Work and income" open={workOpen} onToggle={() => setWorkOpen(!workOpen)}>
              <Field label="Occupation" value={occupation} onChangeText={setOccupation} maxLength={120} error={errors.occupation} />
              <Field label="Employer" value={employer} onChangeText={setEmployer} maxLength={160} error={errors.employer} />
              <Choice
                label="Monthly income range" value={incomeBand} onChange={setIncomeBand}
                options={[
                  { value: "", label: "Not provided" },
                  { value: "under_1000", label: "Under GH₵1,000" },
                  { value: "1000_3000", label: "GH₵1k–3k" },
                  { value: "3000_6000", label: "GH₵3k–6k" },
                  { value: "6000_10000", label: "GH₵6k–10k" },
                  { value: "over_10000", label: "Over GH₵10k" },
                  { value: "prefer_not_to_say", label: "Prefer not to say" },
                ]}
              />
              {errors.income_band ? <Notice tone="error" title={errors.income_band} /> : null}
            </OptionalSection>

            <OptionalSection icon="people-outline" title="Guarantor" open={guarantorOpen} onToggle={() => setGuarantorOpen(!guarantorOpen)}>
              <Field label="Guarantor name" value={guarantorName} onChangeText={setGuarantorName} maxLength={160} error={errors.guarantor_name} />
              <Field label="Guarantor mobile number" placeholder="024 123 4567" hint="Use a Ghana mobile number." value={guarantorPhone} onChangeText={setGuarantorPhone}
                keyboardType="phone-pad" maxLength={20} error={errors.guarantor_phone} />
              <Field label="Relationship to you" placeholder="For example, former landlord" value={guarantorRelationship} onChangeText={setGuarantorRelationship}
                maxLength={60} error={errors.guarantor_relationship} />
            </OptionalSection>

            <Surface style={styles.card}>
              <SectionHeading icon="mail-outline" title="Note to the provider" description="Optional · Share anything else you’d like them to know." />
              <Field label="Your note" placeholder="For example, let them know if your move-in date is flexible."
                value={message} onChangeText={setMessage} multiline numberOfLines={4} maxLength={1000}
                error={errors.message} style={{ minHeight: 104, textAlignVertical: "top" }} />
              <Type variant="caption" style={{ textAlign: "right" }}>{message.length} / 1,000</Type>
            </Surface>

            {error ? <Notice tone="error" title={error} /> : null}
            <View style={styles.submit}>
              <Type variant="caption">Applying sends your details to the provider and does not create a tenancy.</Type>
              {state.status === "signed_in" && !state.me.is_phone_verified && state.me.email ? (
                <Type variant="caption">{state.me.is_email_verified ? "We’ll send updates by email." : "Verify your email to receive updates there."}</Type>
              ) : null}
              <Button label="Submit application" busy={busy} busyLabel="Sending…" onPress={() => void submit()} />
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type IconName = keyof typeof Ionicons.glyphMap;

function SectionHeading({ icon, title, description }: { icon: IconName; title: string; description?: string }) {
  return <View style={styles.sectionHeading}>
    <View style={styles.mark}><Ionicons name={icon} size={18} color={theme.color.kola["800"]} /></View>
    <View style={styles.headingText}>
      <Type variant="title2" accessibilityRole="header">{title}</Type>
      {description ? <Type variant="caption">{description}</Type> : null}
    </View>
  </View>;
}

function OptionalSection({ icon, title, open, onToggle, children }: {
  icon: IconName; title: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return <Surface style={styles.optional}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}, optional`} aria-expanded={open}
      onPress={onToggle} style={({ pressed }) => [styles.optionalTrigger, pressed && styles.pressed]}>
      <View style={styles.mark}><Ionicons name={icon} size={18} color={theme.color.kola["800"]} /></View>
      <Type variant="bodyStrong" style={{ flex: 1 }}>{title}</Type>
      <Type variant="caption">Optional</Type>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={theme.color.ink["700"]} />
    </Pressable>
    {open ? <View style={styles.optionalBody}>{children}</View> : null}
  </Surface>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: shell.record },
  page: { width: "100%", maxWidth: 560, alignSelf: "center", padding: space[5], gap: space[3] },
  heading: { gap: space[2], paddingBottom: space[3] },
  eyebrow: { color: theme.color.kola["800"] },
  property: { gap: space[3], padding: space[4], marginBottom: space[2] },
  propertyTop: { flexDirection: "row", alignItems: "center", gap: space[3] },
  thumbnail: { width: 72, height: 72, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: theme.color.field["100"], borderRadius: 12 },
  propertyTitle: { flex: 1, gap: space[1] },
  terms: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.color.field["300"], paddingTop: space[3], gap: space[1] },
  card: { gap: space[4], padding: space[4] },
  sectionHeading: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  headingText: { flex: 1, gap: space[1] },
  mark: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: theme.color.field["100"] },
  offer: { flexDirection: "row", alignItems: "flex-start", gap: space[2], padding: space[3], borderRadius: 10, backgroundColor: theme.color.field["100"] },
  optional: { padding: 0 },
  optionalTrigger: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[4], borderRadius: 12 },
  pressed: { backgroundColor: theme.color.field["100"] },
  optionalBody: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.color.field["300"], padding: space[4], gap: space[4] },
  submit: { gap: space[3], paddingTop: space[3] },
});
