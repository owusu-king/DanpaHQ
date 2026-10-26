import Ionicons from "@expo/vector-icons/Ionicons";
import { Fragment, type ReactNode } from "react";
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
const MUTED = theme.color.ink["500"];
const RULE = alpha(DEEP, 0.08);

function shortDate(value: string): string {
  const iso = value.length === 10 ? `${value}T12:00:00` : value;
  return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

/** What the facts need: an artisan's own profile and a public one both have it. */
export type FactsProfile = {
  trades: TradeOption[];
  districts: { id: string; name: string }[];
  bio: string;
  portfolio: { id: string; url: string | null }[];
  certificates: Pick<ArtisanCertificate, "id" | "trade_label" | "issuing_body" | "expires_on" | "status">[];
};

/**
 * An artisan's profile as plain facts: trades, area, their own words, photos of
 * their work and each certificate with its status. No score, no ranking — the
 * reader decides what the facts mean. Mirrors web's `ArtisanFacts`.
 *
 * Set as a spec sheet (owner, 2026-10-25: organise it, timeless and
 * professional): their own words lead; trades and area are labelled rows, the
 * label in a fixed column so the values line up; the work is an even grid;
 * certificates are rows under a hairline, each with its standing at the end.
 * Each part is divided from the next by a rule, and every label is the same
 * small capitals.
 */
export function ArtisanFacts({ profile }: { profile: FactsProfile }) {
  const photos = profile.portfolio.filter((photo): photo is { id: string; url: string } => Boolean(photo.url));
  const parts: ReactNode[] = [];

  if (profile.bio) {
    parts.push(
      <View key="about" style={styles.part}>
        <Label>About</Label>
        <Type variant="body" style={styles.bio}>{profile.bio}</Type>
      </View>,
    );
  }

  parts.push(
    <View key="reach" style={styles.part}>
      <Line label="Trades">
        {profile.trades.map((trade) => (
          <View key={trade.value} style={[styles.tag, { backgroundColor: AMBER_WASH }]}>
            <Type variant="captionStrong" style={[styles.tagText, { color: AMBER }]}>{trade.label}</Type>
          </View>
        ))}
      </Line>
      <Line label="Area">
        {profile.districts.map((district) => (
          <View key={district.id} style={[styles.tag, { backgroundColor: KOLA_WASH }]}>
            <Ionicons name="location-outline" size={12} color={KOLA} />
            <Type variant="captionStrong" style={[styles.tagText, { color: KOLA }]}>{district.name}</Type>
          </View>
        ))}
      </Line>
    </View>,
  );

  if (photos.length) {
    parts.push(
      <View key="work" style={styles.part}>
        <Label count={`${photos.length} ${photos.length === 1 ? "photo" : "photos"}`}>Work</Label>
        <View style={styles.gallery}>
          {photos.map((photo, index) => (
            <View key={photo.id} style={styles.photoCell}>
              <Image source={{ uri: photo.url }} style={styles.photo} accessibilityLabel={`Work photo ${index + 1}`} />
            </View>
          ))}
        </View>
      </View>,
    );
  }

  parts.push(
    <View key="certificates" style={styles.part}>
      <Label count={profile.certificates.length ? String(profile.certificates.length) : undefined}>Certificates</Label>
      {profile.certificates.length ? (
        <View>
          {profile.certificates.map((certificate, index) => (
            <Fragment key={certificate.id}>
              {index ? <View style={styles.certRule} /> : null}
              <View
                style={styles.cert}
                accessible
                accessibilityLabel={`${certificate.trade_label} certificate. ${certificate.issuing_body}${certificate.expires_on ? `, until ${shortDate(certificate.expires_on)}` : ""}. ${CERTIFICATE_LABEL[certificate.status]}.`}
              >
                <View style={styles.certMark}>
                  <Ionicons name="ribbon-outline" size={16} color={theme.color.lagoon["600"]} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <Type variant="bodyStrong" numberOfLines={1} style={styles.certTitle}>{certificate.trade_label}</Type>
                  <Type variant="caption" numberOfLines={2} style={styles.certLine}>
                    {certificate.issuing_body}
                    {certificate.expires_on ? ` · until ${shortDate(certificate.expires_on)}` : ""}
                  </Type>
                </View>
                <View style={[styles.certStatus, { backgroundColor: CERT_TONE[certificate.status].backgroundColor }]}>
                  <Type variant="captionStrong" numberOfLines={1} style={[styles.certStatusText, { color: CERT_TONE[certificate.status].color }]}>
                    {CERT_SHORT[certificate.status]}
                  </Type>
                </View>
              </View>
            </Fragment>
          ))}
        </View>
      ) : (
        <Type variant="caption" style={{ color: MUTED }}>None added. Certificates are optional.</Type>
      )}
    </View>,
  );

  return (
    // Each part carries its own breathing room; the card's padding already gives the first and last theirs.
    <View style={{ marginVertical: -space[4] }}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index ? <View style={styles.rule} /> : null}
          {part}
        </Fragment>
      ))}
    </View>
  );
}

const CERT_TONE = {
  provided: { backgroundColor: theme.color.lagoon["100"], color: theme.color.lagoon["600"] },
  verified: { backgroundColor: KOLA_WASH, color: KOLA },
  expired: { backgroundColor: theme.color.field["100"], color: MUTED },
  declined: { backgroundColor: theme.color.laterite["100"], color: theme.color.laterite["600"] },
} as const;

/** The chip says the standing in a word; the full wording stays in `CERTIFICATE_LABEL` for the screen reader. */
const CERT_SHORT: Record<keyof typeof CERT_TONE, string> = {
  provided: "Provided",
  verified: "Verified",
  expired: "Expired",
  declined: "Declined",
};

/** A part's name: small capitals, with a count beside it when there is one. */
function Label({ children, count }: { children: string; count?: string }) {
  return (
    <View style={styles.labelRow}>
      <Type variant="label" accessibilityRole="header" style={styles.label}>{children}</Type>
      {count ? <Type variant="caption" style={styles.count}>{count}</Type> : null}
    </View>
  );
}

/** A labelled line: the name in a fixed column, the values wrapping beside it. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.line} accessible={false}>
      <Type variant="label" style={[styles.label, styles.lineLabel]}>{label}</Type>
      <View style={styles.tags}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  part: { gap: space[3], paddingVertical: space[4] },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: RULE },
  labelRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  label: {
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
    color: MUTED,
  },
  count: { fontSize: 12, lineHeight: 16, color: theme.color.ink["300"] },
  bio: { fontSize: 15, lineHeight: 22, color: theme.color.ink["700"] },
  line: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  // Wide enough for the longest name, so both lines' values start at one edge.
  lineLabel: { width: 64, paddingTop: 6 },
  tags: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  tagText: { fontSize: 13, lineHeight: 18 },
  // Three across, square, the gaps included in each cell's share.
  gallery: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -3 },
  photoCell: { width: "33.333%", aspectRatio: 1, padding: 3 },
  photo: { width: "100%", height: "100%", borderRadius: 12, backgroundColor: theme.color.field["100"] },
  cert: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[2] },
  certRule: { height: StyleSheet.hairlineWidth, marginLeft: 44, backgroundColor: RULE },
  certMark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.lagoon["100"],
  },
  certTitle: { fontSize: 14.5, lineHeight: 19, color: theme.color.ink["900"] },
  certLine: { fontSize: 12.5, lineHeight: 17, color: MUTED },
  certStatus: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999 },
  certStatusText: { fontSize: 11.5, lineHeight: 15 },
});
