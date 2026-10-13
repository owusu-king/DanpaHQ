/**
 * A property for sale, as a buyer decides on it — the twin of the web
 * `/sales/[id]`, shaped like the rental page beside it: photographs, what it is
 * and where, the seller's words, the building, then one decision bar.
 *
 * The bar's act is an enquiry, never a phone number (owner, 2026-09-28): the
 * seller's contact stays private and the conversation lives in Enquiries. The
 * page is only reachable while the sale is public — the backend answers 404
 * otherwise — so nothing here decides that.
 */

import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Fact, GroupLabel, RecordPanel } from "@/components/record/RecordSurfaces";
import { useStackHeaderHeight } from "@/components/nav/StackHeader";
import { ModalSafeArea } from "@/components/sheet/ModalSafeArea";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { rememberOnboardingIntent } from "@/onboardingIntent";
import { isIOS, useSafeBottom } from "@/platform";
import { getSale, saleFacts, startEnquiry, type SaleDetail } from "@/sales";
import { shell } from "@/shell";
import { theme } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

export default function SaleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pageBottom = useSafeBottom(space[12]);
  const insets = useSafeAreaInsets();
  const headerHeight = useStackHeaderHeight();
  const { state } = useAuth();
  const signedIn = state.status === "signed_in";
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const width = useRef(Dimensions.get("window").width).current;
  const heroScroll = useRef<ScrollView>(null);
  const viewerScroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (!id || state.status === "loading") return;
    let current = true;
    setLoadError("");
    getSale(id)
      .then((value) => { if (current) setSale(value); })
      .catch((cause) => {
        if (current) setLoadError(cause instanceof ApiFailure ? cause.error.message : "We could not open that property.");
      });
    return () => { current = false; };
  }, [id, signedIn, state.status]);

  if (loadError && !sale) {
    return (
      <View style={{ padding: space[5] }}>
        <Notice tone="error" title={loadError} body="It may have been sold or taken off the market." />
      </View>
    );
  }
  if (!sale) return <View style={{ padding: space[5] }}><Type variant="caption">Loading…</Type></View>;

  const photos = sale.gallery.filter((photo) => photo.download_url);
  const heroHeight = Math.min(Math.round(width * 0.62), 280);
  const where = [sale.locality_name, sale.district_name].filter(Boolean).join(", ");
  const land = sale.kind === "land";
  const facts: [string, IconName][] = [
    [sale.kind_label, land ? "map-outline" : sale.kind === "commercial" ? "storefront-outline" : "home-outline"],
    ...saleFacts(sale).map((fact): [string, IconName] => [fact, "resize-outline"]),
    ...(land && sale.is_serviced ? [["Serviced plot", "flash-outline"] as [string, IconName]] : []),
  ];
  const tenure = sale.tenure === "leasehold" && sale.lease_years_remaining
    ? `Leasehold · ${sale.lease_years_remaining} years left`
    : sale.tenure_label;

  async function signIn() {
    await rememberOnboardingIntent("find_property");
    router.push({ pathname: "/(auth)/register", params: { workspace: "tenant", next: `/(app)/sale/${id}` } });
  }

  async function send() {
    const body = message.trim();
    if (body.length < 10) {
      setError("Say a little more — at least a sentence the seller can answer.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const enquiry = await startEnquiry(sale!.id, body);
      router.replace({ pathname: "/(app)/enquiry/[id]", params: { id: enquiry.id } });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "We could not send your enquiry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    // The enquiry is written in the bar at the foot, so the keyboard lifts the page.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: shell.record }}
      behavior={isIOS ? "padding" : undefined}
      keyboardVerticalOffset={isIOS ? headerHeight : 0}
    >
      <Stack.Screen options={{ title: "For sale" }} />
      <ScrollView contentContainerStyle={{ paddingBottom: pageBottom }} keyboardShouldPersistTaps="handled">
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
                  accessibilityLabel={`Photo ${index + 1} of ${photos.length}. Open photographs.`}
                  onPress={() => { setPhotoIndex(index); setZoomed(true); }}
                >
                  <Image source={{ uri: photo.download_url }} style={{ width, height: heroHeight }} resizeMode="cover" />
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.forSale}>
              <Type variant="captionStrong" style={styles.forSaleText}>FOR SALE</Type>
            </View>
            {photos.length > 1 ? (
              <View style={styles.count}>
                <Ionicons name="images-outline" size={13} color={theme.color.field["0"]} />
                <Type variant="caption" style={{ color: theme.color.field["0"] }}>
                  {photoIndex + 1} / {photos.length}
                </Type>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ height: heroHeight, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.field["100"] }}>
            <Ionicons name="image-outline" size={30} color={theme.color.ink["300"]} />
          </View>
        )}

        <View style={styles.page}>
          <View style={styles.identity}>
            <Type variant="display2" accessibilityRole="header">
              {sale.headline || `${sale.kind_label} for sale`}
            </Type>
            <View style={styles.where}>
              <Ionicons name="location-outline" size={15} color={theme.color.ink["500"]} />
              <Type variant="caption" style={styles.whereText}>
                {where || "Ghana"}{sale.landmark ? ` · near ${sale.landmark}` : ""}
              </Type>
            </View>
          </View>

          <View style={styles.facts}>
            {facts.map(([fact, icon]) => (
              <View key={fact} style={styles.fact}>
                <Ionicons name={icon} size={15} color={theme.color.kola["800"]} />
                <Type variant="captionStrong" style={{ color: theme.color.ink["900"] }}>{fact}</Type>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <GroupLabel>Price and terms</GroupLabel>
            <RecordPanel>
              <View style={styles.priceLead}>
                <Type variant="caption" style={styles.muted}>{sale.price_negotiable ? "Asking · negotiable" : "Asking price"}</Type>
                <Type variant="title1" style={{ color: theme.color.ink["900"] }}>{sale.price_formatted ?? "Price on request"}</Type>
              </View>
              {tenure ? <Fact label="Tenure" value={tenure} /> : null}
              <Fact label="Sold by" value={sale.seller_label} />
            </RecordPanel>
          </View>

          <View style={styles.trust}>
            <View style={styles.trustMark}>
              <Ionicons name="shield-checkmark" size={17} color={theme.color.kola["800"]} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Type variant="bodyStrong" style={{ color: theme.color.kola["800"] }}>Verified for sale</Type>
              <Type variant="caption" style={styles.muted}>
                Our team read the title and checked the seller may sell it. Still have a lawyer search the title before you pay.
              </Type>
            </View>
          </View>

          {sale.description ? (
            <View style={styles.section}>
              <GroupLabel>{land ? "About this land" : "About this property"}</GroupLabel>
              <RecordPanel style={styles.prose}>
                <Type variant="body">{sale.description}</Type>
              </RecordPanel>
            </View>
          ) : null}

          {sale.features ? (
            <View style={styles.section}>
              <GroupLabel>The building</GroupLabel>
              <RecordPanel>
                <Feature first icon="water-outline" label="Water" value={sale.features.water_source_label} />
                <Feature icon="flash-outline" label="Power" value={sale.features.power_meter_label} />
                <Feature icon="business-outline" label="Compound" value={sale.features.compound_label} />
                <Feature
                  icon="shield-outline"
                  label="Security"
                  value={sale.features.has_security ? "On site" : sale.features.is_gated ? "Gated" : "None stated"}
                />
                {sale.amenities.length ? (
                  <View style={styles.tags}>
                    {sale.amenities.map((row) => (
                      <View key={row.id} style={styles.tag}>
                        <Ionicons name="checkmark" size={13} color={theme.color.kola["800"]} />
                        <Type variant="caption" style={{ color: theme.color.kola["800"] }}>{row.name}</Type>
                      </View>
                    ))}
                  </View>
                ) : null}
              </RecordPanel>
            </View>
          ) : null}

          <Type variant="caption" style={styles.muted}>
            Shown by area only. The seller shares the exact location when you arrange to see it.
          </Type>
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
        {writing ? (
          <View style={{ gap: space[2] }}>
            <Field
              label={`Your message to ${sale.seller_label}`}
              placeholder="Is it still available? When could I see it?"
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={3}
              maxLength={2000}
              autoFocus
              style={{ minHeight: 84, textAlignVertical: "top", paddingTop: space[3] }}
            />
            <Type variant="caption" style={styles.muted}>Your name goes with it. Your phone number does not.</Type>
            {error ? <Notice tone="error" title={error} /> : null}
            <View style={{ flexDirection: "row", gap: space[2] }}>
              <View style={{ flex: 1 }}>
                <Button label="Not now" variant="secondary" disabled={busy} onPress={() => setWriting(false)} />
              </View>
              <View style={{ flex: 2 }}>
                <Button label="Send enquiry" busy={busy} busyLabel="Sending" onPress={() => void send()} />
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.barRow}>
            <View style={{ flex: 1 }}>
              <Type variant="title2" numberOfLines={1}>{sale.price_formatted ?? "Price on request"}</Type>
              <Type variant="caption" style={styles.muted}>{sale.price_negotiable ? "Negotiable" : sale.kind_label}</Type>
            </View>
            <View style={{ flex: 1.2 }}>
              {sale.my_enquiry_id ? (
                <Button
                  label="Open your enquiry"
                  onPress={() => router.push({ pathname: "/(app)/enquiry/[id]", params: { id: sale.my_enquiry_id! } })}
                />
              ) : (
                <Button
                  label="Send an enquiry"
                  icon={<Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.color.field["0"]} />}
                  onPress={() => (signedIn ? setWriting(true) : void signIn())}
                />
              )}
            </View>
          </View>
        )}
      </View>

      <Modal visible={zoomed} animationType="fade" onRequestClose={() => setZoomed(false)}>
        <ModalSafeArea>
          <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: "#0b110e" }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space[2] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close photographs"
                onPress={() => {
                  setZoomed(false);
                  heroScroll.current?.scrollTo({ x: photoIndex * width, animated: false });
                }}
                style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="close" size={26} color={theme.color.field["0"]} />
              </Pressable>
              <Type variant="caption" style={{ flex: 1, textAlign: "center", color: theme.color.field["0"] }}>
                {photoIndex + 1} of {photos.length}
              </Type>
              <View style={{ width: 48 }} />
            </View>
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
                  <Image source={{ uri: photo.download_url }} style={{ width, height: "80%" }} resizeMode="contain" />
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        </ModalSafeArea>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function Feature({ icon, label, value, first = false }: { icon: IconName; label: string; value: string; first?: boolean }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}`} style={[styles.feature, first ? { borderTopWidth: 0 } : null]}>
      <View style={styles.featureMark}>
        <Ionicons name={icon} size={15} color={theme.color.kola["800"]} />
      </View>
      <Type variant="caption" style={[styles.muted, { flex: 1 }]}>{label}</Type>
      <Type variant="bodyStrong" style={{ flexShrink: 1, textAlign: "right" }}>{value}</Type>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: space[5],
    paddingHorizontal: space[4],
    paddingTop: space[5],
  },
  forSale: {
    position: "absolute",
    left: space[3],
    top: space[3],
    paddingHorizontal: space[3],
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: theme.color.kola["600"],
  },
  forSaleText: {
    fontSize: 11.5,
    letterSpacing: 0.6,
    color: theme.color.field["0"],
  },
  count: {
    position: "absolute",
    right: space[3],
    bottom: space[3],
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    minHeight: 32,
    paddingHorizontal: space[3],
    borderRadius: 16,
    backgroundColor: "rgba(15,24,20,0.62)",
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
  section: {
    gap: space[2],
  },
  priceLead: {
    gap: 2,
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[3],
  },
  muted: {
    color: theme.color.ink["500"],
  },
  trust: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[4],
    borderRadius: 16,
    backgroundColor: theme.color.kola["50"],
  },
  trustMark: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["0"],
  },
  prose: {
    paddingHorizontal: space[4],
    paddingVertical: space[4],
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
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
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
    backgroundColor: theme.color.field["0"],
  },
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
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
});
