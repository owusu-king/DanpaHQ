import Ionicons from "@expo/vector-icons/Ionicons";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  Image,
  Modal,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiFailure } from "@/api";
import { isLive } from "@/applicationMeaning";
import { useAuth } from "@/auth";
import { Button, Notice, Stamp, Type, space } from "@/components/ui";
import { ListingCard } from "@/components/listings/ListingCard";
import { Fact, GroupLabel, RecordPanel } from "@/components/record/RecordSurfaces";
import { ModalSafeArea } from "@/components/sheet/ModalSafeArea";
import {
  getListingDetail,
  getRelatedListings,
  listSaved,
  saveListing,
  unsaveListing,
  type ListingDetail,
} from "@/listings";
import { rememberOnboardingIntent } from "@/onboardingIntent";
import { listMyApplications } from "@/applications";
import { listMyViewings, requestViewing } from "@/viewings";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { shell } from "@/shell";
import { theme } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * The screen a tenant decides on.
 *
 * Glance → understand → decide → act. Photographs come first and swipe, the
 * price and the one action that matters sit in a bar that never scrolls away,
 * and everything else is one scannable line.
 *
 * The street, house number and entrance note are not here: the backend releases
 * those when a viewing is confirmed. That is a domain rule this screen reflects
 * rather than explains.
 */
