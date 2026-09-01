/**
 * One rentable space, and everything that happens to it.
 *
 * Organised around the three lifecycles rather than the database: what the
 * space *is*, whether it has been **checked**, and — once it has — whether it
 * is kept **private** or **published**. Those are separate decisions taken at
 * different times, and the property screen used to collapse them into a row of
 * buttons where each implied the next.
 *
 * What to do next is at the top, because a provider opening this screen on a
 * phone has one question and should not have to scroll past six panels to find
 * the answer. Every gated control reads `permitted_actions` from the backend and
 * shows the blocker it returns — the same decision the API enforces, said before
 * the work rather than after it.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Pressable, ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Field, Notice, Surface, Type, space } from "@/components/ui";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { SpaceLifecycle } from "@/components/property/SpaceLifecycle";
import { UnitAccessCodeManagement } from "@/components/property/UnitAccessCodeManagement";
import { UnitLifecycleActions } from "@/components/property/UnitLifecycleActions";
import { SpacePhotos } from "@/components/property/SpacePhotos";
import {
  Disclosure,
  EntityHeader,
  LoadingRows,
  StatusLine,
  spaceStatus,
} from "@/components/property/WorkspacePatterns";
import type { Listing } from "@/listings";
import { destructiveConfirmStyle, pressableFeedback } from "@/platform";
import {
  createBed,
  createListing,
  getUnit,
  listMyListings,
  publishListing,
  requestUnitRecheck,
  updateUnit,
  withdrawListing,
  withdrawSpaceSubmission,
  type UnitDetail,
} from "@/provider";
import { theme } from "@/theme";
import { submitForReview } from "@/verification";

export default function SpaceScreen() {
  const { unitId } = useLocalSearchParams<{ unitId: string }>();
  const router = useRouter();

  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!unitId) return;
    try {
      const [detail, listings] = await Promise.all([getUnit(unitId), listMyListings()]);
      setUnit(detail);
      setListing(
        listings.find((row) => row.unit === unitId && row.status !== "rejected") ?? null,
      );
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load this Unit.",
      );
    }
  }, [unitId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!unit) {
    return (
      <View style={{ padding: space[5] }}>
        {error ? <Notice tone="error" title={error} body="Return to the Property and try again." /> : <LoadingRows rows={5} />}
      </View>
    );
  }

  const where = [
    unit.property.title,
    unit.wing ? `${unit.wing} wing` : "",
    unit.floor_level === null
      ? ""
      : unit.floor_level === 0
        ? "ground floor"
        : `floor ${unit.floor_level}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const isHostelRoom =
    unit.property.property_type === "hostel" && unit.space_type === "room";
  const status = spaceStatus(unit);
  const photo = unit.primary_photo?.download_url ?? unit.media[0]?.download_url ?? null;

  return (
    <ScrollView
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[5] }}
      keyboardShouldPersistTaps="handled"
    >
      <EntityHeader
        eyebrow={unit.space_type_label}
        title={unit.label || "Unnamed Unit"}
        subtitle={where}
        status={<StatusLine label={status.label} tone={status.tone} />}
      />

      {error ? <Notice tone="error" title={error} body="Some information may be out of date. Try again." /> : null}
      <WhatIsNext unit={unit} listing={listing} onChanged={load} />

      <View style={{ height: 220, borderRadius: 8, overflow: "hidden", backgroundColor: theme.color.field["100"], alignItems: "center", justifyContent: "center" }}>
        {photo ? <Image source={{ uri: photo }} accessibilityLabel={unit.label || "Unit"} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : <Type variant="caption">No Unit photo yet</Type>}
      </View>

      <View>
        <Type variant="title2" style={{ marginBottom: space[3] }}>Unit information</Type>
        <Fact label="Type" value={unit.space_type_label} />
        <Fact label="Bedrooms" value={String(unit.bedrooms)} />
        <Fact label="Bathrooms" value={String(unit.bathrooms)} />
        <Fact label="Furnished" value={unit.is_furnished ? "Yes" : "No"} />
      </View>

      <View>
        <Type variant="title2" style={{ marginBottom: space[3] }}>Manage this Unit</Type>
        <Disclosure title={`Photos${unit.photo_count ? ` (${unit.photo_count})` : ""}`} initiallyOpen={unit.verification.state !== "verified"}>
          <Type variant="caption">
            {unit.availability.state === "occupied"
              ? "These checked photos are protected while the Unit is occupied."
              : unit.verification.state === "verified"
                ? "These are the photos that were checked. Start a re-check before changing them."
                : "The first photo is the primary view used for verification and tenant-facing presentation."}
          </Type>
          <SpacePhotos unitId={unit.id} editable={Boolean(unit.permitted_actions.edit?.allowed)} onChanged={load} />
        </Disclosure>

        <Disclosure title={`Amenities${unit.amenities.length ? ` (${unit.amenities.length})` : ""}`}>
          {unit.permitted_actions.edit?.allowed ? (
            <SpaceAmenities scope="unit" id={unit.id} onSaved={load} />
          ) : unit.amenities.length ? (
            <Type variant="body">{unit.amenities.map((row) => row.name).join(" · ")}</Type>
          ) : <Type variant="caption">No Unit amenities recorded.</Type>}
        </Disclosure>

        <Disclosure title="Details and entrance directions">
          <Details unit={unit} onSaved={load} />
        </Disclosure>

        {isHostelRoom ? (
          <Disclosure title={`Beds${unit.beds.length ? ` (${unit.beds.length})` : ""}`}>
            <Beds unit={unit} onChanged={load} />
          </Disclosure>
        ) : null}

        <Disclosure title="Verification and publication details">
          <SpaceLifecycle verification={unit.verification} publication={unit.publication} availability={unit.availability} />
          {unit.verification.decision_note ? <Notice tone="info" title="Review note" body={unit.verification.decision_note} /> : null}
        </Disclosure>

        <UnitLifecycleActions unit={unit} />
      </View>

      {/* The code belongs to this Unit, so it is managed from this Unit
          rather than only from the Portfolio's tenant work. */}
      <UnitAccessCodeManagement
        unitId={unit.id}
        accessCode={unit.access_code}
        verified={unit.verification.state === "verified"}
        occupied={unit.availability.state === "occupied"}
        onChanged={load}
      />

      <View style={{ gap: space[2], paddingTop: space[2] }}>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/(app)/(provider-tabs)/tenants" as never)}
          {...pressableFeedback(theme.color.field["200"])}
          style={{ minHeight: 48, justifyContent: "center" }}
        >
          <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
            Tenancy requests and tenancies →
          </Type>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[4] }}>
      <Type variant="caption">{label}</Type>
      <Type variant="bodyStrong">{value}</Type>
    </View>
  );
}

