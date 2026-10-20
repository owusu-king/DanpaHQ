import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, StyleSheet, View } from "react-native";

import { CERTIFICATE_LABEL, type ArtisanCertificate, type TradeOption } from "@/artisan";
import { Type, space } from "@/components/ui";
import { alpha } from "@/shell";
import { theme } from "@/theme";

const AMBER = theme.color.harmattan["600"];
const AMBER_WASH = theme.color.harmattan["100"];
const KOLA = theme.color.kola["800"];
const KOLA_WASH = theme.color.kola["50"];
const DEEP = theme.color.kola["900"];

function shortDate(value: string): string {
  const iso = value.length === 10 ? `${value}T12:00:00` : value;
  return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * An artisan's profile as plain facts: trades, area, their own words, photos of
 * their work and each certificate with its status. No score, no ranking — the
 * reader decides what the facts mean. Mirrors web's `ArtisanFacts`.
 */
/** What the facts need: an artisan's own profile and a public one both have it. */
export type FactsProfile = {
  trades: TradeOption[];
  districts: { id: string; name: string }[];
  bio: string;
  portfolio: { id: string; url: string | null }[];
  certificates: Pick<ArtisanCertificate, "id" | "trade_label" | "issuing_body" | "expires_on" | "status">[];
};

export function ArtisanFacts({ profile }: { profile: FactsProfile }) {
  return (
    <View style={styles.facts}>
      <Fact label="Trades">
        <View style={styles.tags}>
          {profile.trades.map((trade) => (
            <View key={trade.value} style={[styles.tag, { backgroundColor: AMBER_WASH }]}>
              <Type variant="captionStrong" style={{ color: AMBER }}>{trade.label}</Type>
            </View>
          ))}
        </View>
      </Fact>
      <Fact label="Area">
        <View style={styles.tags}>
          {profile.districts.map((district) => (
            <View key={district.id} style={[styles.tag, { backgroundColor: KOLA_WASH }]}>
              <Ionicons name="location-outline" size={13} color={KOLA} />
              <Type variant="captionStrong" style={{ color: KOLA }}>{district.name}</Type>
            </View>
          ))}
        </View>
      </Fact>
      {profile.bio ? (
        <Fact label="About">
          <Type variant="body" style={{ color: theme.color.ink["700"] }}>{profile.bio}</Type>
        </Fact>
      ) : null}
      {profile.portfolio.some((photo) => photo.url) ? (
        <Fact label="Work">
          <View style={styles.gallery}>
            {profile.portfolio.map((photo, index) =>
              photo.url ? (
                <Image
                  key={photo.id}
                  source={{ uri: photo.url }}
                  style={styles.photo}
                  accessibilityLabel={`Work photo ${index + 1}`}
                />
              ) : null,
            )}
          </View>
        </Fact>
      ) : null}
      <Fact label="Certificates">
        {profile.certificates.length ? (
          <View style={{ gap: space[2] }}>
            {profile.certificates.map((certificate) => (
              <View key={certificate.id} style={styles.cert}>
                <Ionicons name="ribbon-outline" size={18} color={theme.color.lagoon["600"]} />
                <View style={{ flex: 1, gap: 1 }}>
                  <Type variant="captionStrong">{certificate.trade_label}</Type>
                  <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
                    {certificate.issuing_body}
                    {certificate.expires_on ? ` · expires ${shortDate(certificate.expires_on)}` : ""}
                  </Type>
                </View>
                <View style={[styles.certStatus, { backgroundColor: CERT_TONE[certificate.status].backgroundColor }]}>
                  <Type variant="captionStrong" style={{ color: CERT_TONE[certificate.status].color, fontSize: 12 }}>
                    {CERTIFICATE_LABEL[certificate.status]}
                  </Type>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Type variant="caption" style={{ color: theme.color.ink["500"] }}>None added. Certificates are optional.</Type>
        )}
      </Fact>
    </View>
  );
}

const CERT_TONE = {
  provided: { backgroundColor: theme.color.lagoon["100"], color: theme.color.lagoon["600"] },
  verified: { backgroundColor: KOLA_WASH, color: KOLA },
  expired: { backgroundColor: theme.color.field["100"], color: theme.color.ink["500"] },
  declined: { backgroundColor: theme.color.laterite["100"], color: theme.color.laterite["600"] },
} as const;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[2] }}>
      <Type variant="caption" style={{ color: theme.color.ink["500"] }}>{label}</Type>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  facts: { gap: space[4] },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: space[3],
    borderRadius: 999,
  },
  gallery: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  photo: { width: 92, height: 92, borderRadius: 14, backgroundColor: theme.color.field["100"] },
  cert: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    padding: space[3],
    borderRadius: 14,
    backgroundColor: alpha(DEEP, 0.03),
  },
  certStatus: { paddingVertical: 3, paddingHorizontal: space[2], borderRadius: 999 },
});
