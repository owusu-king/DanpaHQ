import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { ClipPlayer } from "@/components/maintenance/MaintenanceParts";
import { ClipTrimmer } from "@/components/maintenance/ClipTrimmer";
import { LoadingRows } from "@/components/property/WorkspacePatterns";
import { ActionBar, GroupLabel, Pill, QuietAct } from "@/components/record/RecordSurfaces";
import { Field, Notice, Type, space } from "@/components/ui";
import { CATEGORIES, MAX_CLIP_MS, seconds, submitMaintenanceRequest, type MaintenanceCategory } from "@/maintenance";
import { isIOS, pressableFeedback, useSafeBottom } from "@/platform";
import { uploadImage } from "@/provider";
import { listMyTenancies, type Tenancy } from "@/tenancy";
import { theme } from "@/theme";

type Clip = {
  asset: ImagePicker.ImagePickerAsset;
  durationMs: number;
  /** Set when the file is longer than the clip: the five seconds to play. */
  window: { startMs: number; endMs: number } | null;
};

/** The server's cap on a video upload (`apps.files.validation`). */
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

/**
 * Reporting a problem: which home, what kind, what is wrong, one photograph, and
 * — if it helps — up to five seconds of video.
 *
 * A screen of its own rather than a sheet, because it opens the camera twice and
 * a sheet would close under it. The photograph is required and says so; the
 * clip is optional and says that too. A video the phone recorded or chose that
 * runs longer than five seconds goes to the trimmer in place of the clip field.
 *
 * Files go through the app's one upload path (`uploadImage`): reserved, sent
 * straight to storage, then checked for what they really are before the request
 * may point at them.
 */