// --- the one thing to do next -------------------------------------------------

function WhatIsNext({
  unit,
  listing,
  onChanged,
}: {
  unit: UnitDetail;
  listing: Listing | null;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [composing, setComposing] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const submit = unit.permitted_actions.submit_for_verification;
  const publish = unit.permitted_actions.publish;
  const recheck = unit.permitted_actions.recheck;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (unit.availability.state === "occupied") {
    return (
      <Surface style={{ gap: space[3] }}>
        <Notice
          tone="info"
          title="Currently occupied"
          body="Rooomly will not accept new requests while someone lives here. Manage the tenant or end the occupancy from Tenants."
        />
      </Surface>
    );
  }

  if (unit.verification.state !== "verified") {
    const waiting =
      unit.verification.state === "submitted" || unit.verification.state === "under_review";
    // The property's own review being outstanding is a different wait from a
    // missing photograph, and the screen used to report both as a photo count —
    // which is how somebody ends up adding pictures to a space that was already
    // complete.
    const waitingOnProperty = Boolean(
      submit?.blockers?.some((blocker) => blocker.kind.startsWith("verification_")),
    );

    return (
      <Surface style={{ gap: space[3] }}>
        <Type variant="title2">Get this Unit checked</Type>
        <Type variant="caption">
          {waiting
            ? "It is with our team. We will let you know the outcome — there is nothing more to do here, and the rest of the property is unaffected."
            : "Until it passes, no private access code can be shared and it cannot be advertised. Everything else about the Unit stays yours to edit."}
        </Type>

        {unit.verification.state === "draft" ||
        unit.verification.state === "ready_for_submission" ? (
          <Button
            label="Continue setup"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: "/(app)/space-new",
                params: {
                  propertyId: unit.property.id,
                  unitId: unit.id,
                  step: unit.verification.can_submit ? "review" : "amenities",
                },
              })
            }
          />
        ) : null}

        {unit.verification.decision_note ? (
          <Notice
            tone="warning"
            title="From our review team"
            body={unit.verification.decision_note}
          />
        ) : null}
        {error ? <Notice tone="error" title={error} /> : null}

        {/* With a reviewer: no submit, and a way to take it back — the same
            shape the property screen uses, because it is the same act one level
            down. */}
        {waiting ? (
          unit.permitted_actions.withdraw_submission?.allowed ? (
            <Button
              label="Withdraw submission"
              variant="quiet"
              busy={busy}
              onPress={() =>
                void run(() =>
                  withdrawSpaceSubmission(unit.id, "Withdrawn by the provider."),
                )
              }
            />
          ) : null
        ) : submit?.allowed ? (
          <Button
            label="Send for checking"
            busy={busy}
            onPress={() => void run(() => submitForReview("unit", unit.id))}
          />
        ) : (
          <>
            <Notice
              tone="info"
              title={
                waitingOnProperty
                  ? "The entire property has to be verified first"
                  : "This cannot be sent yet"
              }
              body={
                submit?.message ??
                `${unit.verification.required_outstanding} of ${unit.verification.required_total} photos still needed. Add them under Photos below.`
              }
            />
            {waitingOnProperty ? (
              <Button
                label="Open the property"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: "/(app)/provider-property",
                    params: { propertyId: unit.property.id },
                  })
                }
              />
            ) : null}
            {/* Complete on its own terms but refused: offering the call is what
                turns a silent refusal into a stated one. */}
            {unit.verification.can_submit ? (
              <Button
                label="Try sending anyway"
                variant="quiet"
                busy={busy}
                onPress={() => void run(() => submitForReview("unit", unit.id))}
              />
            ) : null}
          </>
        )}
      </Surface>
    );
  }

  return (
    <Surface style={{ gap: space[3] }}>
      <Type variant="title2">
        {unit.publication.state === "published"
          ? "This Unit is public"
          : "Checked. Now decide who sees it."}
      </Type>
      <Type variant="caption">
        {unit.publication.state === "published"
          ? "It is in Explore and anyone can request a viewing. Taking it down does not undo the check."
          : "Being checked is not being advertised. Keep it private and share its access code, or publish it to Explore."}
      </Type>

      {error ? <Notice tone="error" title={error} /> : null}

      {unit.publication.state === "published" && listing ? (
        <Button
          label="Take it out of Explore…"
          variant="destructive"
          busy={busy}
          onPress={() => {
            Alert.alert(
              "Take this Unit out of Explore?",
              "Existing viewing and tenancy records remain. The Unit stays verified and can be published again later if it is still available.",
              [
                { text: "Keep it public", style: "cancel" },
                {
                  text: "Take it down",
                  style: destructiveConfirmStyle,
                  onPress: () =>
                    void run(() =>
                      withdrawListing(listing.id, "Taken down by the provider"),
                    ),
                },
              ],
            );
          }}
        />
      ) : listing && publish?.allowed ? (
        <Button
          label="Publish to Explore"
          busy={busy}
          onPress={() => void run(() => publishListing(listing.id))}
        />
      ) : !listing && publish?.allowed ? (
        <Button
          label={composing ? "Not now" : "Publish to Explore"}
          onPress={() => setComposing((open) => !open)}
        />
      ) : null}

      {!publish?.allowed && publish?.message ? (
        <Notice tone="info" title="This cannot be published" body={publish.message} />
      ) : null}

      {composing && !listing ? (
        <ComposeListing
          unitId={unit.id}
          onDone={async () => {
            setComposing(false);
            await onChanged();
          }}
        />
      ) : null}

      {recheck?.allowed ? (
        <Button
          label={rechecking ? "Never mind" : "Change what was checked"}
          variant="quiet"
          onPress={() => setRechecking((open) => !open)}
        />
      ) : null}

      {rechecking ? (
        <View style={{ gap: space[3] }}>
          <Notice
            tone="warning"
            title="A re-check takes this out of Explore"
          body="The check stays on record, and this Unit goes back to draft so you can change its details and photos. It has to be checked again before private access or advertising becomes available."
          />
          <Button
            label="Reopen this Unit"
            variant="destructive"
            busy={busy}
            onPress={() =>
              void run(async () => {
                await requestUnitRecheck(unit.id, "Reopened to change the Unit.");
                setRechecking(false);
              })
            }
          />
        </View>
      ) : null}
    </Surface>
  );
}

