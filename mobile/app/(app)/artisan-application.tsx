import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiFailure } from "@/api";
import {
  ARTISAN_STATUS_LOOK,
  MAX_DISTRICTS,
  MAX_WORK_PHOTOS,
  MIN_WORK_PHOTOS,
  applyAsArtisan,
  canSendApplication,
  getMyArtisanApplication,
  listDistricts,
  type ArtisanApplication,
  type District,
} from "@/artisan";
import { useAuth, type ArtisanStatus } from "@/auth";
import { ArtisanFacts } from "@/components/artisan/ArtisanFacts";
import { PendingPulse, Rise, SuccessMark, tick } from "@/components/auth/AuthMotion";
import { AuthAction } from "@/components/auth/AuthScene";
import { VerificationTrack, type TrackStop } from "@/components/auth/VerificationTrack";
import { ph } from "@/components/home/plinth";
import { Chip, Field, Notice, Type, space } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { uploadImage } from "@/provider";
import { alpha } from "@/shell";
import { theme } from "@/theme";
import { chooseWorkspace } from "@/workspace";

/**
 * Becoming an artisan — the application, and where it stands. Mirrors web's
 * `/artisan`.
 *
 * Reached from Menu in whichever experience somebody is in, and it leaves them
 * there: nothing on this screen switches experience except the one button an
 * approved artisan presses themselves. Every state is read from the backend.
 *
 * The form asks for what a reviewer needs and nothing more: trades, area, a few
 * photographs of finished work and — only when Danpa HQ does not already hold
 * one — a government ID. Certificates are optional for every trade. Sending
 * again after a reviewer asked for more starts from what was sent last time,
 * so nobody uploads the same photograph twice.
 */

const AMBER = theme.color.harmattan["600"];
const AMBER_WASH = theme.color.harmattan["100"];
const KOLA = theme.color.kola["600"];
const LAGOON = theme.color.lagoon["600"];
const ALERT = theme.color.laterite["600"];
const GOLD = theme.color.gold["600"];
const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];

const ID_TYPES: { value: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "ghana_card_front", label: "Ghana Card", icon: "card-outline" },
  { value: "passport", label: "Passport", icon: "book-outline" },
  { value: "drivers_licence", label: "Driver's licence", icon: "car-outline" },
];

const PILL_TONE: Record<string, { ink: string; wash: string }> = {
  calm: { ink: LAGOON, wash: theme.color.lagoon["100"] },
  waiting: { ink: GOLD, wash: theme.color.gold["50"] },
  attention: { ink: ALERT, wash: theme.color.laterite["100"] },
  approved: { ink: theme.color.kola["800"], wash: theme.color.kola["50"] },
};

type Photo = { key: string; fileId?: string; asset?: ImagePicker.ImagePickerAsset; uri: string | null };
type Certificate = {
  key: string;
  fileId?: string;
  asset?: ImagePicker.ImagePickerAsset;
  name: string;
  trade: string;
  issuingBody: string;
  expiresOn: string;
};

