import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";

import { ArtisanProfile } from "@/components/artisan/ArtisanProfile";
import { space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { theme } from "@/theme";

export default function ArtisanViewScreen() {
  const params = useLocalSearchParams<{ id: string; request?: string; kind?: string; mode?: string; label?: string }>();
  const pageBottom = useSafeBottom(space[10]);
  return (
    <ScrollView style={styles.ground} contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]} showsVerticalScrollIndicator={false}>
      <View style={styles.column}>
        <ArtisanProfile
          id={params.id}
          forRequest={params.request && (params.mode === "invite" || params.mode === "suggest")
            ? {
              id: params.request,
              kind: params.kind === "direct_job" ? "direct_job" : "maintenance",
              mode: params.mode,
              label: params.label ?? "",
            }
            : undefined}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: theme.color.field["50"] },
  page: { paddingTop: space[4], paddingHorizontal: space[4] },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", gap: space[4] },
});
