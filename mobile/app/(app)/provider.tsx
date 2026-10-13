import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth, type ProviderReadiness, type ProviderVerificationStatus } from "@/auth";
import { PendingPulse, Rise, SuccessMark, tick } from "@/components/auth/AuthMotion";
import { AuthAction } from "@/components/auth/AuthScene";
import { VerificationTrack, type TrackStop } from "@/components/auth/VerificationTrack";
import { ph } from "@/components/home/plinth";
import { HeaderChromeBackground } from "@/components/nav/HeaderChromeBackground";
import { Notice, Type, space } from "@/components/ui";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { getProviderReadiness, uploadImage } from "@/provider";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

/**
 * Provider standing — and, until it is approved, the provider's Home.
 *
 * The backend sends a provider whose verification is not yet approved here on
 * every launch (`entry_routes.mobile`), so this page has to be somewhere a
 * person can live for a few days, not a form they bounce off:
 *
 * - **The hero says where they stand**, in one heading and one status pill —
 *   not started, under review, needs something, not approved, verified.
 * - **The four stops** are the same track the welcome showed, so the step that
 *   was "next" then is visibly the one that is done or waiting now.
 * - **Sending evidence is one card**: what kind, the photo, send. A preview of
 *   the picked image replaces a line saying "Document selected".
 * - **What is locked is shown, not hidden**: the provider tools are drawn with
 *   a lock, so somebody exploring knows what they are waiting for and why.
 * - **Meanwhile** there is somewhere to go: browsing, the profile, help.
 *
 * Deliberately not the same screen as claiming a property. This answers a
 * question about the person and is decided once; authority over an address is
 * a separate review, made inside property creation (ADR 0024).
 *
 * Every state below is read from the backend. A client deciding for itself
 * whether the workspace was open is the thing this architecture removed.
 */
type Standing = {
  exists: boolean;
  verification_status: ProviderVerificationStatus | null;
  onboarding_complete: boolean;
  workspace_access: boolean;
  can_create_property: boolean;
};

const DOCUMENT_TYPES: { value: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "ghana_card_front", label: "Ghana Card", icon: "card-outline" },
  { value: "passport", label: "Passport", icon: "book-outline" },
  { value: "drivers_licence", label: "Driver's licence", icon: "car-outline" },
  { value: "ghana_card_back", label: "Ghana Card back", icon: "card" },
];

const LOCKED_TOOLS: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { icon: "business-outline", label: "Properties" },
  { icon: "people-outline", label: "Tenants" },
  { icon: "wallet-outline", label: "Rent & payments" },
  { icon: "megaphone-outline", label: "Listings" },
];

const KOLA = theme.color.kola["600"];
const LAGOON = theme.color.lagoon["600"];
const GOLD = theme.color.gold["600"];
const ALERT = theme.color.laterite["600"];
const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];

type Look = {
  title: string;
  line: string;
  pill: string;
  hue: string;
  wash: string;
};

function lookFor(status: ProviderVerificationStatus): Look {
  switch (status) {
    case "approved":
      return { title: "You're verified", line: "Provider tools are open.", pill: "Approved", hue: KOLA, wash: theme.color.kola["50"] };
    case "pending":
      return {
        title: "Verification under review",
        line: "Your document is with our team. There is nothing more to send.",
        pill: "Under review",
        hue: GOLD,
        wash: theme.color.gold["50"],
      };
    case "needs_more_info":
      return {
        title: "One more thing needed",
        line: "The review is paused until we have it.",
        pill: "Action needed",
        hue: ALERT,
        wash: theme.color.laterite["100"],
      };
    case "rejected":
      return { title: "Not approved yet", line: "Read the note, put it right, and send again.", pill: "Not approved", hue: ALERT, wash: theme.color.laterite["100"] };
    case "revoked":
      return { title: "Approval withdrawn", line: "Provider tools are closed until this is resolved.", pill: "Withdrawn", hue: ALERT, wash: theme.color.laterite["100"] };
    case "expired":
      return { title: "Verification expired", line: "Send a current document to reopen provider tools.", pill: "Expired", hue: ALERT, wash: theme.color.laterite["100"] };
    default:
      return {
        title: "Verify to start operating",
        line: "One ID document opens properties, tenants, rent and listings.",
        pill: "Not verified",
        hue: LAGOON,
        wash: theme.color.lagoon["100"],
      };
  }
}

function stopsFor(status: ProviderVerificationStatus): TrackStop[] {
  const sent = status === "pending" || status === "approved";
  const refused = status === "needs_more_info" || status === "rejected" || status === "revoked" || status === "expired";
  return [
    { state: "done", label: "Account created" },
    {
      state: sent ? "done" : refused ? "attention" : "next",
      label: sent ? "ID document sent" : "Send one ID document",
      detail: sent ? undefined : refused ? "See the note above" : "Ghana Card, passport or driver's licence",
    },
    {
      state: status === "approved" ? "done" : status === "pending" ? "waiting" : "later",
      label: status === "pending" ? "Under review" : "We review it",
      detail: status === "pending" ? "We will let you know the outcome" : undefined,
    },
    { state: status === "approved" ? "done" : "later", label: "Provider tools unlock" },
  ];
}