export default function ListingDetailScreen() {
  const pageBottom = useSafeBottom(space[12]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { state } = useAuth();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [related, setRelated] = useState<Awaited<ReturnType<typeof getRelatedListings>> | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saved, setSaved] = useState(false);
  const [viewingState, setViewingState] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [browsingPhotos, setBrowsingPhotos] = useState(false);
  const [expandedTrust, setExpandedTrust] = useState(false);
  const width = useRef(Dimensions.get("window").width).current;
  // Under 380pt the two acts stack rather than squeezing their labels onto two lines.
  const narrow = width < 380;
  const insets = useSafeAreaInsets();
  const heroScroll = useRef<ScrollView>(null);
  const viewerScroll = useRef<ScrollView>(null);

  const signedIn = state.status === "signed_in";

  async function continueWithPhone(next = `/(app)/listing/${id}`) {
    await rememberOnboardingIntent("find_property");
    // Somebody saving or applying for a home is a tenant: straight to the
    // details step, which already knows which account this is.
    router.push({ pathname: "/(auth)/register", params: { workspace: "tenant", next } });
  }

  useEffect(() => {
    let current = true;
    setListing(null);
    setRelated(null);
    setLoadError("");
    setPhotoIndex(0);
    getListingDetail(id)
      .then((value) => { if (current) setListing(value); })
      .catch((cause) =>
        current && setLoadError(cause instanceof ApiFailure ? cause.error.message : "We could not open that place."),
      );
    getRelatedListings(id)
      .then((value) => { if (current) setRelated(value); })
      .catch(() => { if (current) setRelated([]); });
    return () => { current = false; };
  }, [id]);

  // What has already happened between this tenant and this listing, so the
  // screen stops offering an action they have taken.
  useEffect(() => {
    if (!signedIn || !listing) return;
    void listSaved().then((items) => setSaved(items.some((item) => item.listing.id === id))).catch(() => undefined);
    void listMyViewings()
      .then((items) => setViewingState(
        items.find((item) => item.listing_id === id
          && ["requested", "offered", "confirmed"].includes(item.status))?.status ?? null,
      ))
      .catch(() => undefined);
    void listMyApplications()
      // The rule lives in `applicationMeaning`, not here. Written out by hand
      // this missed that an accepted application stops blocking once its
      // tenancy ends.
      .then((items) => setApplied(items.some(
        (item) => item.unit_id === listing.space.id && isLive(item),
      )))
      .catch(() => undefined);
  }, [id, listing, signedIn]);

  if (loadError) {
    return <View style={{ padding: space[5] }}><Notice tone="error" title={loadError} /></View>;
  }
  if (!listing) {
    return <View style={{ padding: space[5] }}><Type variant="caption">Loading…</Type></View>;
  }

  const rentable = listing.space;
  const place = listing.property_context;
  const where = [place.locality_name, place.district_name].filter(Boolean).join(", ");
  const photos = listing.gallery.filter((photo) => photo.download_url);
  const taken = listing.status !== "active";

  // The hero is a preview, so it is capped rather than proportional: the
  // headline, the rent and the first facts belong on the same screen as it.
  const heroHeight = Math.min(Math.round(width * 0.62), 280);
  const gridCell = Math.floor((width - space[3] * 2 - space[2] * 2) / 3);

  // The backend orders the Unit's own photographs first and the building
  // after. Naming the two groups once, inside the gallery, replaces a label on
  // every single photograph.
  type Photo = (typeof photos)[number];
  const photoGroups: { label: string; items: { photo: Photo; position: number }[] }[] = [];
  photos.forEach((photo, position) => {
    const last = photoGroups[photoGroups.length - 1];
    if (last && last.label === photo.source_label) last.items.push({ photo, position });
    else photoGroups.push({ label: photo.source_label, items: [{ photo, position }] });
  });
  const longDescription = rentable.description.length > 260;
  const verified = rentable.verification.checked && place.authority.state === "verified";

  const facts = ([
    [rentable.space_type_label, "home-outline"],
    [rentable.bedrooms === 0 ? "Single room" : `${rentable.bedrooms} bedroom${rentable.bedrooms === 1 ? "" : "s"}`, "bed-outline"],
    rentable.bathrooms ? [`${rentable.bathrooms} bath`, "water-outline"] : null,
    rentable.is_furnished ? ["Furnished", "cube-outline"] : null,
    rentable.has_private_bathroom ? ["Private bath", "lock-closed-outline"] : null,
    rentable.has_private_kitchen ? ["Private kitchen", "restaurant-outline"] : null,
  ].filter(Boolean) as [string, IconName][]);
  const moveIn = `GH₵${(listing.total_move_in_minor / 100).toLocaleString("en-GH")}`;

  async function apply() {
    if (applied) { router.push("/(app)/applications" as never); return; }
    if (!signedIn) { await continueWithPhone(`/(app)/apply/${id}`); return; }
    router.push({ pathname: "/(app)/apply/[id]", params: { id } } as never);
  }

  function openPhotos(index: number, asGrid = false) {
    setPhotoIndex(index);
    setBrowsingPhotos(asGrid);
    setZoomed(true);
  }

  function closePhotos() {
    setZoomed(false);
    setBrowsingPhotos(false);
    // Come back to whichever photograph was being looked at.
    heroScroll.current?.scrollTo({ x: photoIndex * width, animated: false });
  }

  /**
   * A viewing request reaches a real person and cannot be taken back, and this
   * was one tap on a full-width button at the bottom of a scrolling page.
   * It asks first.
   */
  async function askToView() {
    if (viewingState) { router.push("/(app)/viewings" as never); return; }
    if (!signedIn) { await continueWithPhone(); return; }
    Alert.alert(
      "Send a viewing request?",
      `${listing?.provider_label ?? "The landlord"} sees your name and phone number, and replies with times.`,
      [
        { text: "Not now", style: "cancel" },
        { text: "Yes, send it", onPress: () => void sendViewingRequest() },
      ],
    );
  }

  async function sendViewingRequest() {
    setAsking(true);
    setActionError("");
    try {
      await requestViewing({ listing_id: id });
      setViewingState("requested");
    } catch (cause) {
      setActionError(cause instanceof ApiFailure ? cause.error.message : "We could not send that request.");
    } finally {
      setAsking(false);
    }
  }

  async function toggleSave() {
    if (!signedIn) { await continueWithPhone(); return; }
    const was = saved;
    setSaved(!was);
    try {
      await (was ? unsaveListing(id) : saveListing(id));
    } catch {
      setSaved(was);
    }
  }

  async function shareListing() {
    try {
      const url = Linking.createURL(`/listing/${id}`);
      await Share.share({
        title: listing?.headline ?? "Danpa HQ rental",
        message: listing
          ? `${listing.headline}\n${listing.rent_formatted} per month\n${url}`
          : url,
        url,
      });
    } catch {
      setActionError("We could not open sharing. Please try again.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: shell.record }}>
      <ScrollView contentContainerStyle={{ paddingBottom: pageBottom }}>
        {photos.length ? (
          <View>
            <ScrollView
              ref={heroScroll}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) =>
                setPhotoIndex(Math.round(event.nativeEvent.contentOffset.x / width))
              }
            >
              {photos.map((photo, index) => (
                <Pressable
                  key={photo.id}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`${photo.source_label}. Photo ${index + 1} of ${photos.length}. Open all photographs.`}
                  onPress={() => openPhotos(index)}
                >
                  <Image
                    source={{ uri: photo.download_url ?? "" }}
                    style={{ width, height: heroHeight }}
                    resizeMode="cover"
                  />
                </Pressable>
              ))}
            </ScrollView>
            {/* The count is how many there are and the way to all of them, so
                it is a control rather than a sticker. */}
            {photos.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Photo ${photoIndex + 1} of ${photos.length}. See all photographs.`}
                onPress={() => openPhotos(photoIndex, true)}
                style={{
                  position: "absolute", right: space[3], bottom: space[3],
                  flexDirection: "row", alignItems: "center", gap: space[2],
                  minHeight: 32, paddingHorizontal: space[3],
                  borderRadius: 16, backgroundColor: "rgba(15,24,20,0.62)",
                }}
              >
                <Ionicons name="grid-outline" size={13} color={theme.color.field["0"]} />
                <Type variant="caption" style={{ color: theme.color.field["0"] }}>
                  {photoIndex + 1} / {photos.length}
                </Type>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={{ height: heroHeight, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.field["100"] }}>
            <Ionicons name="image-outline" size={30} color={theme.color.ink["300"]} />
          </View>
        )}

        {/*
          Organised the way a tenant decides (owner, 2026-09-28): what it is and
          where, what it costs to move in, whether it is real, what it has, the
          landlord's own words, then the building around it. Each is one white
          card on the ivory page, so the eye can find a section by its shape.
        */}
        <View style={styles.page}>
          <View style={styles.identity}>
            <Type variant="display2" accessibilityRole="header">{listing.headline}</Type>
            <View style={styles.where}>
              <Ionicons name="location-outline" size={15} color={theme.color.ink["500"]} />
              <Type variant="caption" style={styles.whereText}>
                {where || "Ghana"}{place.landmark ? ` · near ${place.landmark}` : ""}
              </Type>
            </View>
            <View style={[styles.status, taken ? styles.statusTaken : null]}>
              <View style={[styles.statusDot, taken ? styles.statusDotTaken : null]} />
              <Type variant="captionStrong" style={{ color: taken ? theme.color.ink["500"] : theme.color.kola["800"] }}>
                {taken ? "No longer available" : "Available now"}
              </Type>
            </View>
          </View>

          <View style={styles.facts}>
            {facts.map(([fact, icon]) => (
              <View key={fact} style={styles.fact}>
                <Ionicons name={icon} size={15} color={theme.color.kola["800"]} />
                <Type variant="captionStrong" style={styles.factText}>{fact}</Type>
              </View>
            ))}
          </View>

          <Section title="Rent and move-in">
            <RecordPanel>
              <View style={styles.rentLead}>
                <Type variant="caption" style={styles.muted}>Rent</Type>
                <Type variant="title1" style={styles.rent}>
                  {listing.rent_formatted}
                  <Type variant="caption" style={styles.muted}> / month</Type>
                </Type>
              </View>
              <Fact label="Advance" value={listing.advance_label} />
              {listing.caution_months ? <Fact label="Deposit" value={months(listing.caution_months)} /> : null}
              {listing.agency_fee_months ? <Fact label="Agency fee" value={months(listing.agency_fee_months)} /> : null}
              <Fact label="To move in" value={moveIn} tone="action" />
            </RecordPanel>
          </Section>

          {/* One row, with the stamps behind it. */}
          <RecordPanel>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={verified ? "Verified rental. Open verification details." : "Open verification details"}
              aria-expanded={expandedTrust}
              onPress={() => setExpandedTrust((value) => !value)}
              {...pressableFeedback(theme.color.field["100"])}
              style={styles.trustRow}
            >
              <View style={[styles.trustMark, verified ? null : styles.trustMarkQuiet]}>
                <Ionicons name={verified ? "shield-checkmark" : "shield-outline"} size={17} color={verified ? theme.color.kola["800"] : theme.color.ink["500"]} />
              </View>
              <View style={{ flex: 1 }}>
                <Type variant="bodyStrong" style={{ color: verified ? theme.color.kola["800"] : theme.color.ink["900"] }}>
                  {verified ? "Verified rental" : "Verification details"}
                </Type>
                <Type variant="caption" style={styles.muted}>
                  {listing.trust_stamps.relationship === "owner" ? "Listed by the owner" : "Listed by an authorized representative"}
                </Type>
              </View>
              <Ionicons name={expandedTrust ? "chevron-up" : "chevron-down"} size={18} color={theme.color.ink["500"]} />
            </Pressable>
            {expandedTrust ? (
              <View style={styles.stamps}>
                <Stamp state={listing.trust_stamps.identity.state} what="Identity" />
                <Stamp state={place.authority.state} what={listing.provider_label} />
                <Stamp state={rentable.verification.checked ? "verified" : "unverified"} what="This space" />
                <Type variant="caption" style={styles.muted}>
                  {listing.trust_stamps.relationship === "owner"
                    ? "Checked as this property's owner."
                    : "Checked as an authorized representative."}
                </Type>
              </View>
            ) : null}
          </RecordPanel>

          {rentable.amenities.length ? (
            <Section title="What this space has">
              <View style={styles.tags}>
                {rentable.amenities.map((row) => <Tag key={row.id} label={row.name} />)}
              </View>
            </Section>
          ) : null}

          {rentable.description ? (
            <Section title="About this place">
              <RecordPanel style={styles.prose}>
                <Type variant="body">
                  {longDescription && !expanded ? `${rentable.description.slice(0, 260).trimEnd()}…` : rentable.description}
                </Type>
                {longDescription ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setExpanded((value) => !value)}
                    style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
                  >
                    <Type variant="bodyStrong" style={{ color: theme.color.kola["800"] }}>
                      {expanded ? "Show less" : "Read more"}
                    </Type>
                  </Pressable>
                ) : null}
              </RecordPanel>
            </Section>
          ) : null}

          <Section title="The property">
            <RecordPanel>
              <View style={styles.propertyHead}>
                <Type variant="bodyStrong">{place.title}</Type>
                <Type variant="caption" style={styles.muted}>
                  {place.property_type_label}{place.region_name ? ` · ${place.region_name}` : ""}
                </Type>
              </View>
              <Feature icon="water-outline" label="Water" value={place.features.water_source_label} />
              <Feature icon="flash-outline" label="Power" value={place.features.power_meter_label} />
              <Feature icon="business-outline" label="Compound" value={place.features.compound_label} />
              {place.amenities.length ? (
                <View style={[styles.tags, styles.propertyTags]}>
                  {place.amenities.map((row) => <Tag key={row.id} label={row.name} />)}
                </View>
              ) : null}
            </RecordPanel>
          </Section>

          {related?.length ? (
            <Section title="Related rentals">
              <Type variant="caption" style={styles.muted}>Nearby options at a similar rent.</Type>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={Math.min(Math.round(width * 0.78), 300) + space[3]}
                contentContainerStyle={{ gap: space[3], paddingRight: space[5] }}
              >
                {related.map((item) => (
                  <View key={item.id} style={{ width: Math.min(Math.round(width * 0.78), 300) }}>
                    <ListingCard
                      listing={item}
                      photoSwipe={false}
                      onPress={() => router.push({
                        pathname: "/(app)/listing/[id]",
                        params: { id: item.id },
                      } as never)}
                    />
                  </View>
                ))}
              </ScrollView>
            </Section>
          ) : null}

          {actionError ? <Notice tone="error" title={actionError} /> : null}
        </View>
      </ScrollView>

      {/* The decision bar stays reachable without covering the listing.
          Applying is what this page exists to produce, so it leads in kola; a
          viewing is the step beside it, as glass (owner, 2026-09-28). */}
      {!taken ? (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
          <View style={styles.barHead}>
            <View style={{ flex: 1 }}>
              <Type variant="title2">{listing.rent_formatted}</Type>
              <Type variant="caption" style={styles.muted}>per month · {moveIn} to move in</Type>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={saved ? "Remove from saved" : "Save this place"}
              aria-pressed={saved}
              onPress={() => void toggleSave()}
              {...pressableFeedback(theme.color.field["200"])}
              style={styles.iconButton}
            >
              <Ionicons
                name={saved ? "bookmark" : "bookmark-outline"}
                size={21}
                color={saved ? theme.color.kola["800"] : theme.color.ink["700"]}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share this rental"
              onPress={() => void shareListing()}
              {...pressableFeedback(theme.color.field["200"])}
              style={styles.iconButton}
            >
              <Ionicons name="share-outline" size={21} color={theme.color.ink["700"]} />
            </Pressable>
          </View>
          <View style={[styles.acts, narrow ? styles.actsStacked : null]}>
            <View style={narrow ? null : styles.actPrimary}>
              <Button
                label={applied ? "Application sent — open it" : "Apply to rent"}
                icon={<Ionicons name={applied ? "document-text-outline" : "create-outline"} size={18} color={theme.color.field["0"]} />}
                onPress={() => void apply()}
              />
            </View>
            <View style={narrow ? null : styles.actSecondary}>
              <Button
                label={
                  viewingState === "confirmed" ? "Viewing confirmed"
                    : viewingState ? "Viewing requested"
                    : "Request viewing"
                }
                variant="secondary"
                busy={asking}
                onPress={() => void askToView()}
              />
            </View>
          </View>
        </View>
      ) : null}

      {/* Where photographs are actually explored: one at a time, or all of them
          at once. Eight photographs should never mean eight swipes to reach
          the last one. */}
      <Modal visible={zoomed} animationType="fade" onRequestClose={closePhotos}>
        {/* Its own window, so it measures its own edges rather than the page's. */}
        <ModalSafeArea>
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: "#0b110e" }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space[2] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close photographs"
              onPress={closePhotos}
              style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="close" size={26} color={theme.color.field["0"]} />
            </Pressable>
            <Type variant="caption" style={{ flex: 1, textAlign: "center", color: theme.color.field["0"] }}>
              {browsingPhotos ? `${photos.length} photos` : `${photoIndex + 1} of ${photos.length}`}
            </Type>
            {photos.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={browsingPhotos ? "Back to the photograph" : "See every photograph"}
                onPress={() => setBrowsingPhotos((value) => !value)}
                style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons
                  name={browsingPhotos ? "image-outline" : "grid-outline"}
                  size={22}
                  color={theme.color.field["0"]}
                />
              </Pressable>
            ) : <View style={{ width: 48 }} />}
          </View>

          {browsingPhotos ? (
            <ScrollView contentContainerStyle={{ padding: space[3], gap: space[5] }}>
              {photoGroups.map((group) => (
                <View key={group.label} style={{ gap: space[2] }}>
                  <Type variant="caption" style={{ color: "rgba(255,255,255,0.65)" }}>
                    {group.label} · {group.items.length}
                  </Type>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                    {group.items.map((item) => (
                      <Pressable
                        key={item.photo.id}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={`${group.label}. Photo ${item.position + 1} of ${photos.length}`}
                        onPress={() => { setPhotoIndex(item.position); setBrowsingPhotos(false); }}
                      >
                        <Image
                          source={{ uri: item.photo.download_url ?? "" }}
                          style={{ width: gridCell, height: gridCell, borderRadius: 4 }}
                          resizeMode="cover"
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <>
              <ScrollView
                ref={viewerScroll}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                contentOffset={{ x: photoIndex * width, y: 0 }}
                onLayout={() => viewerScroll.current?.scrollTo({ x: photoIndex * width, animated: false })}
                onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) =>
                  setPhotoIndex(Math.round(event.nativeEvent.contentOffset.x / width))
                }
                style={{ flex: 1 }}
              >
                {photos.map((photo) => (
                  <View key={photo.id} style={{ width, flex: 1, justifyContent: "center" }}>
                    <Image
                      source={{ uri: photo.download_url ?? "" }}
                      style={{ width, height: "80%" }}
                      resizeMode="contain"
                    />
                  </View>
                ))}
              </ScrollView>
              <Type
                variant="caption"
                style={{ paddingVertical: space[4], textAlign: "center", color: "rgba(255,255,255,0.65)" }}
              >
                {photos[photoIndex]?.source_label}
              </Type>
            </>
          )}
        </SafeAreaView>
        </ModalSafeArea>
      </Modal>
    </View>
  );
}

/** A count of months, said as a person would: "1 month", "2 months". */
function months(count: number) {
  return `${count} month${count === 1 ? "" : "s"}`;
}

/** A section: its name standing on the ground, and its card or content under it. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <GroupLabel>{title}</GroupLabel>
      {children}
    </View>
  );
}

/** One feature of the building: its glyph, its name, and what it is. */
function Feature({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.feature}>
      <View style={styles.featureMark}>
        <Ionicons name={icon} size={15} color={theme.color.kola["800"]} />
      </View>
      <Type variant="caption" style={[styles.muted, { flex: 1 }]}>{label}</Type>
      <Type variant="bodyStrong" style={styles.featureValue}>{value}</Type>
    </View>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <Ionicons name="checkmark" size={13} color={theme.color.kola["800"]} />
      <Type variant="caption" style={styles.tagText}>{label}</Type>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: space[5],
    paddingHorizontal: space[4],
    paddingTop: space[5],
  },
  identity: {
    gap: space[2],
  },
  where: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
  },
  whereText: {
    flexShrink: 1,
    color: theme.color.ink["700"],
  },
  status: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    minHeight: 28,
    paddingHorizontal: space[3],
    borderRadius: 999,
    backgroundColor: theme.color.kola["50"],
  },
  statusTaken: {
    backgroundColor: theme.color.field["100"],
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: theme.color.kola["600"],
  },
  statusDotTaken: {
    backgroundColor: theme.color.ink["300"],
  },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  fact: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1] + 2,
    minHeight: 34,
    paddingHorizontal: space[3],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.color.field["200"],
    backgroundColor: theme.color.field["0"],
  },
  factText: {
    color: theme.color.ink["900"],
  },
  section: {
    gap: space[2],
  },
  rentLead: {
    gap: 2,
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[3],
  },
  rent: {
    color: theme.color.ink["900"],
  },
  muted: {
    color: theme.color.ink["500"],
  },
  trustRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  trustMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["50"],
  },
  trustMarkQuiet: {
    backgroundColor: theme.color.field["100"],
  },
  stamps: {
    gap: space[2],
    paddingHorizontal: space[4],
    paddingBottom: space[4],
  },
  prose: {
    gap: space[1],
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[2],
  },
  propertyHead: {
    gap: 2,
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[2],
  },
  feature: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.field["200"],
  },
  featureMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["50"],
  },
  featureValue: {
    flexShrink: 1,
    textAlign: "right",
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  propertyTags: {
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.field["200"],
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    minHeight: 32,
    paddingHorizontal: space[3],
    borderRadius: 999,
    backgroundColor: theme.color.kola["50"],
  },
  tagText: {
    color: theme.color.kola["800"],
  },
  // The decision bar: paper, lifted off the page, with the rent over its acts.
  bar: {
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.field["200"],
    backgroundColor: theme.color.field["0"],
    shadowColor: theme.color.kola["900"],
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  barHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: theme.color.field["100"],
  },
  acts: {
    flexDirection: "row",
    gap: space[2],
  },
  // Too narrow for both side by side: Apply stays first, the viewing under it.
  actsStacked: {
    flexDirection: "column",
  },
  actPrimary: {
    flex: 1,
  },
  actSecondary: {
    flex: 1,
  },
});
