import { RecordHeader, RecordHero, RecordFacts, RecordSection } from "@/components/property/RecordDetail";
import { LocationPicker, pinFromAddress } from "@/components/property/LocationPicker";
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

import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import {
  Fact,
  Footnote,
  GroupLabel,
  LinkRow,
  Pill,
  QuietAct,
  RecordPanel,
  StandingLine,
  type RecordTone,
} from "@/components/record/RecordSurfaces";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { SpaceAmenities } from "@/components/property/SpaceAmenities";
import { SpaceLifecycle } from "@/components/property/SpaceLifecycle";
import { UnitAccessCodeManagement } from "@/components/property/UnitAccessCodeManagement";
import { UnitLifecycleActions, unitRemoval, unitRemovalBlocker } from "@/components/property/UnitLifecycleActions";
import { SpacePhotos } from "@/components/property/SpacePhotos";
import { spaceStatus } from "@/components/property/WorkspacePatterns";
import type { Listing } from "@/listings";
import { destructiveConfirmStyle, useSafeBottom } from "@/platform";
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

/** Each piece of work this Unit holds, opened on the row that names it. */
type Sheet = "photos" | "amenities" | "details" | "beds" | "lifecycle" | "danger";

export default function SpaceScreen() {
  const pageBottom = useSafeBottom(space[12]);
  const { unitId } = useLocalSearchParams<{ unitId: string }>();
  const router = useRouter();

  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!unitId) return;
    try {
      const [detail, listings] = await Promise.all([getUnit(unitId), listMyListings()]);
      setUnit(detail);
      setListing(
        listings.find((row) => row.id === detail.publication.listing_id) ?? null,
      );
      setError("");
    } catch (cause) {
      setError(
        cause instanceof ApiFailure ? cause.error.message : "Could not load this Unit.",
      );
    }
  }, [unitId]);

  // On focus, so coming back from setup or a photo upload shows what changed.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!unit) {
    return (
      <View style={styles.page}>
        {error ? <Notice tone="error" title={error} body="Return to the Property and try again." /> : <UnitSkeleton />}
      </View>
    );
  }

  const where = [
    unit.property.title,
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

  const occupied = unit.availability.state === "occupied";
  const published = unit.publication.state === "published" && unit.publication.listing_status === "active";
  const size = sizeLine(unit);
  const removal = unitRemoval(unit);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]} keyboardShouldPersistTaps="handled">
        {error ? <Notice tone="error" title={error} body="Some information may be out of date. Try again." /> : null}
        {unit.billing_access && unit.billing_access.state !== "full" ? (
          <Notice
            tone={unit.billing_access.state === "wind_down" ? "warning" : "info"}
            title={
              unit.billing_access.state === "wind_down"
                ? "Winding down on your current plan"
                : "Read-only on your current plan"
            }
            body={`${unit.billing_access.message} Manage this in More → Plan & billing.`}
          />
        ) : null}

        <RecordHeader title={unit.label || "Unnamed Unit"} context={where} status={<><StandingLine tone={recordTone(status.tone)} line={unit.verification.state === "verified" ? "Verified" : unit.verification.state_label} /><StandingLine line={published ? "Public" : "Private"} tone={published ? "good" : "quiet"} /><StandingLine line={unit.availability.label} /></>} />
        <RecordHero photo={photo} title={unit.label || "Unit"} onPhotoPress={() => setSheet("photos")}>
          <WhatIsNext unit={unit} listing={listing} onChanged={load} />
        </RecordHero>
        <RecordSection title="Overview"><RecordFacts rows={[{ label: "Type", value: unit.space_type_label }, { label: "Size", value: size || "Not recorded" }, { label: "Furnished", value: unit.is_furnished ? "Yes" : "No" }]} /></RecordSection>
        <RecordSection title="Location">
          <Type variant="body">{[unit.property.address?.locality_name, unit.property.address?.district_name].filter(Boolean).join(", ") || unit.property.title}</Type>
          {pinFromAddress(unit.property.address) ? <LocationPicker value={pinFromAddress(unit.property.address)} disabled onChange={() => {}} /> : null}
          <Type variant="caption">Location belongs to {unit.property.title}.</Type>
        </RecordSection>

        {/* Five stacked disclosures under one heading is a settings page. Each
            is its own piece of work, so each opens on the row that names it. */}
        <View style={styles.section}>
          <GroupLabel>Manage this Unit</GroupLabel>
          <RecordPanel>
            <LinkRow
              first
              icon="images-outline"
              tone={unit.verification.state === "verified" ? "quiet" : "action"}
              label="Photos"
              detail={unit.photo_count
                ? `${unit.photo_count} on file`
                : unit.verification.state === "verified" ? "None on file" : "None yet — verification needs them"}
              onPress={() => setSheet("photos")}
            />
            <LinkRow
              icon="sparkles-outline"
              label="Amenities"
              detail={unit.amenities.length ? unit.amenities.map((row) => row.name).join(" · ") : "None recorded"}
              onPress={() => setSheet("amenities")}
            />
            <LinkRow
              icon="navigate-outline"
              label="Details and entrance"
              detail="Description and entrance directions"
              onPress={() => setSheet("details")}
            />
            {isHostelRoom ? (
              <LinkRow
                icon="bed-outline"
                label="Beds"
                detail={unit.beds.length ? `${unit.beds.length} in this room` : "None yet"}
                onPress={() => setSheet("beds")}
              />
            ) : null}
            <LinkRow
              icon="shield-checkmark-outline"
              label="Verification and publication"
              detail={unit.verification.state_label}
              onPress={() => setSheet("lifecycle")}
            />
          </RecordPanel>
        </View>

        {/* The code belongs to this Unit, so it is managed from this Unit
            rather than only from the Portfolio's tenant work. */}
        <UnitAccessCodeManagement
          unitId={unit.id}
          accessCode={unit.access_code}
          verified={unit.verification.state === "verified"}
          occupied={occupied}
          onChanged={load}
        />

        <RecordPanel>
          <LinkRow
            first
            icon="people-outline"
            label="Tenancy requests and tenancies"
            detail="Who is asking, and who lives here, for this Unit"
            onPress={() => router.push({ pathname: "/(app)/(provider-tabs)/tenants", params: { unitId: unit.id, scopeLabel: `${unit.label} · ${unit.property.title}` } } as never)}
          />
        </RecordPanel>

        {/* Offered only when the backend allows one of the two, and named for
            that one. An occupied Unit used to offer "Archive or delete" and
            open a sheet with nothing in it (owner, 2026-10-06). */}
        {removal ? (
          <View style={styles.exit}>
            <QuietAct
              label={removal === "delete" ? "Delete this Unit" : "Archive this Unit"}
              icon={removal === "delete" ? "trash-outline" : "archive-outline"}
              onPress={() => setSheet("danger")}
            />
          </View>
        ) : (
          <Footnote>{unitRemovalBlocker(unit)}</Footnote>
        )}
      </ScrollView>

      <BottomSheet
        visible={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheetTitle(sheet, unit, removal)}
        closeLabel="Close"
      >
        {sheet === "photos" ? (
          <View style={styles.sheetBody}>
            <Footnote>
              {occupied
                ? "These checked photos are protected while the Unit is occupied."
                : unit.verification.state === "verified"
                  ? "These are the photos that were checked. Start a re-check before changing them."
                  : "The first photo is the primary view used for verification and tenant-facing presentation."}
            </Footnote>
            <SpacePhotos unitId={unit.id} editable={Boolean(unit.permitted_actions.edit?.allowed)} onChanged={load} />
          </View>
        ) : sheet === "amenities" ? (
          <View style={styles.sheetBody}>
            {unit.permitted_actions.edit?.allowed ? (
              <SpaceAmenities scope="unit" id={unit.id} onSaved={load} />
            ) : unit.amenities.length ? (
              <RecordPanel>
                {unit.amenities.map((row, index) => (
                  <Fact key={row.id} first={index === 0} wide label={row.category || "Amenity"} value={row.name} />
                ))}
              </RecordPanel>
            ) : (
              <RecordPanel><Fact wide first label="None recorded" value="Amenities belonging to this Unit alone are listed here." /></RecordPanel>
            )}
          </View>
        ) : sheet === "details" ? (
          <View style={styles.sheetBody}><Details unit={unit} onSaved={load} /></View>
        ) : sheet === "beds" ? (
          <View style={styles.sheetBody}><Beds unit={unit} onChanged={load} /></View>
        ) : sheet === "lifecycle" ? (
          <View style={styles.sheetBody}>
            <SpaceLifecycle verification={unit.verification} publication={unit.publication} availability={unit.availability} />
            {unit.verification.decision_note ? <Notice tone="info" title="Review note" body={unit.verification.decision_note} /> : null}
          </View>
        ) : sheet === "danger" ? (
          <View style={styles.sheetBody}><UnitLifecycleActions unit={unit} onCancel={() => setSheet(null)} /></View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

function sheetTitle(sheet: Sheet | null, unit: UnitDetail, removal: "delete" | "archive" | null) {
  if (sheet === "photos") return unit.photo_count ? `Photos · ${unit.photo_count}` : "Photos";
  if (sheet === "amenities") return "Amenities";
  if (sheet === "details") return "Details and entrance";
  if (sheet === "beds") return unit.beds.length ? `Beds · ${unit.beds.length}` : "Beds";
  if (sheet === "lifecycle") return "Verification and publication";
  if (sheet === "danger") return removal === "delete" ? "Delete this Unit" : "Archive this Unit";
  return "";
}

/** The workspace status tones, said in the record kit's vocabulary. */
function recordTone(tone: string): RecordTone {
  return tone === "good" ? "good" : tone === "attention" ? "alert" : tone === "waiting" ? "waiting" : "quiet";
}

/** Shaped like the Unit, so nothing jumps when it arrives. */
function UnitSkeleton() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading this Unit" style={{ gap: space[4] }}>
      <Bone width="54%" height={22} />
      <Bone width="42%" />
      <Bone height={200} />
      <Bone width="34%" height={12} />
      <RecordPanel style={{ gap: space[3], padding: space[4] }}>
        <Bone height={20} />
        <Bone height={20} />
      </RecordPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { padding: space[4], gap: space[3] },
  next: { gap: space[2], padding: 0, borderWidth: 0, backgroundColor: "transparent", boxShadow: "none", elevation: 0 },
  nextBody: { color: theme.color.ink["700"] },
  section: { gap: space[2] },
  acts: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] },
  exit: { alignItems: "flex-start", paddingTop: space[2] },
  sheetBody: { gap: space[4] },
});

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
    // A card and its way on, rather than a notice boxed inside a card with
    // nothing to press (owner, 2026-10-06).
    return (
      <RecordPanel style={styles.next}>
        <StandingLine tone="good" line="Someone lives here" />
        <View style={{ flexDirection: "row" }}>
          <Pill label="Open Tenants" icon="people-outline" onPress={() => router.push({ pathname: "/(app)/(provider-tabs)/tenants", params: { unitId: unit.id, scopeLabel: `${unit.label} · ${unit.property.title}` } } as never)} />
        </View>
      </RecordPanel>
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
      // The record kit's card, its standing in colour, one solid act and the
      // rest quiet — not a beige box with a gradient button (owner, 2026-10-06).
      <RecordPanel style={styles.next}>
        <StandingLine
          tone={waiting ? "waiting" : unit.verification.decision_note ? "alert" : "action"}
          line={waiting ? "With our review team" : unit.verification.decision_note ? "Changes requested" : "Get this Unit checked"}
        />
        <Type variant="caption" style={styles.nextBody}>
          {waiting
            ? "We’ll tell you when the review is complete."
            : "Verify this Unit before sharing its code or publishing it."}
        </Type>

        {unit.verification.decision_note ? (
          <Notice tone="warning" title="From our review team" body={unit.verification.decision_note} />
        ) : null}
        {error ? <Notice tone="error" title={error} /> : null}
        {!waiting && !submit?.allowed ? (
          <Notice
            tone="info"
            title={waitingOnProperty ? "The whole Property has to be verified first" : "This cannot be sent yet"}
            body={submit?.message ?? `${unit.verification.required_outstanding} of ${unit.verification.required_total} photos still needed. Add them under Photos below.`}
          />
        ) : null}

        <View style={styles.acts}>
          {waiting ? null : submit?.allowed ? (
            <Pill label="Send for checking" icon="paper-plane-outline" grow busy={busy} busyLabel="Sending…" onPress={() => void run(() => submitForReview("unit", unit.id))} />
          ) : waitingOnProperty ? (
            <Pill label="Open the Property" icon="business-outline" grow onPress={() => router.push({ pathname: "/(app)/provider-property", params: { propertyId: unit.property.id } })} />
          ) : unit.verification.state === "draft" || unit.verification.state === "ready_for_submission" ? (
            <Pill
              label="Continue setup"
              icon="arrow-forward"
              grow
              onPress={() => router.push({ pathname: "/(app)/space-new", params: { propertyId: unit.property.id, unitId: unit.id, step: unit.verification.can_submit ? "review" : "amenities" } })}
            />
          ) : null}
        </View>

        {/* Everything quieter sits under the one act. */}
        {!waiting && submit?.allowed && (unit.verification.state === "draft" || unit.verification.state === "ready_for_submission") ? (
          <QuietAct
            label="Continue setup first"
            icon="create-outline"
            onPress={() => router.push({ pathname: "/(app)/space-new", params: { propertyId: unit.property.id, unitId: unit.id, step: unit.verification.can_submit ? "review" : "amenities" } })}
          />
        ) : null}
        {!waiting && !waitingOnProperty && !submit?.allowed && unit.verification.can_submit ? (
          // Complete on its own terms but refused: offering the call is what turns a silent refusal into a stated one.
          <QuietAct label="Try sending anyway" icon="paper-plane-outline" busy={busy} onPress={() => void run(() => submitForReview("unit", unit.id))} />
        ) : null}
        {waiting && unit.permitted_actions.withdraw_submission?.allowed ? (
          <QuietAct label="Withdraw submission" icon="arrow-undo-outline" busy={busy} onPress={() => Alert.alert("Withdraw submission?", "Your Unit stays saved and editable. You can submit it again later.", [
            { text: "Keep submitted", style: "cancel" },
            { text: "Withdraw", style: "destructive", onPress: () => void run(() => withdrawSpaceSubmission(unit.id, "Withdrawn by the provider.")) },
          ])} />
        ) : null}
      </RecordPanel>
    );
  }

  const published = (unit.publication.state === "published" && unit.publication.listing_status === "active");
  // The Unit names its own listing. The list of the provider's listings is only
  // a fallback: when it missed, a Unit already on Explore was offered "Publish
  // to Explore" again (owner, 2026-10-06).
  const listingId = unit.publication.listing_id ?? listing?.id ?? null;

  return (
    <View style={styles.section}>
      <GroupLabel>{published ? "On Explore" : "Checked — who sees it?"}</GroupLabel>
      <RecordPanel>
        <Fact
          wide
          first
          label={published ? "Anyone can ask to view it" : "Checked, and still private"}
          value={published
            ? "Taking it down does not undo the check."
            : "Share its access code, or publish it to Explore."}
          tone={published ? "good" : "action"}
        />
      </RecordPanel>

      {error ? <Notice tone="error" title={error} /> : null}
      {!publish?.allowed && publish?.message ? (
        <Notice tone="info" title="This cannot be published" body={publish.message} />
      ) : null}

      {composing ? (
        <BottomSheet visible onClose={() => { if (!busy) { setComposing(false); void onChanged(); } }} title="Publish to Explore" closeLabel="Cancel">
        <ComposeListing
          unitId={unit.id}
          listing={listing}
          onBusyChange={setBusy}
          onDone={async () => {
            setComposing(false);
            await onChanged();
          }}
        />
        </BottomSheet>
      ) : null}

      {/* Reopening is the one act while it is being considered, so the panel
          offers that and the way out of it — never both decisions at once. */}
      {rechecking ? (
        <>
          <Notice
            tone="warning"
            title="A re-check takes this out of Explore"
            body="The check stays on record, and this Unit goes back to draft so you can change its details and photos. It has to be checked again before private access or advertising becomes available."
          />
          <View style={styles.acts}>
            <Pill
              label="Reopen this Unit"
              icon="refresh-outline"
              tone="danger"
              busy={busy}
              busyLabel="Reopening"
              grow
              onPress={() =>
                void run(async () => {
                  await requestUnitRecheck(unit.id, "Reopened to change the Unit.");
                  setRechecking(false);
                })
              }
            />
            <QuietAct label="Never mind" disabled={busy} onPress={() => setRechecking(false)} />
          </View>
        </>
      ) : (
        // A row in the page. `ActionBar` is the bar pinned under the thumb, and
        // dropped mid-page it drew a white slab across the ground (owner, 2026-10-06).
        <View style={styles.acts}>
          {published && listingId ? (
            <Pill
              label="Take it out of Explore"
              icon="eye-off-outline"
              tone="danger"
              busy={busy}
              busyLabel="Taking down"
              grow
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
                          withdrawListing(listingId, "Taken down by the provider"),
                        ),
                    },
                  ],
                );
              }}
            />
          ) : !published && listingId && publish?.allowed ? (
            <Pill
              label="Publish to Explore"
              icon="earth"
              busy={busy}
              busyLabel="Publishing"
              grow
              onPress={() => setComposing(true)}
            />
          ) : !published && !listingId && publish?.allowed ? (
            <Pill
              label={composing ? "Not now" : "Publish to Explore"}
              icon={composing ? "close" : "earth"}
              tone={composing ? "quiet" : "primary"}
              grow
              onPress={() => setComposing((open) => !open)}
            />
          ) : null}
        </View>
      )}

      {/* Below the bar, not beside it. "Change what was checked" is too long to
          share a row with a pill: the bar only stacks under 360pt, so at any
          ordinary width the pill was cut to "Take it o…". */}
      {!rechecking && recheck?.allowed ? (
        <View style={styles.exit}>
          <QuietAct
            label="Change what was checked"
            icon="create-outline"
            disabled={busy}
            onPress={() => setRechecking(true)}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Only the counts that fit this kind of space (owner, 2026-10-05): a shop reads
 * "Own bathroom", never "0 bedrooms"; a bed space reads nothing.
 */
function sizeLine(unit: UnitDetail): string {
  const asks = unit.asks ?? { bedrooms: true, bathrooms: "count", floor: true };
  return [
    asks.bedrooms ? `${unit.bedrooms} bedroom${unit.bedrooms === 1 ? "" : "s"}` : "",
    asks.bathrooms === "count"
      ? `${unit.bathrooms} bath${unit.bathrooms === 1 ? "" : "s"}`
      : asks.bathrooms === "yes_no"
        ? unit.bathrooms > 0 ? "Own bathroom" : "Shared bathroom"
        : "",
  ].filter(Boolean).join(" · ");
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
        {sizeLine(unit) ? <Type variant="caption">{sizeLine(unit)}</Type> : null}
        <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
          {unit.permitted_actions.edit?.message ?? "These cannot be changed at the moment."}
        </Type>
      </View>
    );
  }

  return (
    <View style={{ gap: space[3] }}>
      {fullEditable ? <Field
        label="Name"
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

function ComposeListing({ unitId, listing, onDone, onBusyChange }: { unitId: string; listing?: Listing | null; onDone: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [headline, setHeadline] = useState(listing?.headline ?? "");
  const [description, setDescription] = useState(listing?.description ?? "");
  const [rent, setRent] = useState(listing?.rent_minor != null ? String(listing.rent_minor / 100) : "");
  const [advance, setAdvance] = useState(String(listing?.advance_months ?? 6));
  const [deposit, setDeposit] = useState(String(listing?.caution_months ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pending = useRef(false);
  const savedId = useRef(listing?.id ?? null);
  const published = useRef(false);
  const rentMinor = Math.round(Number(rent || 0) * 100);
  const months = Number(advance || 0) + Number(deposit || 0) + (listing?.agency_fee_months ?? 0);
  const advanceError = !Number.isInteger(Number(advance || 0)) || Number(advance || 0) < 0 || Number(advance || 0) > 36
    ? "Enter an advance between 0 and 36 months."
    : "";

  return (
    <View style={{ gap: space[3] }}>
      {listing ? <Type variant="caption">Publish again with these saved terms.</Type> : null}
      <Field editable={!listing && !busy} label="Public headline" value={headline} onChangeText={setHeadline} />
      <Field
        editable={!listing && !busy}
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Field
        editable={!listing && !busy}
        label={listing?.rent_period === "yearly" ? "Yearly rent (GH₵)" : "Monthly rent (GH₵)"}
        value={rent}
        onChangeText={setRent}
        keyboardType="decimal-pad"
      />
      <Field
        editable={!listing && !busy}
        label="Advance (months)"
        hint="From 0 to 36 months."
        error={advanceError}
        value={advance}
        onChangeText={setAdvance}
        keyboardType="number-pad"
      />
      <Field
        editable={!listing && !busy}
        label="Deposit (months)"
        value={deposit}
        onChangeText={setDeposit}
        keyboardType="number-pad"
      />

      {rentMinor > 0 ? (
        <Notice
          tone="info"
          title={`A tenant needs GH₵${((rentMinor * months) / 100).toLocaleString("en-GH")} on day one`}
        />
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      <Button
        label="Publish to Explore"
        busy={busy}
        disabled={!headline.trim() || !description.trim() || rentMinor <= 0 || Boolean(advanceError)}
        onPress={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true); onBusyChange(true);
          setError("");
          try {
            if (!savedId.current) {
            const created = await createListing({
              unit_id: unitId,
              rent_minor: rentMinor,
              headline,
              description,
              advance_months: Number(advance || 0),
              caution_months: Number(deposit || 0),
              minimum_lease_months: 6,
            });
            savedId.current = created.id;
            }
            if (!published.current) { await publishListing(savedId.current); published.current = true; }
            await onDone();
          } catch (cause) {
            setError(
              cause instanceof ApiFailure ? cause.error.message : "That did not publish.",
            );
          } finally {
            pending.current = false;
            setBusy(false); onBusyChange(false);
          }
        }}
      />
    </View>
  );
}