export default function ProviderStandingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pageBottom = useSafeBottom(space[10]);
  const { refreshMe, signOut } = useAuth();
  const { send } = useLocalSearchParams<{ send?: string }>();

  const [standing, setStanding] = useState<Standing | null>(null);
  const [readiness, setReadiness] = useState<ProviderReadiness | null>(null);
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [documentType, setDocumentType] = useState("ghana_card_front");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The moment the document lands: the status flips, and the card says so.
  const [justSent, setJustSent] = useState(false);

  const scroll = useRef<ScrollView>(null);
  const panelY = useRef(0);
  const scrolledToEvidence = useRef(false);

  const load = useCallback(async () => {
    try {
      const [next, ready] = await Promise.all([
        apiFetch<Standing>("/me/provider-verification/"),
        getProviderReadiness().catch(() => null),
      ]);
      setStanding(next);
      setReadiness(ready);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your status.");
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function chooseDocument() {
    setError("");
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (picked.canceled || !picked.assets[0]) return;
      setAsset(picked.assets[0]);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not choose that document.");
    }
  }

  async function submitDocument() {
    if (!asset) {
      setError("Choose a photo of the document first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const stored = await uploadImage(asset, "identity_document");
      await apiFetch<Standing>("/me/provider-verification/", {
        method: "POST",
        body: { documents: [{ file_id: stored.id, evidence_type: documentType }] },
      });
      setAsset(null);
      setJustSent(true);
      await load();
      await refreshMe();
      scroll.current?.scrollTo({ y: 0, animated: true });
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send that document.");
    } finally {
      setBusy(false);
    }
  }

  async function openWorkspace() {
    await refreshMe();
    router.replace("/(app)/(provider-tabs)" as never);
  }

  const status: ProviderVerificationStatus = standing?.verification_status ?? "not_started";
  const look = lookFor(status);
  const approved = status === "approved";
  const pending = status === "pending";
  const canSend = standing !== null && !approved && !pending;
  const note = readiness?.identity_decision_note || readiness?.decision_note || "";

  return (
    <View style={styles.ground}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: pageBottom }}
        showsVerticalScrollIndicator={false}
      >
        {/* The hero: the same textured green every Home opens on. */}
        <View style={[styles.hero, { paddingTop: insets.top + space[3] }]}>
          <HeaderChromeBackground edge={false} />
          <View style={styles.inner}>
            <View style={styles.crown}>
              {router.canGoBack() ? (
                <Pressable
                  onPress={() => router.back()}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  hitSlop={10}
                  {...pressableFeedback(shell.chromePressed)}
                  style={styles.back}
                >
                  <Ionicons name="arrow-back" size={20} color={shell.onChrome} />
                </Pressable>
              ) : (
                <View style={styles.mark}>
                  <View style={styles.markDot}>
                    <Ionicons name="business" size={13} color={LAGOON} />
                  </View>
                  <Type variant="bodyStrong" allowFontScaling={false} style={styles.markWord}>
                    Rooomly Provider
                  </Type>
                </View>
              )}
              {standing ? (
                <View style={[styles.pill, { backgroundColor: look.wash }]}>
                  {pending ? <PendingPulse color={GOLD} /> : (
                    <Ionicons
                      name={approved ? "shield-checkmark" : status === "not_started" ? "shield-outline" : "alert-circle"}
                      size={14}
                      color={look.hue}
                    />
                  )}
                  <Type variant="captionStrong" style={{ color: look.hue }}>
                    {look.pill}
                  </Type>
                </View>
              ) : null}
            </View>
            <View style={{ gap: space[2] }}>
              <Type variant="display3" accessibilityRole="header" style={{ color: shell.onChrome }}>
                {standing ? look.title : "Provider verification"}
              </Type>
              <Type variant="caption" style={styles.heroLine}>
                {standing ? look.line : "Checking where your verification stands…"}
              </Type>
            </View>
          </View>
        </View>

        <View style={styles.panel} onLayout={(event) => { panelY.current = event.nativeEvent.layout.y; }}>
          <View style={styles.column}>
            {error ? <Notice tone="error" title={error} /> : null}

            {!standing && !error ? (
              <View style={styles.loading}>
                <ActivityIndicator color={KOLA} />
              </View>
            ) : null}

            {standing ? (
              <>
                {/* Where they are on the way. */}
                <Rise>
                  <View style={styles.card}>
                    {justSent && pending ? (
                      <View style={styles.sent}>
                        <SuccessMark tone={KOLA} />
                        <Type variant="title2" style={{ textAlign: "center" }}>
                          Verification submitted
                        </Type>
                        <Type variant="caption" style={styles.centerMuted}>
                          It is under review. We will tell you the outcome — you can keep exploring meanwhile.
                        </Type>
                      </View>
                    ) : null}
                    {note && (status === "needs_more_info" || status === "rejected" || status === "revoked") ? (
                      <Notice tone={status === "needs_more_info" ? "warning" : "error"} title="From the review" body={note} />
                    ) : null}
                    <VerificationTrack stops={stopsFor(status)} />
                    {approved ? <AuthAction label="Open provider workspace" onPress={() => void openWorkspace()} /> : null}
                  </View>
                </Rise>

                {/* Sending evidence. */}
                {canSend ? (
                  <View
                    onLayout={(event) => {
                      // Arrived from the welcome's "Verify now": bring the card up
                      // under the hero's foot, once.
                      if (!send || scrolledToEvidence.current) return;
                      scrolledToEvidence.current = true;
                      const y = panelY.current + space[6] + event.nativeEvent.layout.y;
                      scroll.current?.scrollTo({ y: Math.max(0, y - space[4]), animated: true });
                    }}
                  >
                  <Rise index={1}>
                    <View style={styles.card}>
                      <View style={{ gap: 2 }}>
                        <Type variant="title2">Send one ID document</Type>
                        <Type variant="caption" style={styles.muted}>
                          A clear photo of a current government ID. It confirms who you are, once, for every property you manage.
                        </Type>
                      </View>

                      <View style={styles.types} accessibilityRole="radiogroup">
                        {DOCUMENT_TYPES.map((type) => {
                          const on = documentType === type.value;
                          return (
                            <Pressable
                              key={type.value}
                              onPress={() => {
                                tick();
                                setDocumentType(type.value);
                              }}
                              accessibilityRole="radio"
                              aria-checked={on}
                              accessibilityLabel={type.label}
                              {...pressableFeedback(alpha(LAGOON, 0.12))}
                              style={[styles.type, on ? styles.typeOn : null]}
                            >
                              <Ionicons name={type.icon} size={18} color={on ? LAGOON : theme.color.ink["500"]} />
                              <Type variant={on ? "captionStrong" : "caption"} style={{ color: on ? LAGOON : theme.color.ink["700"], flexShrink: 1 }}>
                                {type.label}
                              </Type>
                            </Pressable>
                          );
                        })}
                      </View>

                      <Pressable
                        onPress={() => void chooseDocument()}
                        disabled={busy}
                        accessibilityRole="button"
                        accessibilityLabel={asset ? "Change the photo" : "Choose a photo of the document"}
                        {...pressableFeedback(alpha(LAGOON, 0.12))}
                        style={[styles.drop, asset ? styles.dropFilled : null]}
                      >
                        {asset ? (
                          <>
                            <Image source={{ uri: asset.uri }} style={styles.preview} resizeMode="cover" />
                            <View style={{ flex: 1, gap: 2 }}>
                              <Type variant="bodyStrong" numberOfLines={1}>
                                {asset.fileName || "Photo chosen"}
                              </Type>
                              <Type variant="caption" style={{ color: LAGOON }}>
                                Tap to change
                              </Type>
                            </View>
                            <Ionicons name="checkmark-circle" size={22} color={KOLA} />
                          </>
                        ) : (
                          <>
                            <View style={styles.dropIcon}>
                              <Ionicons name="image-outline" size={22} color={LAGOON} />
                            </View>
                            <View style={{ flex: 1, gap: 2 }}>
                              <Type variant="bodyStrong">Choose a photo</Type>
                              <Type variant="caption" style={styles.muted}>
                                All four corners in view, nothing covered
                              </Type>
                            </View>
                          </>
                        )}
                      </Pressable>

                      <AuthAction
                        label={asset ? "Send for review" : "Choose a photo to send"}
                        busyLabel="Sending…"
                        onPress={() => void submitDocument()}
                        busy={busy}
                        disabled={!asset}
                      />
                      <Type variant="caption" style={styles.centerMuted}>
                        {"Seen only by Rooomly's review team."}
                      </Type>
                    </View>
                  </Rise>
                  </View>
                ) : null}

                {/* What is waiting for them. */}
                {!approved ? (
                  <Rise index={2}>
                    <View style={{ gap: space[3] }}>
                      <View style={styles.sectionHead}>
                        <Ionicons name="lock-closed" size={14} color={theme.color.ink["500"]} />
                        <Type variant="captionStrong" style={{ color: theme.color.ink["700"] }}>
                          Unlocks after verification
                        </Type>
                      </View>
                      <View style={styles.tools}>
                        {LOCKED_TOOLS.map((tool) => (
                          <View
                            key={tool.label}
                            style={styles.tool}
                            accessible
                            accessibilityLabel={`${tool.label}, locked until verification is approved`}
                          >
                            <View style={styles.toolIcon}>
                              <Ionicons name={tool.icon} size={20} color={alpha(DEEP, 0.45)} />
                              <View style={styles.toolLock}>
                                <Ionicons name="lock-closed" size={9} color={WHITE} />
                              </View>
                            </View>
                            <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
                              {tool.label}
                            </Type>
                          </View>
                        ))}
                      </View>
                    </View>
                  </Rise>
                ) : null}

                {/* Meanwhile. */}
                <Rise index={3}>
                  <View style={styles.card}>
                    <Type variant="captionStrong" style={{ color: theme.color.ink["700"] }}>
                      Meanwhile
                    </Type>
                    <Row icon="search" label="Explore homes" onPress={() => router.push("/(app)/(tabs)/explore" as never)} />
                    <View style={styles.rule} />
                    <Row icon="person-circle-outline" label="Your profile" onPress={() => router.push("/(app)/profile-edit" as never)} />
                    <View style={styles.rule} />
                    <Row icon="help-circle-outline" label="Help" onPress={() => router.push("/(app)/help" as never)} />
                  </View>
                </Rise>

                <Pressable
                  onPress={() => void signOut()}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => [styles.signOut, pressed ? { opacity: 0.6 } : null]}
                >
                  <Type variant="captionStrong" style={{ color: theme.color.ink["500"] }}>
                    Sign out
                  </Type>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => [styles.row, pressed ? { opacity: 0.7 } : null]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={KOLA} />
      </View>
      <Type variant="body" style={{ flex: 1 }}>
        {label}
      </Type>
      <Ionicons name="chevron-forward" size={16} color={alpha(DEEP, 0.3)} />
    </Pressable>
  );
}

const RISE = 28;

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: ph.ground,
  },
  hero: {
    paddingHorizontal: space[5],
    paddingBottom: RISE + space[6],
    backgroundColor: shell.chrome,
  },
  inner: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    gap: space[5],
  },
  crown: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: shell.chromeRaised,
    overflow: "hidden",
  },
  mark: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  markDot: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: shell.onChrome,
  },
  markWord: {
    color: shell.onChrome,
    letterSpacing: -0.3,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: space[3],
    borderRadius: 999,
  },
  heroLine: {
    color: shell.onChromeMuted,
    fontSize: 15,
    lineHeight: 21,
    maxWidth: 380,
  },
  panel: {
    flexGrow: 1,
    marginTop: -RISE,
    paddingTop: space[6],
    paddingHorizontal: space[5],
    borderTopLeftRadius: RISE,
    borderTopRightRadius: RISE,
    backgroundColor: ph.ground,
  },
  column: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    gap: space[5],
  },
  loading: {
    paddingVertical: space[10],
    alignItems: "center",
  },
  card: {
    gap: space[4],
    padding: space[4],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.08),
    backgroundColor: WHITE,
  },
  sent: {
    alignItems: "center",
    gap: space[1],
    paddingBottom: space[2],
  },
  muted: {
    color: theme.color.ink["700"],
  },
  centerMuted: {
    textAlign: "center",
    color: theme.color.ink["500"],
  },
  types: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  type: {
    flexGrow: 1,
    flexBasis: "45%",
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    minHeight: 48,
    paddingHorizontal: space[3],
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: alpha(DEEP, 0.08),
    backgroundColor: theme.color.field["50"],
    overflow: "hidden",
  },
  typeOn: {
    borderColor: LAGOON,
    backgroundColor: theme.color.lagoon["100"],
  },
  drop: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    minHeight: 76,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: alpha(LAGOON, 0.45),
    backgroundColor: alpha(LAGOON, 0.04),
    overflow: "hidden",
  },
  dropFilled: {
    borderStyle: "solid",
    borderColor: alpha(KOLA, 0.35),
    backgroundColor: theme.color.kola["50"],
  },
  dropIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.lagoon["100"],
  },
  preview: {
    width: 64,
    height: 48,
    borderRadius: 10,
    backgroundColor: theme.color.field["100"],
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[1],
  },
  tools: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  tool: {
    flexGrow: 1,
    flexBasis: "45%",
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.06),
    backgroundColor: alpha(WHITE, 0.55),
  },
  toolIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: alpha(DEEP, 0.05),
  },
  toolLock: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    borderWidth: 1.5,
    borderColor: WHITE,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 44,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.kola["50"],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 44,
    backgroundColor: alpha(DEEP, 0.08),
  },
  signOut: {
    alignSelf: "center",
    paddingVertical: space[2],
    paddingHorizontal: space[4],
  },
});