let sequence = 0;
const nextKey = () => `k${++sequence}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function stopsFor(status: ArtisanStatus): TrackStop[] {
  const sent = status !== "not_started";
  const refused = status === "needs_more_info" || status === "rejected" || status === "revoked";
  const open = status === "approved" || status === "suspended";
  return [
    {
      state: refused ? "attention" : sent ? "done" : "next",
      label: refused ? "Update your application" : "Apply",
      detail: refused ? "See the note above" : "Trades, area and photos of your work",
    },
    {
      state: open ? "done" : status === "pending" ? "waiting" : "later",
      label: status === "pending" ? "Under review" : "We review it",
      detail: status === "pending" ? "We will let you know the outcome" : "Your account carries on as it is meanwhile",
    },
    { state: open ? "done" : "later", label: "Artisan work opens", detail: "Quote requests, jobs and your profile" },
  ];
}

export default function ArtisanApplicationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pageBottom = useSafeBottom(space[10]);
  const { state, refreshMe } = useAuth();
  const scroll = useRef<ScrollView>(null);

  const [application, setApplication] = useState<ArtisanApplication | null>(null);
  const [error, setError] = useState("");
  const [justSent, setJustSent] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try {
      setApplication(await getMyArtisanApplication());
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your application.");
    }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function enter() {
    setSwitching(true);
    try {
      const next = await chooseWorkspace("artisan");
      await refreshMe();
      router.replace(resolveEntryRoute(next) as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not open artisan work.");
      setSwitching(false);
    }
  }

  const status: ArtisanStatus = application?.status ?? "not_started";
  const look = ARTISAN_STATUS_LOOK[status];
  const pill = PILL_TONE[look.tone]!;
  const open = status === "approved" || status === "suspended";
  // Already inside, the way in would lead back to where they stand.
  const inside = state.status === "signed_in" && state.me.capabilities.active_workspace === "artisan";

  return (
    <View style={styles.ground}>
      <ScrollView ref={scroll} contentContainerStyle={{ flexGrow: 1, paddingBottom: pageBottom }} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { paddingTop: insets.top + space[3] }]}>
          <Ionicons name="hammer" size={180} color={alpha(WHITE, 0.09)} style={styles.heroMark} />
          <View style={styles.inner}>
            <View style={styles.crown}>
              <Pressable
                onPress={() => {
                  if (router.canGoBack()) router.back();
                  else if (state.status === "signed_in") router.replace(resolveEntryRoute(state.me) as never);
                }}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                hitSlop={10}
                {...pressableFeedback(alpha(WHITE, 0.2))}
                style={styles.back}
              >
                <Ionicons name="arrow-back" size={20} color={WHITE} />
              </Pressable>
              {application ? (
                <View style={[styles.pill, { backgroundColor: pill.wash }]}>
                  {look.icon ? <Ionicons name={look.icon} size={14} color={pill.ink} /> : <PendingPulse color={GOLD} />}
                  <Type variant="captionStrong" style={{ color: pill.ink }}>{look.pill}</Type>
                </View>
              ) : null}
            </View>
            <View style={{ gap: space[2] }}>
              <Type variant="display3" accessibilityRole="header" style={{ color: WHITE }}>
                {application ? look.title : "Work as an artisan"}
              </Type>
              <Type variant="caption" style={styles.heroLine}>
                {application ? look.line : "Checking where your application stands…"}
              </Type>
            </View>
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.column}>
            {error ? <Notice tone="error" title={error} /> : null}
            {!application && !error ? (
              <View style={{ paddingVertical: space[10], alignItems: "center" }}>
                <ActivityIndicator color={AMBER} />
              </View>
            ) : null}

            {application ? (
              <>
                <Rise>
                  <View style={styles.card}>
                    {justSent && status === "pending" ? (
                      <View style={styles.sent}>
                        <SuccessMark tone={KOLA} />
                        <Type variant="title2" style={{ textAlign: "center" }}>Application sent</Type>
                        <Type variant="caption" style={styles.centerMuted}>
                          It is with our team. Your account carries on exactly as it was meanwhile.
                        </Type>
                      </View>
                    ) : null}
                    {application.decision_note ? (
                      <Notice tone={status === "needs_more_info" ? "warning" : "error"} title="From the review" body={application.decision_note} />
                    ) : null}
                    {status === "suspended" && application.suspended_reason ? (
                      <Notice tone="warning" title="Why your account is suspended" body={application.suspended_reason} />
                    ) : null}
                    <VerificationTrack stops={stopsFor(status)} />
                    {open && !inside ? (
                      <AuthAction label="Switch to artisan work" busyLabel="Opening…" busy={switching} onPress={() => void enter()} />
                    ) : null}
                  </View>
                </Rise>

                {canSendApplication(status) ? (
                  <ApplicationForm
                    application={application}
                    onSent={(next) => {
                      setApplication(next);
                      setJustSent(true);
                      void refreshMe();
                      scroll.current?.scrollTo({ y: 0, animated: true });
                    }}
                  />
                ) : application.profile ? (
                  <Rise index={1}>
                    <View style={styles.card}>
                      <Type variant="title2">What you sent</Type>
                      <ArtisanFacts profile={application.profile} />
                    </View>
                  </Rise>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function ApplicationForm({ application, onSent }: { application: ArtisanApplication; onSent: (next: ArtisanApplication) => void }) {
  const profile = application.profile;
  const [trades, setTrades] = useState<string[]>(profile?.trades.map((trade) => trade.value) ?? []);
  const [districts, setDistricts] = useState<District[]>(
    profile?.districts.map((district) => ({ id: district.id, name: district.name, region_name: district.region })) ?? [],
  );
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [photos, setPhotos] = useState<Photo[]>(
    profile?.portfolio.map((photo) => ({ key: nextKey(), fileId: photo.file_id, uri: photo.url })) ?? [],
  );
  const [idType, setIdType] = useState("ghana_card_front");
  const [idAsset, setIdAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [certificates, setCertificates] = useState<Certificate[]>(
    profile?.certificates.map((certificate) => ({
      key: nextKey(),
      fileId: certificate.file_id,
      name: `${certificate.trade_label} certificate`,
      trade: certificate.trade,
      issuingBody: certificate.issuing_body,
      expiresOn: certificate.expires_on ?? "",
    })) ?? [],
  );
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const needsId = !application.identity_on_file;
  const missing = {
    trades: trades.length === 0,
    districts: districts.length === 0,
    photos: photos.length < MIN_WORK_PHOTOS,
    id: needsId && !idAsset,
    certificates: certificates.some((row) => !row.trade || !row.issuingBody.trim() || (row.expiresOn !== "" && !DATE.test(row.expiresOn))),
  };
  const ready = !Object.values(missing).some(Boolean);

  async function addPhotos() {
    const room = MAX_WORK_PHOTOS - photos.length;
    if (room <= 0) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 0.8,
    });
    if (picked.canceled) return;
    setPhotos((current) => [
      ...current,
      ...picked.assets.slice(0, room).map((asset) => ({ key: nextKey(), asset, uri: asset.uri })),
    ]);
  }

  async function chooseId() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!picked.canceled && picked.assets[0]) setIdAsset(picked.assets[0]);
  }

  async function addCertificate() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    setCertificates((current) => [
      ...current,
      { key: nextKey(), asset, name: asset.fileName || "Certificate photo", trade: trades[0] ?? "", issuingBody: "", expiresOn: "" },
    ]);
  }

  function updateCertificate(key: string, patch: Partial<Certificate>) {
    setCertificates((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function submit() {
    setAttempted(true);
    if (!ready) return;
    setError("");
    try {
      // One file at a time: on a metered connection a failure part-way should
      // cost one photograph, not all of them.
      const portfolio: string[] = [];
      for (const [index, photo] of photos.entries()) {
        if (photo.fileId) {
          portfolio.push(photo.fileId);
          continue;
        }
        setBusy(`Uploading photo ${index + 1} of ${photos.length}…`);
        portfolio.push((await uploadImage(photo.asset!, "artisan_work_photo")).id);
      }
      const identity = [];
      if (needsId && idAsset) {
        setBusy("Uploading your ID…");
        identity.push({ file_id: (await uploadImage(idAsset, "identity_document")).id, evidence_type: idType });
      }
      const certificateRows = [];
      for (const row of certificates) {
        let fileId = row.fileId;
        if (!fileId && row.asset) {
          setBusy("Uploading your certificates…");
          fileId = (await uploadImage(row.asset, "artisan_certificate")).id;
        }
        if (!fileId) continue;
        certificateRows.push({ file_id: fileId, trade: row.trade, issuing_body: row.issuingBody.trim(), expires_on: row.expiresOn || null });
      }
      setBusy("Sending your application…");
      const next = await applyAsArtisan({
        trades,
        district_ids: districts.map((district) => district.id),
        bio: bio.trim(),
        portfolio_file_ids: portfolio,
        identity_documents: identity,
        certificates: certificateRows,
      });
      onSent(next);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : cause instanceof Error ? cause.message : "Could not send your application.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <Rise index={1}>
        <Step number="1" title="What you do" line="Choose every trade you take work in.">
          <View style={styles.chips}>
            {application.trade_options.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={trades.includes(option.value)}
                onPress={() =>
                  setTrades((current) =>
                    current.includes(option.value) ? current.filter((value) => value !== option.value) : [...current, option.value],
                  )}
              />
            ))}
          </View>
          {attempted && missing.trades ? <Missing text="Choose at least one trade." /> : null}
        </Step>
      </Rise>

      <Rise index={2}>
        <Step number="2" title="Where you work" line="The districts you will travel to. Customers see the area you cover, never your address.">
          <DistrictPicker selected={districts} onChange={setDistricts} />
          {attempted && missing.districts ? <Missing text="Choose at least one district." /> : null}
        </Step>
      </Rise>

      <Rise index={3}>
        <Step number="3" title="Your work" line={`Up to ${MAX_WORK_PHOTOS} photos of jobs you have finished, and a few words about how you work.`}>
          <View style={styles.photos}>
            {photos.map((photo, index) => (
              <View key={photo.key} style={styles.photo}>
                {photo.uri ? <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} accessibilityLabel={`Work photo ${index + 1}`} /> : null}
                <Pressable
                  onPress={() => setPhotos((current) => current.filter((row) => row.key !== photo.key))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove work photo ${index + 1}`}
                  hitSlop={6}
                  style={styles.photoRemove}
                >
                  <Ionicons name="close" size={14} color={WHITE} />
                </Pressable>
              </View>
            ))}
            {photos.length < MAX_WORK_PHOTOS ? (
              <Pressable
                onPress={() => void addPhotos()}
                accessibilityRole="button"
                accessibilityLabel="Add photos of your work"
                {...pressableFeedback(alpha(AMBER, 0.12))}
                style={styles.photoAdd}
              >
                <Ionicons name="images-outline" size={22} color={AMBER} />
                <Type variant="captionStrong" style={{ color: AMBER }}>{photos.length ? "Add more" : "Add photos"}</Type>
              </Pressable>
            ) : null}
          </View>
          {attempted && missing.photos ? <Missing text="Add at least one photo of your work." /> : null}
          <Field
            label="About your work (optional)"
            value={bio}
            onChangeText={setBio}
            multiline
            maxLength={600}
            placeholder="How long you have done this, and the jobs you take on."
            style={{ minHeight: 88, textAlignVertical: "top" }}
          />
        </Step>
      </Rise>

      <Rise index={4}>
        {needsId ? (
          <Step number="4" title="Your ID" line="A clear photo of a current government ID. Only Danpa HQ's review team sees it.">
            <View style={styles.types} accessibilityRole="radiogroup">
              {ID_TYPES.map((type) => {
                const on = idType === type.value;
                return (
                  <Pressable
                    key={type.value}
                    onPress={() => { tick(); setIdType(type.value); }}
                    accessibilityRole="radio"
                    aria-checked={on}
                    accessibilityLabel={type.label}
                    {...pressableFeedback(alpha(LAGOON, 0.12))}
                    style={[styles.type, on ? styles.typeOn : null]}
                  >
                    <Ionicons name={type.icon} size={18} color={on ? LAGOON : theme.color.ink["500"]} />
                    <Type variant={on ? "captionStrong" : "caption"} style={{ color: on ? LAGOON : theme.color.ink["700"], flexShrink: 1 }}>{type.label}</Type>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => void chooseId()}
              accessibilityRole="button"
              accessibilityLabel={idAsset ? "Change the photo of your ID" : "Choose a photo of your ID"}
              {...pressableFeedback(alpha(LAGOON, 0.12))}
              style={[styles.drop, idAsset ? styles.dropFilled : null]}
            >
              {idAsset ? <Image source={{ uri: idAsset.uri }} style={styles.preview} /> : (
                <View style={styles.dropIcon}><Ionicons name="image-outline" size={22} color={LAGOON} /></View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Type variant="bodyStrong" numberOfLines={1}>{idAsset ? idAsset.fileName || "Photo chosen" : "Choose a photo"}</Type>
                <Type variant="caption" style={{ color: idAsset ? LAGOON : theme.color.ink["500"] }}>
                  {idAsset ? "Tap to change" : "All four corners in view, nothing covered"}
                </Type>
              </View>
              {idAsset ? <Ionicons name="checkmark-circle" size={22} color={KOLA} /> : null}
            </Pressable>
            {attempted && missing.id ? <Missing text="Add a photo of your ID." /> : null}
          </Step>
        ) : (
          <Notice tone="success" title="Your ID is already on file" body="Danpa HQ checked your identity before, so there is nothing to upload here." />
        )}
      </Rise>

      <Rise index={5}>
        <Step number="+" optional title="Certificates (optional)" line="Any trade certificate you hold. It shows as “Certificate provided” until our team checks it, then as verified with the date.">
          {certificates.map((row, index) => (
            <View key={row.key} style={styles.certificate}>
              <View style={styles.certificateHead}>
                <Ionicons name="ribbon-outline" size={18} color={LAGOON} />
                <Type variant="captionStrong" numberOfLines={1} style={{ flex: 1 }}>{row.name}</Type>
                <Pressable
                  onPress={() => setCertificates((current) => current.filter((item) => item.key !== row.key))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove certificate ${index + 1}`}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={20} color={theme.color.ink["500"]} />
                </Pressable>
              </View>
              <Type variant="caption" style={{ color: theme.color.ink["500"] }}>Trade</Type>
              <View style={styles.chips}>
                {application.trade_options.map((option) => (
                  <Chip key={option.value} label={option.label} selected={row.trade === option.value} onPress={() => updateCertificate(row.key, { trade: option.value })} />
                ))}
              </View>
              <Field
                label="Issued by"
                value={row.issuingBody}
                onChangeText={(value) => updateCertificate(row.key, { issuingBody: value })}
                placeholder="For example, Energy Commission"
                error={attempted && !row.issuingBody.trim() ? "Say who issued it." : undefined}
              />
              <Field
                label="Expires (optional)"
                hint="YYYY-MM-DD, or blank if it does not expire"
                value={row.expiresOn}
                onChangeText={(value) => updateCertificate(row.key, { expiresOn: value.trim() })}
                error={attempted && row.expiresOn !== "" && !DATE.test(row.expiresOn) ? "Write the date as YYYY-MM-DD." : undefined}
              />
            </View>
          ))}
          {certificates.length < 6 ? (
            <Pressable
              onPress={() => void addCertificate()}
              accessibilityRole="button"
              {...pressableFeedback(alpha(LAGOON, 0.12))}
              style={styles.addCertificate}
            >
              <Ionicons name="add" size={18} color={LAGOON} />
              <Type variant="captionStrong" style={{ color: LAGOON }}>Add a certificate</Type>
            </Pressable>
          ) : null}
        </Step>
      </Rise>

      <View style={styles.terms}>
        <Ionicons name="wallet-outline" size={20} color={AMBER} />
        <Type variant="caption" style={{ flex: 1, color: theme.color.ink["700"] }}>
          Danpa HQ connects you with customers and keeps a record of each job. Customers pay you directly; Danpa HQ does not hold or move the money.
        </Type>
      </View>

      {error ? <Notice tone="error" title={error} /> : null}
      <AuthAction label="Send application" busyLabel={busy || "Sending…"} busy={Boolean(busy)} onPress={() => void submit()} />
      {attempted && !ready ? <Missing text="Some parts above still need you." /> : null}
    </>
  );
}

function Step({ number, title, line, optional = false, children }: {
  number: string;
  title: string;
  line: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.stepHead}>
        <View style={[styles.stepNumber, optional ? styles.stepNumberOptional : null]}>
          <Type variant="captionStrong" style={{ color: optional ? LAGOON : WHITE }}>{number}</Type>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Type variant="title2" accessibilityRole="header">{title}</Type>
          <Type variant="caption" style={{ color: theme.color.ink["500"] }}>{line}</Type>
        </View>
      </View>
      {children}
    </View>
  );
}

function Missing({ text }: { text: string }) {
  return <Type variant="captionStrong" accessibilityRole="alert" style={{ color: ALERT }}>{text}</Type>;
}

/** Districts, found by typing. The government's list is a few hundred short rows, loaded once. */
function DistrictPicker({ selected, onChange }: { selected: District[]; onChange: (next: District[]) => void }) {
  const [all, setAll] = useState<District[] | null>(null);
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    listDistricts().then(setAll).catch(() => setFailed(true));
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!all || needle.length < 2) return [];
    const chosen = new Set(selected.map((district) => district.id));
    return all
      .filter((district) => !chosen.has(district.id))
      .filter((district) => `${district.name} ${district.region_name}`.toLowerCase().includes(needle))
      .slice(0, 6);
  }, [all, query, selected]);

  return (
    <View style={{ gap: space[3] }}>
      {selected.length ? (
        <View style={styles.chips}>
          {selected.map((district) => (
            <Pressable
              key={district.id}
              onPress={() => onChange(selected.filter((row) => row.id !== district.id))}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${district.name}`}
              style={styles.place}
            >
              <Ionicons name="location-outline" size={14} color={theme.color.kola["800"]} />
              <Type variant="captionStrong" style={{ color: theme.color.kola["800"] }}>{district.name}</Type>
              <Ionicons name="close" size={14} color={theme.color.kola["800"]} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {failed ? <Notice tone="error" title="Could not load the list of districts. Go back and open this again." /> : null}
      {selected.length < MAX_DISTRICTS ? (
        <Field label="Add a district" value={query} onChangeText={setQuery} placeholder="For example Ayawaso or Kumasi" hint={`Up to ${MAX_DISTRICTS}`} />
      ) : null}
      {matches.length ? (
        <View style={styles.matches}>
          {matches.map((district, index) => (
            <Pressable
              key={district.id}
              onPress={() => { onChange([...selected, district]); setQuery(""); }}
              accessibilityRole="button"
              {...pressableFeedback(AMBER_WASH)}
              style={[styles.match, index ? styles.matchRule : null]}
            >
              <Type variant="body" style={{ flex: 1 }}>{district.name}</Type>
              <Type variant="caption" style={{ color: theme.color.ink["500"] }}>{district.region_name}</Type>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const RISE = 28;

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: ph.ground },
  hero: { paddingHorizontal: space[5], paddingBottom: RISE + space[6], backgroundColor: AMBER, overflow: "hidden" },
  heroMark: { position: "absolute", right: -30, bottom: -20, transform: [{ rotate: "-18deg" }] },
  inner: { width: "100%", maxWidth: 520, alignSelf: "center", gap: space[5] },
  crown: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: alpha(WHITE, 0.16), overflow: "hidden" },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: space[3], borderRadius: 999 },
  heroLine: { color: alpha(WHITE, 0.86), fontSize: 15, lineHeight: 21, maxWidth: 380 },
  panel: {
    flexGrow: 1,
    marginTop: -RISE,
    paddingTop: space[6],
    paddingHorizontal: space[5],
    borderTopLeftRadius: RISE,
    borderTopRightRadius: RISE,
    backgroundColor: ph.ground,
  },
  column: { width: "100%", maxWidth: 520, alignSelf: "center", gap: space[5] },
  card: { gap: space[4], padding: space[4], borderRadius: 20, borderWidth: 1, borderColor: alpha(DEEP, 0.08), backgroundColor: WHITE },
  sent: { alignItems: "center", gap: space[1], paddingBottom: space[2] },
  centerMuted: { textAlign: "center", color: theme.color.ink["500"] },
  stepHead: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  stepNumber: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: AMBER },
  stepNumberOptional: { backgroundColor: theme.color.lagoon["100"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  place: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: space[3],
    borderRadius: 999,
    backgroundColor: theme.color.kola["50"],
  },
  matches: { borderRadius: 14, borderWidth: 1, borderColor: alpha(DEEP, 0.08), backgroundColor: WHITE, overflow: "hidden" },
  match: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 48, paddingHorizontal: space[3] },
  matchRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: alpha(DEEP, 0.1) },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  photo: { width: 96, height: 96, borderRadius: 14, overflow: "hidden", backgroundColor: theme.color.field["100"] },
  photoRemove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: alpha(theme.color.ink["950"], 0.62),
  },
  photoAdd: {
    width: 96,
    height: 96,
    borderRadius: 14,
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: alpha(AMBER, 0.45),
    backgroundColor: alpha(AMBER_WASH, 0.6),
  },
  types: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
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
  typeOn: { borderColor: LAGOON, backgroundColor: theme.color.lagoon["100"] },
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
  dropFilled: { borderStyle: "solid", borderColor: alpha(KOLA, 0.35), backgroundColor: theme.color.kola["50"] },
  dropIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.lagoon["100"] },
  preview: { width: 64, height: 48, borderRadius: 10, backgroundColor: theme.color.field["100"] },
  certificate: { gap: space[3], padding: space[3], borderRadius: 16, backgroundColor: theme.color.field["50"], borderWidth: 1, borderColor: alpha(DEEP, 0.06) },
  certificateHead: { flexDirection: "row", alignItems: "center", gap: space[2] },
  addCertificate: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: space[2],
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: 999,
    backgroundColor: theme.color.lagoon["100"],
  },
  terms: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    padding: space[4],
    borderRadius: 16,
    backgroundColor: AMBER_WASH,
  },
});

