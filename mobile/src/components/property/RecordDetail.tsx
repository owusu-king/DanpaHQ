import { Image, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import type { ReactNode as Content } from "react";
import { Type, space } from "@/components/ui";
import { theme } from "@/theme";

export function RecordHeader({ title, context, status }: { title: string; context: string; status: Content }) {
  return <View style={styles.header}>
    <Type variant="title2" accessibilityRole="header" style={styles.title}>{title}</Type>
    <Type variant="caption" style={styles.context}>{context}</Type>
    <View style={styles.statuses}>{status}</View>
  </View>;
}

export function RecordHero({ photo, title, onPhotoPress, children }: { photo?: string | null; title: string; onPhotoPress?: () => void; children: Content }) {
  const { width } = useWindowDimensions();
  const media = photo ? <Image source={{ uri: photo }} accessibilityLabel={title} style={styles.image} resizeMode="cover" /> : <View style={styles.empty}><Type variant="caption">No photo on file</Type></View>;
  return <View style={[styles.hero, width >= 700 && styles.heroWide]}>
    {onPhotoPress ? <Pressable onPress={onPhotoPress} accessibilityRole="button" accessibilityLabel={`View photos of ${title}`} style={[styles.media, width >= 700 && styles.mediaWide]}>{media}</Pressable> : <View style={[styles.media, width >= 700 && styles.mediaWide]}>{media}</View>}
    <View style={[styles.actions, width >= 700 && { flex: 1 }]}>{children}</View>
  </View>;
}

export function RecordSection({ title, children }: { title: string; children: Content }) {
  return <View style={styles.section}><Type variant="bodyStrong" accessibilityRole="header">{title}</Type>{children}</View>;
}

export function RecordFacts({ rows }: { rows: { label: string; value: string }[] }) {
  return <View style={styles.facts}>{rows.map((row) => <View key={row.label} style={styles.fact} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
    <Type variant="caption" style={styles.context}>{row.label}</Type><Type variant="captionStrong">{row.value}</Type>
  </View>)}</View>;
}

export function RecordUnitRow({ title, meta, photo, status, onPress }: { title: string; meta: string; photo?: string | null; status: Content; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.unitRow, pressed && { opacity: 0.7 }]}>
    {photo ? <Image source={{ uri: photo }} style={styles.unitThumb} /> : <View style={styles.unitThumb} />}
    <View style={styles.unitCopy}><Type variant="bodyStrong">{title}</Type><Type variant="caption" style={styles.context}>{meta}</Type></View>
    <View style={styles.unitStatus}>{status}</View>
  </Pressable>;
}

const styles = StyleSheet.create({
  header: { gap: 6 }, title: { fontSize: 21, lineHeight: 27, color: theme.color.ink["900"] },
  context: { color: theme.color.ink["500"] }, statuses: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  hero: { gap: 12, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.field["200"] },
  heroWide: { flexDirection: "row", alignItems: "flex-start", gap: 20 },
  media: { height: 180, overflow: "hidden", borderRadius: 8, backgroundColor: theme.color.field["100"] },
  mediaWide: { width: 280, height: 210 }, image: { width: "100%", height: "100%" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center" }, actions: { minWidth: 0, gap: 10 },
  section: { gap: 10, padding: space[3], borderWidth: StyleSheet.hairlineWidth, borderColor: theme.color.field["200"], borderRadius: 8, backgroundColor: theme.color.field["0"] },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, fact: { flexGrow: 1, flexBasis: 130, gap: 3 },
  unitRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.field["200"] },
  unitThumb: { width: 52, height: 46, borderRadius: 5, backgroundColor: theme.color.field["100"] },
  unitCopy: { flex: 1, minWidth: 0, gap: 3 }, unitStatus: { maxWidth: 120, flexShrink: 1 },
});
