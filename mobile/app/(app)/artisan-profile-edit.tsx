import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { getMyArtisanApplication, type ArtisanApplication } from "@/artisan";
import { ArtisanApplicationForm } from "@/components/artisan/ArtisanApplicationForm";
import { Notice, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { theme } from "@/theme";

/**
 * An approved artisan keeping their profile current: trades, area, work
 * photos, certificates. No new review — approval was about the person — and a
 * new certificate reads "Certificate provided" until Danpa HQ checks it.
 */
export default function ArtisanProfileEditScreen() {
  const router = useRouter();
  const pageBottom = useSafeBottom(space[10]);
  const [application, setApplication] = useState<ArtisanApplication | null>(null);
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      let live = true;
      getMyArtisanApplication()
        .then((next) => { if (live) setApplication(next); })
        .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your profile."); });
      return () => { live = false; };
    }, []),
  );

  return (
    <ScrollView
      style={styles.ground}
      contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.column}>
        {error ? <Notice tone="error" title={error} /> : null}
        {application ? (
          <ArtisanApplicationForm application={application} mode="edit" onSent={() => router.back()} />
        ) : error ? null : (
          <ActivityIndicator color={theme.color.harmattan["600"]} style={{ paddingVertical: space[10] }} />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: theme.color.field["50"] },
  page: { paddingTop: space[4], paddingHorizontal: space[4] },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", gap: space[5] },
});
