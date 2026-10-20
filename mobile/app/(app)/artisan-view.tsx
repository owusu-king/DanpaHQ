import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  CERTIFICATE_LABEL,
  getArtisan,
  inviteArtisan,
  suggestArtisan,
  type PublicArtisan,
} from "@/artisan";
import { Facts, shortDate } from "@/components/artisan/ArtisanChips";
import { Pill } from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * One artisan, as a customer reads them: a page of its own, pushed from Find
 * Artisans (owner, 2026-10-20), never a view inside a sheet.
 *
 * Opened from a repair (`request`, `mode`), it also offers the one act that
 * repair allows this reader: invite to quote, or — for a tenant — suggest to
 * the landlord. Inviting tells the artisan the area and the problem, never the
 * address; a suggestion tells only the people who run the property.
 */

const AMBER = theme.color.harmattan["600"];
const LAGOON = theme.color.lagoon["600"];
const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];
const MUTED = theme.color.ink["500"];

export default function ArtisanViewScreen() {
  const params = useLocalSearchParams<{ id: string; request?: string; mode?: string; label?: string }>();
  const pageBottom = useSafeBottom(space[10]);
  return (
    <ScrollView style={styles.ground} contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]} showsVerticalScrollIndicator={false}>
      <View style={styles.column}>
        <Profile
          id={params.id}
          forRequest={params.request && (params.mode === "invite" || params.mode === "suggest")
            ? { id: params.request, mode: params.mode, label: params.label ?? "" }
            : undefined}
        />
      </View>
    </ScrollView>
  );
}

type ForRequest = { id: string; mode: "invite" | "suggest"; label: string };

function Profile({ id, forRequest }: { id: string; forRequest?: ForRequest }) {
  const [artisan, setArtisan] = useState<PublicArtisan | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    getArtisan(id)
      .then((next) => { if (live) setArtisan(next); })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not open this artisan."); });
    return () => { live = false; };
  }, [id]);

  if (error) return <Notice tone="error" title={error} />;
  if (!artisan) return <ActivityIndicator color={AMBER} style={{ paddingVertical: space[8] }} />;

  return (
    <View style={{ gap: space[4] }}>
      <View style={styles.card}>
        <Type variant="title1" accessibilityRole="header">{artisan.name}</Type>
        <Type variant="body" style={{ color: theme.color.ink["700"] }}>{artisan.trades.map((trade) => trade.label).join(" · ")}</Type>
        <View style={styles.area}>
          <Ionicons name="location-outline" size={14} color={MUTED} />
          <Type variant="caption" style={{ color: MUTED, flexShrink: 1 }}>Works in {artisan.districts.map((district) => district.name).join(", ")}</Type>
        </View>
        <Facts artisan={artisan} />
        {forRequest && !artisan.is_you ? <AskAction artisanId={artisan.id} name={artisan.name} forRequest={forRequest} /> : null}
      </View>

      {artisan.portfolio.some((photo) => photo.url) ? (
        <View style={styles.gallery} accessibilityLabel="Their work">
          {artisan.portfolio.map((photo, index) =>
            photo.url ? <Image key={photo.id} source={{ uri: photo.url }} style={styles.photo} accessibilityLabel={`Work photo ${index + 1}`} /> : null,
          )}
        </View>
      ) : null}

      <View style={styles.card}>
        {artisan.bio ? (
          <View style={{ gap: space[1] }}>
            <Type variant="caption" style={{ color: MUTED }}>About</Type>
            <Type variant="body">{artisan.bio}</Type>
          </View>
        ) : null}
        <View style={{ gap: space[2] }}>
          <Type variant="caption" style={{ color: MUTED }}>Certificates</Type>
          {artisan.certificates.length ? artisan.certificates.map((certificate) => (
            <View key={certificate.id} style={styles.cert}>
              <View style={{ flex: 1, gap: 1 }}>
                <Type variant="captionStrong">{certificate.trade_label}</Type>
                <Type variant="caption" style={{ color: MUTED }}>
                  {certificate.issuing_body}
                  {certificate.expires_on ? ` · expires ${shortDate(certificate.expires_on)}` : ""}
                </Type>
              </View>
              <Type variant="captionStrong" style={{ color: certificate.status === "verified" ? theme.color.kola["800"] : certificate.status === "expired" ? MUTED : LAGOON, fontSize: 12 }}>
                {CERTIFICATE_LABEL[certificate.status]}
                {certificate.status === "verified" && certificate.verified_at ? ` ${shortDate(certificate.verified_at)}` : ""}
              </Type>
            </View>
          )) : <Type variant="caption" style={{ color: MUTED }}>None shown. Certificates are optional.</Type>}
        </View>
        <View style={{ gap: space[1] }}>
          <Type variant="caption" style={{ color: MUTED }}>Reviews</Type>
          <Type variant="caption" style={{ color: MUTED }}>No reviews yet. Reviews come from customers after a confirmed job.</Type>
        </View>
      </View>

      <Type variant="caption" style={styles.foot}>
        On Danpa HQ since {shortDate(artisan.member_since)}. Danpa HQ checks identity and certificates and keeps a record of each job; it does not guarantee anybody&apos;s work.
      </Type>
    </View>
  );
}

function AskAction({ artisanId, name, forRequest }: { artisanId: string; name: string; forRequest: ForRequest }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  const invite = forRequest.mode === "invite";

  async function ask() {
    setState("busy");
    setError("");
    try {
      if (invite) await inviteArtisan(forRequest.id, artisanId);
      else await suggestArtisan(forRequest.id, artisanId);
      setState("done");
    } catch (cause) {
      setState("idle");
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    }
  }

  if (state === "done") {
    return (
      <View style={styles.asked}>
        <Type variant="caption" style={{ color: theme.color.kola["800"] }}>
          {invite
            ? `${name} has been asked to quote. They see the area and the problem, not the address.`
            : `Suggested. Your landlord decides whether to ask ${name} to quote.`}
        </Type>
      </View>
    );
  }
  return (
    <View style={{ gap: space[2], marginTop: space[2] }}>
      <Pill
        icon={invite ? "paper-plane-outline" : "chatbubble-outline"}
        label={invite ? `Invite to quote for ${forRequest.label}` : "Suggest to your landlord"}
        busy={state === "busy"}
        busyLabel="Sending…"
        onPress={() => void ask()}
      />
      {error ? <Notice tone="error" title={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: theme.color.field["50"] },
  page: { paddingTop: space[4], paddingHorizontal: space[4] },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", gap: space[4] },
  card: {
    gap: space[3],
    padding: space[4],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.08),
    backgroundColor: WHITE,
  },
  area: { flexDirection: "row", alignItems: "center", gap: 4 },
  gallery: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  photo: { width: 104, height: 104, borderRadius: 14, backgroundColor: theme.color.field["100"] },
  cert: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: 14, backgroundColor: alpha(DEEP, 0.03) },
  foot: { color: MUTED, textAlign: "center", paddingHorizontal: space[2] },
  asked: { marginTop: space[2], padding: space[3], borderRadius: 14, backgroundColor: theme.color.kola["50"] },
});