export default function MaintenanceReportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tenancy?: string }>();
  const [tenancies, setTenancies] = useState<Tenancy[] | null>(null);
  const [tenancyId, setTenancyId] = useState("");
  const [category, setCategory] = useState<MaintenanceCategory | null>(null);
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [trimming, setTrimming] = useState<Clip | null>(null);
  const [stage, setStage] = useState<"" | "photo" | "clip" | "sending">("");
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  // While trimming, the trimmer's own two buttons are the only acts on screen.
  const openBottom = useSafeBottom(space[10]);

  useEffect(() => {
    listMyTenancies()
      .then((rows) => {
        const active = rows.filter((row) => row.status === "active");
        setTenancies(active);
        setTenancyId(active.find((row) => row.id === params.tenancy)?.id ?? active[0]?.id ?? "");
      })
      .catch((cause) => {
        setTenancies([]);
        setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your homes.");
      });
  }, [params.tenancy]);

  const missing = { category: !category, description: description.trim().length < 10, photo: !photo };
  const busy = Boolean(stage);

  async function takePhoto(source: "camera" | "library") {
    setError("");
    if (source === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
      setError("Allow camera access in Settings to take a photo, or choose one instead.");
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8 };
    const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0]);
  }

  async function takeVideo(source: "camera" | "library") {
    setError("");
    if (source === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
      setError("Allow camera access in Settings to record a clip, or choose a video instead.");
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["videos"],
      videoMaxDuration: MAX_CLIP_MS / 1000,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      // iOS opens its own trimmer, held to five seconds, for a longer library video.
      allowsEditing: source === "library" && isIOS,
    };
    const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = !result.canceled ? result.assets[0] : null;
    if (!asset) return;
    if ((asset.fileSize ?? 0) > MAX_VIDEO_BYTES) {
      setError(`That video is ${Math.round((asset.fileSize ?? 0) / 1048576)}MB; the limit is 30MB. Record a short clip instead.`);
      return;
    }
    const durationMs = Math.round(asset.duration ?? 0);
    const next: Clip = { asset, durationMs, window: null };
    // Some Android camera apps ignore the five-second limit; any longer video is
    // trimmed here, whichever way it arrived.
    if (durationMs > MAX_CLIP_MS) setTrimming(next);
    else setClip(next);
  }

  async function send() {
    setAttempted(true);
    if (!tenancyId || !category || !photo || missing.description) return;
    setError("");
    try {
      setStage("photo");
      const storedPhoto = await uploadImage(photo, "maintenance_photo");
      if (!storedPhoto.is_usable) throw new Error(storedPhoto.rejection_reason || storedPhoto.status_message || "The photo is still being checked. Try again in a moment.");
      let videoId: string | null = null;
      if (clip) {
        setStage("clip");
        const storedClip = await uploadImage(clip.asset, "maintenance_video");
        if (!storedClip.is_usable) throw new Error(storedClip.rejection_reason || storedClip.status_message || "The clip is still being checked. Try again in a moment.");
        videoId = storedClip.id;
      }
      setStage("sending");
      const created = await submitMaintenanceRequest({
        tenancy_id: tenancyId,
        category,
        description: description.trim(),
        photo_file_id: storedPhoto.id,
        video_file_id: videoId,
        video_duration_ms: clip ? clip.durationMs : null,
        video_clip_start_ms: clip?.window?.startMs ?? null,
        video_clip_end_ms: clip?.window?.endMs ?? null,
      });
      // The record replaces the form, so Back returns to the list, not a sent form.
      router.replace({ pathname: "/(app)/maintenance-request", params: { id: created.id } } as never);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : cause instanceof Error ? cause.message : "Your report did not send. Try again.");
    } finally {
      setStage("");
    }
  }

  if (tenancies === null) return <View style={styles.page}><LoadingRows rows={4} /></View>;
  if (!tenancies.length) {
    return (
      <View style={styles.page}>
        <Notice tone="info" title="No active tenancy" body={error || "Once your tenancy is active you can report problems here."} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.page, { paddingBottom: trimming ? openBottom : space[8] }]} keyboardShouldPersistTaps="handled">
        {tenancies.length > 1 ? (
          <View style={styles.section}>
            <GroupLabel>Which home?</GroupLabel>
            <View style={styles.wrap}>
              {tenancies.map((row) => (
                <Option key={row.id} icon="home-outline" label={row.space.unit_label} detail={row.property.title} selected={tenancyId === row.id} onPress={() => setTenancyId(row.id)} />
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.home}>
            <Ionicons name="home-outline" size={18} color={theme.color.kola["600"]} />
            <View style={{ flex: 1 }}>
              <Type variant="bodyStrong">{tenancies[0]!.space.unit_label}</Type>
              <Type variant="caption" style={styles.muted}>{tenancies[0]!.property.title}</Type>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <GroupLabel>What kind of problem?</GroupLabel>
          <View style={styles.grid}>
            {CATEGORIES.map((option) => (
              <Option key={option.value} icon={option.icon} label={option.label} selected={category === option.value} onPress={() => setCategory(option.value)} />
            ))}
          </View>
          {attempted && missing.category ? <Type variant="caption" style={styles.error}>Choose what kind of problem it is.</Type> : null}
        </View>

        <Field
          label="What is wrong?"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={2000}
          placeholder="Where it is, what happens, and since when."
          error={attempted && missing.description ? "Describe it in a sentence or two." : undefined}
          style={styles.description}
        />

        <View style={styles.section}>
          <GroupLabel>Photo · required, one</GroupLabel>
          {photo ? (
            <View>
              <Image source={{ uri: photo.uri }} style={styles.preview} accessibilityLabel="The photo you chose" />
              <Remove label="Remove photo" disabled={busy} onPress={() => setPhoto(null)} />
            </View>
          ) : (
            <View style={styles.pickRow}>
              <PickTile icon="camera-outline" label="Take a photo" detail="Uses your camera" onPress={() => void takePhoto("camera")} />
              <PickTile icon="images-outline" label="Choose a photo" detail="From your library" onPress={() => void takePhoto("library")} />
            </View>
          )}
          {attempted && missing.photo ? <Type variant="caption" style={styles.error}>Add one photo of the problem.</Type> : null}
        </View>

        <View style={styles.section}>
          <GroupLabel>Video · optional, up to 5 seconds</GroupLabel>
          {trimming ? (
            <ClipTrimmer
              uri={trimming.asset.uri}
              durationMs={trimming.durationMs}
              onCancel={() => setTrimming(null)}
              onDone={(window) => { setClip({ ...trimming, window }); setTrimming(null); }}
            />
          ) : clip ? (
            <View>
              <ClipPlayer uri={clip.asset.uri} startMs={clip.window?.startMs ?? null} endMs={clip.window?.endMs ?? null} />
              <View style={styles.badge}><Type variant="captionStrong" style={{ color: "#fff" }}>{seconds(clip.window ? clip.window.endMs - clip.window.startMs : clip.durationMs)}s</Type></View>
              <Remove label="Remove clip" disabled={busy} onPress={() => setClip(null)} />
            </View>
          ) : (
            <View style={styles.pickRow}>
              <PickTile icon="videocam-outline" label="Record a clip" detail="Stops at 5 seconds" onPress={() => void takeVideo("camera")} />
              <PickTile icon="film-outline" label="Choose a video" detail="Longer ones are trimmed" onPress={() => void takeVideo("library")} />
            </View>
          )}
        </View>

        {error ? <Notice tone="error" title={error} /> : null}
      </ScrollView>

      {trimming ? null : (
      <ActionBar note="Your landlord is told as soon as you send it.">
        <Pill
          grow
          icon="send-outline"
          label="Send report"
          busy={busy}
          busyLabel={{ photo: "Uploading photo…", clip: "Uploading clip…", sending: "Sending…", "": "" }[stage]}
          onPress={() => void send()}
        />
        <QuietAct label="Cancel" disabled={busy} onPress={() => router.back()} />
      </ActionBar>
      )}
    </View>
  );
}

function Option({ icon, label, detail, selected, onPress }: { icon: string; label: string; detail?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      {...pressableFeedback(theme.color.field["100"])}
      style={({ pressed }) => [styles.option, selected ? styles.optionOn : null, pressed ? { opacity: 0.85 } : null]}
    >
      <Ionicons name={icon as never} size={18} color={selected ? theme.color.kola["800"] : theme.color.ink["500"]} />
      <View style={{ flexShrink: 1 }}>
        <Type variant="captionStrong" numberOfLines={2} style={{ color: selected ? theme.color.kola["800"] : theme.color.ink["900"] }}>{label}</Type>
        {detail ? <Type variant="caption" numberOfLines={1} style={styles.muted}>{detail}</Type> : null}
      </View>
    </Pressable>
  );
}

function PickTile({ icon, label, detail, onPress }: { icon: string; label: string; detail: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${detail}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.pick, pressed ? { opacity: 0.85 } : null]}
    >
      <Ionicons name={icon as never} size={22} color={theme.color.kola["600"]} />
      <Type variant="bodyStrong" style={{ color: theme.color.ink["900"] }}>{label}</Type>
      <Type variant="caption" style={styles.muted}>{detail}</Type>
    </Pressable>
  );
}

