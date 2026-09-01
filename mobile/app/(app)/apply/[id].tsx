import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { submitApplication, type IncomeBand } from "@/applications";
import { Button, Choice, Field, Notice, Surface, Type, space } from "@/components/ui";
import { formatMinor, getListing, type Listing } from "@/listings";
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

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
  const [loadError, setLoadError] = useState("");

  const load = useCallback(() => {
    setLoadError("");
    setListing(null);
    getListing(id)
      .then(setListing)
      .catch((cause) => setLoadError(
        cause instanceof ApiFailure ? cause.error.message : "We could not open this listing.",
      ));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const asked = listing?.advance_months ?? 0;
  const offered = Number(advance || 0);
  const shortfall = Math.max(asked - offered, 0);

  async function submit() {
    if (!Number.isInteger(offered) || offered < 0 || offered > 36) {
      setError("Advance offered must be between 0 and 36 months.");
      return;
    }
    const householdSize = household ? Number(household) : undefined;
    if (householdSize !== undefined && (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 30)) {
      setError("Household size must be between 1 and 30 people.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await submitApplication({
        listing_id: id,
        advance_months_offered: offered,
        household_size: householdSize,
        move_in_from: moveInFrom || null,
        occupation: occupation.trim(),
        employer: employer.trim(),
        income_band: incomeBand,
        message,
        guarantor_name: guarantorName,
        guarantor_phone: guarantorPhone,
        guarantor_relationship: guarantorRelationship,
      });
      router.replace("/(app)/applications");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "We could not send that application.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <View style={{ padding: space[5], gap: space[3] }}>
        <Notice tone="error" title={loadError} />
        <Button label="Try again" variant="secondary" onPress={load} />
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

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], gap: space[5] }}>
      <View style={{ gap: space[2] }}>
        <Type variant="label">APPLYING FOR</Type>
        <Type variant="title1">{listing.headline}</Type>
        <Type variant="caption">
          {listing.rent_formatted} per month · {listing.advance_label} advance asked
        </Type>
      </View>

      <Surface style={{ gap: space[3] }}>
        <Field
          label="How many months' advance can you pay?"
          hint={`This place is asking for ${asked}.`}
          value={advance}
          onChangeText={(value) => setAdvance(value.replace(/\D/g, ""))}
          keyboardType="number-pad"
          maxLength={2}
        />

        {advance && shortfall > 0 ? (
          <Notice
            tone="warning"
            title={`That is ${shortfall} month${shortfall === 1 ? "" : "s"} short of what they asked`}
            body="You can still apply. Say in your message how you would cover the rest — landlords here do negotiate, and being straight about it beats agreeing and then failing at signing."
          />
        ) : advance ? (
          <Notice
            tone="success"
            title="That meets what they asked for"
            body={`${formatMinor((listing.rent_minor ?? 0) * offered)} up front.`}
          />
        ) : null}
      </Surface>

      <Field
        label="How many people will live there?"
        value={household}
        onChangeText={(value) => setHousehold(value.replace(/\D/g, ""))}
        keyboardType="number-pad"
        maxLength={2}
      />

      <View style={{ gap: space[3] }}>
        <Type variant="title2">Your rental context</Type>
        <Type variant="caption">Optional details help the provider assess the application without collecting an exact salary.</Type>
        <Field label="Preferred move-in date" hint="YYYY-MM-DD" value={moveInFrom} onChangeText={setMoveInFrom} />
        <Field label="Occupation" value={occupation} onChangeText={setOccupation} />
        <Field label="Employer" value={employer} onChangeText={setEmployer} />
        <Choice
          label="Monthly income range"
          value={incomeBand}
          onChange={setIncomeBand}
          options={[
            { value: "under_1000", label: "Under GH₵1,000" },
            { value: "1000_3000", label: "GH₵1k–3k" },
            { value: "3000_6000", label: "GH₵3k–6k" },
            { value: "6000_10000", label: "GH₵6k–10k" },
            { value: "over_10000", label: "Over GH₵10k" },
            { value: "prefer_not_to_say", label: "Prefer not to say" },
          ]}
        />
      </View>

      <View style={{ gap: space[3] }}>
        <Type variant="title2">Someone who will vouch for you</Type>
        <Type variant="caption">
          Optional, but most landlords ask. Someone who knows you and will pick up the phone.
        </Type>
        <Field label="Their name" value={guarantorName} onChangeText={setGuarantorName} />
        <Field
          label="Their number"
          prefix="+233"
          value={guarantorPhone}
          onChangeText={setGuarantorPhone}
          keyboardType="phone-pad"
        />
        <Field
          label="How do you know them?"
          placeholder="Uncle, former landlord, employer"
          value={guarantorRelationship}
          onChangeText={setGuarantorRelationship}
        />
      </View>

      <Field
        label="Anything you want to say"
        placeholder="When you can move in, what you do, how you would cover the advance"
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={4}
        style={{ minHeight: 96, textAlignVertical: "top" }}
      />

      {error ? <Notice tone="error" title={error} /> : null}

      <Button
        label="Send application"
        busy={busy}
        busyLabel="Sending…"
        disabled={!advance}
        onPress={submit}
      />
      <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
        Everything here is what you have told us, and it is shown to the landlord as your claim,
        not as something we have checked.
      </Type>
    </ScrollView>
  );
}
