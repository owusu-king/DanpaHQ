import * as ImagePicker from "expo-image-picker";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { apiFetch, ApiFailure } from "@/api";
import { Button, Notice, Type, space } from "@/components/ui";
import { prepareVideo, videoPath, videoUpload, type VideoSubject, type WalkthroughVideo } from "@/propertyVideo";

function Playback({ uri, label }: { uri: string; label: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} nativeControls contentFit="contain" accessibilityLabel={label} style={{ width: "100%", height: 230, backgroundColor: "#17291f", borderRadius: 8 }} />;
}
export function VideoPlayer({ video, label = "Video", caption = false }: { video?: WalkthroughVideo | null; label?: string; caption?: boolean }) {
  if (!video) return null;
  const player = <Playback key={video.url} uri={video.url} label={label} />;
  return caption ? <View style={{ gap: space[2] }}><Type variant="caption">{label}</Type>{player}</View> : player;
}

export function WalkthroughUpload({ subject, id, editable, onBusy }: { subject: VideoSubject; id: string; editable: boolean; onBusy?: (busy: boolean) => void }) {
  const [saved, setSaved] = useState<WalkthroughVideo | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAvailable, setRetryAvailable] = useState(false);
  const retry = useRef<(() => Promise<string>) | null>(null);
  const running = useRef(false);
  const version = useRef(0);
  useEffect(() => { let live = true; const requestedVersion = version.current; apiFetch<WalkthroughVideo | null>(videoPath(subject, id)).then(video => { if (live && version.current === requestedVersion) setSaved(video); }).catch(() => { if (live && version.current === requestedVersion) setError("Could not load the video."); }); return () => { live = false; }; }, [id, subject]);
  async function act(run: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); onBusy?.(true); setError("");
    try { await run(); } catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : cause instanceof Error ? cause.message : "Video upload failed. Try again."); }
    finally { running.current = false; setBusy(false); onBusy?.(false); }
  }
  async function save() {
    const fileId = await retry.current!();
    const next = await apiFetch<WalkthroughVideo>(videoPath(subject, id), { method: "PUT", body: { file_id: fileId } });
    version.current++; setSaved(next); setPreview(""); retry.current = null; setRetryAvailable(false);
  }
  async function choose() {
    await act(async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error("Allow video access in Settings to choose a video.");
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium, videoMaxDuration: 10 });
      if (picked.canceled || !picked.assets[0]) return;
      const prepared = await prepareVideo(picked.assets[0]);
      setPreview(prepared.uri); retry.current = videoUpload(prepared, subject); setRetryAvailable(true);
      await save();
    });
  }
  if (!editable && !saved && !preview && !error) return null;
  return <View style={{ gap: space[2] }}>
    <Type variant="bodyStrong">Video (optional)</Type>
    <Type variant="caption">Up to 10 seconds · 30MB · MP4, MOV or WebM</Type>
    {preview ? <Playback uri={preview} label="Video preview" /> : <VideoPlayer video={saved} label={`${subject === "property" ? "Property" : "Unit"} video`} />}
    {error ? <Notice tone="error" title={error} /> : null}
    {editable ? <View style={{ gap: space[2] }}>
      <Button variant="secondary" label={preview || saved ? "Replace video" : "Add video"} disabled={busy} busy={busy} onPress={() => void choose()} />
      {error && retryAvailable ? <Button variant="secondary" label="Retry" disabled={busy} onPress={() => void act(save)} /> : null}
      {preview || saved ? <Button variant="quiet" label="Remove video" disabled={busy} onPress={() => void act(async () => { await apiFetch(videoPath(subject, id), { method: "DELETE" }); version.current++; setSaved(null); setPreview(""); retry.current = null; setRetryAvailable(false); })} /> : null}
    </View> : null}
  </View>;
}