function Remove({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={8} style={styles.remove}>
      <Ionicons name="close" size={16} color={theme.color.ink["900"]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { padding: space[4], paddingBottom: space[8], gap: space[5] },
  section: { gap: space[2] },
  muted: { color: theme.color.ink["500"] },
  error: { color: theme.color.laterite["600"] },
  home: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    borderRadius: 16,
    backgroundColor: theme.color.field["0"],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.field["200"],
  },
  wrap: { gap: space[2] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    flexBasis: "48%",
    flexGrow: 1,
    minHeight: 52,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: 14,
    backgroundColor: theme.color.field["0"],
    borderWidth: 1,
    borderColor: theme.color.field["200"],
  },
  optionOn: { backgroundColor: theme.color.kola["50"], borderColor: theme.color.kola["600"] },
  description: { minHeight: 104, textAlignVertical: "top" },
  pickRow: { flexDirection: "row", gap: space[2] },
  pick: {
    flex: 1,
    gap: 2,
    padding: space[3],
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: theme.color.kola["600"] + "55",
    backgroundColor: theme.color.kola["50"],
  },
  preview: { width: "100%", height: 200, borderRadius: 16, backgroundColor: theme.color.field["100"] },
  remove: {
    position: "absolute",
    top: space[2],
    right: space[2],
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  badge: {
    position: "absolute",
    top: space[2],
    left: space[2],
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(15,24,20,0.62)",
  },
});
