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
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiFailure } from "@/api";
import { isLive } from "@/applicationMeaning";
import { useAuth } from "@/auth";
import { Button, Notice, Stamp, Type, space } from "@/components/ui";
import { ListingCard } from "@/components/listings/ListingCard";
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
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

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
  const insets = useSafeAreaInsets();
  const heroScroll = useRef<ScrollView>(null);
  const viewerScroll = useRef<ScrollView>(null);

  const signedIn = state.status === "signed_in";

  async function continueWithPhone(next = `/(app)/listing/${id}`) {
    await rememberOnboardingIntent("find_property");
    router.push({ pathname: "/(auth)/phone", params: { next, intent: "find_property" } });
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

  const facts = [
    rentable.space_type_label,
    rentable.bedrooms === 0 ? "Single room" : `${rentable.bedrooms} bedroom${rentable.bedrooms === 1 ? "" : "s"}`,
    rentable.bathrooms ? `${rentable.bathrooms} bath` : null,
    rentable.is_furnished ? "Furnished" : null,
    rentable.has_private_bathroom ? "Private bath" : null,
    rentable.has_private_kitchen ? "Private kitchen" : null,
  ].filter(Boolean) as string[];

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
        title: listing?.headline ?? "Rooomly rental",
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
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space[12] }}>
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

        <View style={{ padding: space[5], gap: space[5] }}>
          <View style={{ gap: space[1] }}>
            <Type variant="display2" accessibilityRole="header">{listing.headline}</Type>
            <Type variant="caption">
              {where || "Ghana"}{place.landmark ? ` · near ${place.landmark}` : ""}
            </Type>
            <Type variant="title1" style={{ marginTop: space[2] }}>
              {listing.rent_formatted}
              <Type variant="caption"> / month</Type>
            </Type>
            <Type variant="caption" style={{ color: taken ? theme.color.ink["500"] : theme.color.kola["600"], fontWeight: "600" }}>
              {taken ? "No longer available" : "Available now"}
            </Type>
          </View>

          <View
            style={{
              flexDirection: "row", flexWrap: "wrap", gap: space[2],
              paddingVertical: space[3],
              borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.field["200"],
            }}
          >
            {facts.map((fact) => <Type key={fact} variant="caption">{fact}</Type>)}
          </View>

          <Section title="Rental terms">
            <Fact label="Advance" value={listing.advance_label} />
            {listing.caution_months ? <Fact label="Deposit" value={`${listing.caution_months} months`} /> : null}
            {listing.agency_fee_months ? <Fact label="Agency fee" value={`${listing.agency_fee_months} months`} /> : null}
            <Fact label="To move in" value={`GH₵${(listing.total_move_in_minor / 100).toLocaleString("en-GH")}`} />
            {/* Applying is about the terms, so it sits with them. The sticky bar
                keeps the viewing request; two primaries would be neither. */}
            {!taken ? (
              <Button
                label={applied ? "Application sent — open it" : "Apply to rent"}
                variant="secondary"
                onPress={async () => {
                  if (applied) { router.push("/(app)/applications" as never); return; }
                  if (!signedIn) { await continueWithPhone(`/(app)/apply/${id}`); return; }
                  router.push({ pathname: "/(app)/apply/[id]", params: { id } } as never);
                }}
              />
            ) : null}
          </Section>

          {rentable.amenities.length ? (
            <Section title="What this space has">
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                {rentable.amenities.map((row) => <Tag key={row.id} label={row.name} />)}
              </View>
            </Section>
          ) : null}

          {rentable.description ? (
            <Section title="About this place">
              <Type variant="body">
                {longDescription && !expanded ? `${rentable.description.slice(0, 260).trimEnd()}…` : rentable.description}
              </Type>
              {longDescription ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setExpanded((value) => !value)}
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
                    {expanded ? "Show less" : "Read more"}
                  </Type>
                </Pressable>
              ) : null}
            </Section>
          ) : null}

          <Section title="The property">
            <Type variant="caption">
              {place.title} · {place.property_type_label}
              {place.region_name ? ` · ${place.region_name}` : ""}
            </Type>
            <Fact label="Water" value={place.features.water_source_label} />
            <Fact label="Power" value={place.features.power_meter_label} />
            <Fact label="Compound" value={place.features.compound_label} />
            <Fact
              label="Security"
              value={place.features.has_security ? "On site" : place.features.is_gated ? "Gated" : "None stated"}
            />
            {place.amenities.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[2] }}>
                {place.amenities.map((row) => <Tag key={row.id} label={row.name} />)}
              </View>
            ) : null}
          </Section>

          {/* One line, with the stamps behind it. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={verified ? "Verified rental. Open verification details." : "Open verification details"}
            onPress={() => setExpandedTrust((value) => !value)}
            style={{ minHeight: 44, justifyContent: "center", paddingTop: space[3], borderTopWidth: 1, borderTopColor: theme.color.field["200"] }}
          >
            <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
              {verified ? "✓ Verified rental" : "Verification details"}
            </Type>
          </Pressable>
          {expandedTrust ? (
            <View style={{ gap: space[2] }}>
              <Stamp state={listing.trust_stamps.identity.state} what="Identity" />
              <Stamp state={place.authority.state} what={listing.provider_label} />
              <Stamp state={rentable.verification.checked ? "verified" : "unverified"} what="This space" />
              <Type variant="caption">
                {listing.trust_stamps.relationship === "owner"
                  ? "Checked as this property's owner."
                  : "Checked as an authorized representative."}
              </Type>
            </View>
          ) : null}

          {related?.length ? (
            <Section title="Related rentals">
              <Type variant="caption">Nearby options at a similar rent.</Type>
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

      {/* The decision bar stays reachable without covering the listing. */}
      {!taken ? (
        <View
          style={{
            gap: space[3], padding: space[4],
            borderTopWidth: 1, borderTopColor: theme.color.field["200"],
            backgroundColor: theme.color.field["0"],
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <View style={{ flex: 1 }}>
              <Type variant="title2">{listing.rent_formatted}</Type>
              <Type variant="caption">per month</Type>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={saved ? "Remove from saved" : "Save this place"}
              onPress={() => void toggleSave()}
              {...pressableFeedback(theme.color.field["200"])}
              style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons
                name={saved ? "heart" : "heart-outline"}
                size={24}
                color={saved ? theme.color.laterite["600"] : theme.color.ink["700"]}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share this rental"
              onPress={() => void shareListing()}
              {...pressableFeedback(theme.color.field["200"])}
              style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="share-outline" size={24} color={theme.color.ink["700"]} />
            </Pressable>
          </View>
          <Button
            label={
              viewingState === "confirmed" ? "Viewing confirmed"
                : viewingState ? "Viewing requested"
                : "Request a viewing"
            }
            busy={asking}
            onPress={() => void askToView()}
          />
        </View>
      ) : null}

      {/* Where photographs are actually explored: one at a time, or all of them
          at once. Eight photographs should never mean eight swipes to reach
          the last one. */}
      <Modal visible={zoomed} animationType="fade" onRequestClose={closePhotos}>
        <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: "#0b110e" }}>
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
        </View>
      </Modal>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <Type variant="title2" accessibilityRole="header">{title}</Type>
      {children}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[4] }}>
      <Type variant="caption">{label}</Type>
      <Type variant="bodyStrong" style={{ flexShrink: 1, textAlign: "right" }}>{value}</Type>
    </View>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <View style={{ paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: 4, backgroundColor: theme.color.field["50"] }}>
      <Type variant="caption">{label}</Type>
    </View>
  );
}
