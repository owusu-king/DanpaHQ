import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { TRADES, postDirectJob } from "@/artisan";
import { AuthAction } from "@/components/auth/AuthScene";
import { GroupLabel, RecordPanel } from "@/components/record/RecordSurfaces";
import { Chip, Field, Notice, Type, space } from "@/components/ui";
import { searchLocalities, type Locality } from "@/listings";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { uploadImage } from "@/provider";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * Post a job: work somebody hires an artisan for themselves — a wardrobe to
 * assemble, a room to paint — with no property or repair behind it. Pushed
 * from Find Artisans' Requests; on success it gives way to the job's own page.
 *
 * Artisans asked to quote read the job and the area. The address fields here
 * open only to the one whose price the poster approves.
 */

const AMBER = theme.color.harmattan["600"];
const AMBER_WASH = theme.color.harmattan["100"];
const LAGOON = theme.color.lagoon["600"];
const LAGOON_WASH = theme.color.lagoon["100"];
const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];
const ALERT = theme.color.laterite["600"];

export default function PostDirectJobScreen() {
  const router = useRouter();
  const pageBottom = useSafeBottom(space[10]);
  const [trade, setTrade] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [locality, setLocality] = useState<Locality | null>(null);
  const [houseNumber, setHouseNumber] = useState("");
  const [street, setStreet] = useState("");
  const [landmark, setLandmark] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const missing = {
    trade: !trade,
    title: title.trim().length < 3,
    description: description.trim().length < 10,
    locality: !locality,
  };
  const ready = !Object.values(missing).some(Boolean);

  async function pick() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!picked.canceled && picked.assets[0]) setPhoto(picked.assets[0]);
  }

  async function submit() {
    setAttempted(true);
    if (!ready || !locality) return;
    setError("");
    try {
      let photoId: string | null = null;
      if (photo) {
        setBusy("Uploading the photo…");
        photoId = (await uploadImage(photo, "artisan_job_photo")).id;
      }
      setBusy("Posting…");
      const posted = await postDirectJob({
        trade,
        title: title.trim(),
        description: description.trim(),
        locality_id: locality.id,
        photo_file_id: photoId,
        house_number: houseNumber.trim(),
        street: street.trim(),
        landmark: landmark.trim(),
      });
      // The form gives way to the job it made: Back returns to Find Artisans.
      router.replace({ pathname: "/(app)/direct-job", params: { id: posted.job.id } } as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : cause instanceof Error ? cause.message : "Could not post the job.");
    } finally {
      setBusy("");
    }
  }

  return (
    <ScrollView
      style={styles.ground}
      contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.column}>
        {error ? <Notice tone="error" title={error} /> : null}

        <View style={{ gap: space[2] }}>
          <GroupLabel>What needs doing</GroupLabel>
          <RecordPanel style={styles.panel}>
            <View style={styles.trades}>
              {TRADES.map((option) => (
                <Chip key={option.value} label={option.label} selected={trade === option.value} onPress={() => setTrade(option.value)} />
              ))}
            </View>
            {attempted && missing.trade ? <Missing text="Choose a trade." /> : null}
            <Field
              label="Title"
              value={title}
              onChangeText={setTitle}
              maxLength={120}
              placeholder="For example, assemble a wardrobe"
              error={attempted && missing.title ? "Give the job a short title." : undefined}
            />
            <Field
              label="Details"
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={2000}
              placeholder="Sizes, materials you have, when it suits you."
              style={{ minHeight: 88, textAlignVertical: "top" }}
              error={attempted && missing.description ? "Say in a sentence or two what needs doing." : undefined}
            />
            <View style={styles.photoRow}>
              {photo ? (
                <View style={styles.photo}>
                  <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} accessibilityLabel="The job" />
                  <Pressable
                    onPress={() => setPhoto(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Remove the photo"
                    hitSlop={6}
                    style={styles.photoRemove}
                  >
                    <Ionicons name="close" size={14} color={WHITE} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => void pick()}
                  accessibilityRole="button"
                  accessibilityLabel="Add a photo"
                  {...pressableFeedback(alpha(AMBER, 0.12))}
                  style={styles.photoAdd}
                >
                  <Ionicons name="image-outline" size={22} color={AMBER} />
                  <Type variant="captionStrong" style={{ color: AMBER }}>Add a photo</Type>
                </Pressable>
              )}
              <Type variant="caption" style={{ flex: 1, color: theme.color.ink["500"] }}>
                A photo is optional, and helps a fair price.
              </Type>
            </View>
          </RecordPanel>
        </View>

        <View style={{ gap: space[2] }}>
          <GroupLabel>Where</GroupLabel>
          <RecordPanel style={styles.panel}>
            <LocalityPicker selected={locality} onChange={setLocality} />
            {attempted && missing.locality ? <Missing text="Choose the area." /> : null}
            <View style={styles.pair}>
              <View style={{ width: 112 }}>
                <Field label="House no." value={houseNumber} onChangeText={setHouseNumber} maxLength={32} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Street" value={street} onChangeText={setStreet} maxLength={160} />
              </View>
            </View>
            <Field label="Landmark" value={landmark} onChangeText={setLandmark} maxLength={200} placeholder="Blue gate opposite the pharmacy" />
            <View style={styles.private}>
              <Ionicons name="lock-closed-outline" size={15} color={LAGOON} />
              <Type variant="caption" style={{ flex: 1, color: theme.color.ink["700"] }}>
                Artisans you ask see the area only. The address and your phone open to the one you approve.
              </Type>
            </View>
          </RecordPanel>
        </View>

        <AuthAction label="Post the job" busyLabel={busy || "Posting…"} busy={Boolean(busy)} onPress={() => void submit()} />
        {attempted && !ready ? <Missing text="Some parts above still need you." /> : null}
      </View>
    </ScrollView>
  );
}

