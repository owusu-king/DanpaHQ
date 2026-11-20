import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Type, space } from "@/components/ui";
import type { WalkthroughVideo } from "@/propertyVideo";
import { theme } from "@/theme";
import { VideoPlayer } from "./WalkthroughVideo";

export function MediaGallery({ photos, empty, videos }: {
  photos: ReactNode;
  empty: ReactNode;
  videos: { label: string; video?: WalkthroughVideo | null }[];
}) {
  const [selected, setSelected] = useState("Photos");
  const available = videos.filter(({ video }) => Boolean(video?.url));
  const choices = [...(photos ? ["Photos"] : []), ...available.map(({ label }) => label)];
  const active = choices.includes(selected) ? selected : choices[0];
  const video = available.find(({ label }) => label === active);

  return (
    <View style={styles.gallery}>
      {choices.length > 1 ? (
        <View style={styles.controls} accessibilityRole="radiogroup" accessibilityLabel="Gallery media">
          {choices.map((label) => (
            <Pressable key={label} accessibilityRole="radio" aria-checked={active === label}
              onPress={() => setSelected(label)}
              style={({ pressed }) => [styles.choice, active === label && styles.selected, pressed && { opacity: 0.8 }]}>
              <Type variant="captionStrong" style={active === label ? styles.selectedLabel : undefined}>{label}</Type>
            </Pressable>
          ))}
        </View>
      ) : null}
      {video ? <VideoPlayer video={video.video} label={video.label} caption={choices.length === 1} />
        : photos || empty}
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { gap: space[2], minWidth: 0 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: space[1], paddingHorizontal: space[1] },
  choice: { minHeight: 44, justifyContent: "center", paddingHorizontal: space[3], borderRadius: 8 },
  selected: { backgroundColor: theme.color.kola["50"] },
  selectedLabel: { color: theme.color.kola["800"] },
});
