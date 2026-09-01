/**
 * Submitting a property for verification, on a phone.
 *
 * A separate flow from creating one, reached from the property, and read-only:
 * this is what a reviewer will see, shown back before it goes. Nothing here
 * changes anything — the way to change something is to go and change it, which
 * every row links to.
 *
 * It sends **one** thing. A property is two reviews underneath — the document
 * that says it is yours to let, and the photographs that say it is what you
 * describe — and they are decided together, so they queue together.
 *
 * Mirrors `web/app/properties/[id]/verify`. Same states, same words, this
 * platform's idiom (ADR 0014).
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Notice, Surface, Type, space } from "@/components/ui";
import {
  getProperty,
  getPropertyAmenities,
  submitPropertyForVerification,
  type Property,
  type SpaceAmenity,
} from "@/provider";
import { theme } from "@/theme";
import { getVerification, type VerificationProgress } from "@/verification";

export default function PropertyVerifyScreen() {
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const router = useRouter();

  const [property, setProperty] = useState<Property | null>(null);
  const [photos, setPhotos] = useState<VerificationProgress | null>(null);
  const [amenities, setAmenities] = useState<SpaceAmenity[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    try {
      const [prop, progress, amenityState] = await Promise.all([
        getProperty(propertyId),
        getVerification("property", propertyId),
        getPropertyAmenities(propertyId),
      ]);
      setProperty(prop);
      setPhotos(progress);
      setAmenities(amenityState.chosen);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load this property.",
      );
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!property) {
    return (
      <View style={{ padding: space[5] }}>
        {error ? <Notice tone="error" title={error} /> : <Type variant="caption">Loading…</Type>}
      </View>
    );
  }

  const back = () =>
    router.replace({ pathname: "/(app)/provider-property", params: { propertyId } });

  if (sent) {
    return (
      <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4] }}>
        <Notice
          tone="success"
          title="Sent for verification"
          body="Our team has it. We will let you know the outcome — you do not need to do anything else. Meanwhile you can add the spaces inside it; none of them wait on this."
        />
        <Button label="Go to the property" onPress={back} />
      </ScrollView>
    );
  }

  const { verification } = property;

  if (verification.state === "submitted" || verification.state === "under_review") {
    return (
      <ScrollView contentContainerStyle={{ padding: space[5], gap: space[4] }}>
        <Notice
          tone="info"
          title="This property is already with our team"
          body="You can view the submission or take it back from the property page."
        />
        <Button label="Go to the property" onPress={back} />
      </ScrollView>
    );
  }

  const submit = property.permitted_actions.submit_for_verification;
  const address = property.address;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space[5], gap: space[5] }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: space[2] }}>
        <Type variant="display2">Submit for verification</Type>
        <Type variant="caption">
          This is what our team will see. Look it over — once it is sent you
          cannot change the property until they come back to you, though you can
          always take it back out of the queue.
        </Type>
      </View>

      <Surface style={{ gap: space[3] }}>
        <Type variant="title2">The property</Type>
        <Row term="Name" value={property.title || "Untitled"} />
        <Row term="Kind" value={property.property_type.replace(/_/g, " ")} />
        <Row
          term="Address"
          value={
            address
              ? [address.locality_name, address.district_name].filter(Boolean).join(", ")
              : "No address recorded"
          }
        />
        <Row term="Water" value={property.water_source.replace(/_/g, " ")} />
        <Row term="Electricity" value={property.power_meter_type.replace(/_/g, " ")} />
        <Row term="Compound" value={property.compound_type.replace(/_/g, " ")} />
      </Surface>

      <Surface style={{ gap: space[3] }}>
        <Type variant="title2">What our team will decide</Type>
        <Row
          term="Ownership document"
          value={
            verification.authority.state === "draft"
              ? "Not added"
              : verification.authority.state === "verified"
                ? "Already confirmed"
                : "Added, ready to send"
          }
        />
        <Row
          term="Photographs"
          value={
            photos
              ? `${photos.required_total - photos.required_outstanding} of ${photos.required_total} required views`
              : "Loading…"
          }
        />
        <Row
          term="What the compound has"
          value={
            amenities === null
              ? "Loading…"
              : amenities.length
                ? amenities.map((amenity) => amenity.name).join(", ")
                : "Nothing shared recorded"
          }
        />
      </Surface>

      {error ? <Notice tone="error" title={error} /> : null}
      {!submit?.allowed && submit?.blockers?.length ? (
        <Notice
          tone="warning"
          title="Not ready to send yet"
          body={submit.blockers.map((blocker) => blocker.message).join(" ")}
        />
      ) : null}

      <Button
        label="Submit for verification"
        busy={busy}
        disabled={!submit?.allowed}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            await submitPropertyForVerification(propertyId);
            setSent(true);
          } catch (cause) {
            setError(
              cause instanceof ApiFailure
                ? cause.error.message
                : "Could not send this for verification.",
            );
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button label="Not yet" variant="quiet" onPress={back} />
    </ScrollView>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <View
      style={{
        gap: space[1],
        paddingTop: space[2],
        borderTopWidth: 1,
        borderTopColor: theme.color.field["200"],
      }}
    >
      <Type variant="caption">{term}</Type>
      <Type variant="body">{value}</Type>
    </View>
  );
}