function Missing({ text }: { text: string }) {
  return <Type variant="captionStrong" accessibilityRole="alert" style={{ color: ALERT }}>{text}</Type>;
}

/** A neighbourhood, found by typing: the same search the listings use. */
function LocalityPicker({ selected, onChange }: { selected: Locality | null; onChange: (next: Locality | null) => void }) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{ query: string; rows: Locality[] }>({ query: "", rows: [] });
  const asked = useRef(0);

  const needle = query.trim();
  useEffect(() => {
    if (needle.length < 2) return;
    const turn = ++asked.current;
    const timer = setTimeout(() => {
      searchLocalities(needle)
        .then((rows) => { if (turn === asked.current) setAnswer({ query: needle, rows: rows.slice(0, 6) }); })
        .catch(() => { if (turn === asked.current) setAnswer({ query: needle, rows: [] }); });
    }, 200);
    return () => clearTimeout(timer);
  }, [needle]);

  if (selected) {
    return (
      <Pressable
        onPress={() => onChange(null)}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${selected.name}`}
        style={styles.place}
      >
        <Ionicons name="location-outline" size={14} color={theme.color.kola["800"]} />
        <Type variant="captionStrong" style={{ color: theme.color.kola["800"] }}>
          {selected.name}, {selected.district_name}
        </Type>
        <Ionicons name="close" size={14} color={theme.color.kola["800"]} />
      </Pressable>
    );
  }
  const matches = needle.length >= 2 && answer.query === needle ? answer.rows : [];
  return (
    <View style={{ gap: space[2] }}>
      <Field label="Area" value={query} onChangeText={setQuery} placeholder="Type a neighbourhood, for example Osu" />
      {matches.length ? (
        <View style={styles.matches}>
          {matches.map((row, index) => (
            <Pressable
              key={row.id}
              onPress={() => { onChange(row); setQuery(""); }}
              accessibilityRole="button"
              {...pressableFeedback(AMBER_WASH)}
              style={[styles.match, index ? styles.matchRule : null]}
            >
              <Type variant="body" style={{ flex: 1 }}>{row.name}</Type>
              <Type variant="caption" style={{ color: theme.color.ink["500"] }}>{row.district_name}</Type>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: theme.color.field["50"] },
  page: { paddingTop: space[4], paddingHorizontal: space[4] },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", gap: space[5] },
  panel: { gap: space[3], padding: space[4] },
  trades: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  photoRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  photo: { width: 88, height: 88, borderRadius: 14, overflow: "hidden", backgroundColor: theme.color.field["100"] },
  photoRemove: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: alpha(DEEP, 0.6),
  },
  photoAdd: {
    width: 88,
    height: 88,
    gap: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: alpha(AMBER, 0.45),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AMBER_WASH,
  },
  pair: { flexDirection: "row", gap: space[3] },
  private: { flexDirection: "row", alignItems: "flex-start", gap: space[2], padding: space[3], borderRadius: 12, backgroundColor: LAGOON_WASH },
  place: {
    flexDirection: "row",
    alignSelf: "flex-start",
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
});