// --- details ------------------------------------------------------------------

function Details({ unit, onSaved }: { unit: UnitDetail; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState(unit.label);
  const [description, setDescription] = useState(unit.description);
  const [entrance, setEntrance] = useState(unit.entrance_note);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const fullEditable = Boolean(unit.permitted_actions.edit?.allowed);
  const operationalEditable = Boolean(unit.permitted_actions.edit_operational?.allowed);

  if (!fullEditable && !operationalEditable) {
    return (
      <View style={{ gap: space[2] }}>
        <Type variant="body">{unit.label || "Not named"}</Type>
        {unit.description ? <Type variant="caption">{unit.description}</Type> : null}
        <Type variant="caption">
          {unit.bedrooms} bedroom{unit.bedrooms === 1 ? "" : "s"} · {unit.bathrooms} bathroom
          {unit.bathrooms === 1 ? "" : "s"}
        </Type>
        <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
          {unit.permitted_actions.edit?.message ?? "These cannot be changed at the moment."}
        </Type>
      </View>
    );
  }

  return (
    <View style={{ gap: space[3] }}>
      {fullEditable ? <Field
        label="What do you call it?"
        value={label}
        onChangeText={(value) => {
          setSaved(false);
          setLabel(value);
        }}
      /> : <Type variant="body">{unit.label || "Not named"}</Type>}
      {!fullEditable ? (
        <Notice
          tone="info"
          title="Checked details are protected"
          body={unit.permitted_actions.edit?.message}
        />
      ) : null}
      {fullEditable ? <Field
        label="Describe it"
        value={description}
        onChangeText={(value) => {
          setSaved(false);
          setDescription(value);
        }}
        multiline
      /> : null}
      <Field
        label="How to find the door"
        hint="Never shown publicly."
        value={entrance}
        onChangeText={(value) => {
          setSaved(false);
          setEntrance(value);
        }}
      />
      {error ? <Notice tone="error" title={error} /> : null}
      {saved ? (
        <Type variant="caption" style={{ color: theme.color.kola["600"] }}>
          Saved
        </Type>
      ) : null}
      <Button
        label="Save details"
        variant="secondary"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            await updateUnit(unit.id, {
              entrance_note: entrance,
              ...(fullEditable ? { label, description } : {}),
            });
            setSaved(true);
            await onSaved();
          } catch (cause) {
            setError(cause instanceof ApiFailure ? cause.error.message : "That did not save.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

// --- beds ---------------------------------------------------------------------

function Beds({ unit, onChanged }: { unit: UnitDetail; onChanged: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const addBed = unit.permitted_actions.add_bed;

  return (
    <View style={{ gap: space[3] }}>
      <Type variant="caption">
        A room can be let whole, or bed by bed. Adding beds does not commit you to
        either — it makes both possible.
      </Type>
      {unit.beds.length ? (
        unit.beds.map((bed) => (
          <Type key={bed.id} variant="body">
            · {bed.label}
          </Type>
        ))
      ) : (
        <Type variant="caption">No beds yet.</Type>
      )}
      <Field
        label="Bed label"
        hint="Bed A, or Lower bunk."
        value={label}
        onChangeText={setLabel}
      />
      {error ? <Notice tone="error" title={error} /> : null}
      {!addBed?.allowed ? (
        <Notice tone="info" title="Beds cannot be added" body={addBed?.message} />
      ) : null}
      {addBed?.allowed ? <Button
        label="Add bed"
        variant="secondary"
        busy={busy}
        disabled={!label.trim()}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            await createBed(unit.id, { label: label.trim() });
            setLabel("");
            await onChanged();
          } catch (cause) {
            setError(
              cause instanceof ApiFailure ? cause.error.message : "Could not add that bed.",
            );
          } finally {
            setBusy(false);
          }
        }}
      /> : null}
    </View>
  );
}

// --- publishing ---------------------------------------------------------------

function ComposeListing({ unitId, onDone }: { unitId: string; onDone: () => Promise<void> }) {
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [rent, setRent] = useState("");
  const [advance, setAdvance] = useState("6");
  const [deposit, setDeposit] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rentMinor = Math.round(Number(rent || 0) * 100);
  const months = Number(advance || 0) + Number(deposit || 0);

  return (
    <View style={{ gap: space[3] }}>
      <Field label="Public headline" value={headline} onChangeText={setHeadline} />
      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Field
        label="Monthly rent (GH₵)"
        value={rent}
        onChangeText={setRent}
        keyboardType="decimal-pad"
      />
      <Field
        label="Advance (months)"
        hint="Up to 24 is common."
        value={advance}
        onChangeText={setAdvance}
        keyboardType="number-pad"
      />
      <Field
        label="Deposit (months)"
        value={deposit}
        onChangeText={setDeposit}
        keyboardType="number-pad"
      />

      {rentMinor > 0 ? (
        <Notice
          tone="info"
          title={`A tenant needs GH₵${((rentMinor * months) / 100).toLocaleString("en-GH")} on day one`}
          body="This is the number that decides whether somebody can take the space, so it is said up front rather than discovered at the viewing."
        />
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      <Button
        label="Publish to Explore"
        busy={busy}
        disabled={!headline.trim() || !description.trim() || rentMinor <= 0}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            const created = await createListing({
              unit_id: unitId,
              rent_minor: rentMinor,
              headline,
              description,
              advance_months: Number(advance || 0),
              caution_months: Number(deposit || 0),
              minimum_lease_months: 6,
            });
            await publishListing(created.id);
            await onDone();
          } catch (cause) {
            setError(
              cause instanceof ApiFailure ? cause.error.message : "That did not publish.",
            );
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}
