import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  CERTIFICATE_LABEL,
  TRADES,
  discoverArtisans,
  getArtisan,
  type ArtisanCard,
  type DiscoverResult,
  type District,
  type PublicArtisan,
} from "@/artisan";
import { useAuth } from "@/auth";
import { DistrictPicker } from "@/components/artisan/ArtisanApplicationForm";
import { ToggleField } from "@/components/filters/FilterFields";
import { Chip, Notice, Type, space } from "@/components/ui";
import { Empty } from "@/components/work/WorkParts";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

/**
 * Artisans: the one way into the artisan network for somebody who rents or
 * manages property. Mirrors web's Artisans sheet, and opens as a sheet over
 * whatever screen asked for it — the Services tile, the provider's More.
 *
 * Three tabs inside it, not three new tabs in the bar. **Find** browses
 * approved artisans by trade and area; a profile opens in place, so Back
 * returns to the results where they were. **Requests** and **Records** hold
 * the quotes and jobs later phases add, and say so until then.
 *
 * Danpa HQ connects people and keeps the record. Nothing here calls an artisan
 * trusted or guaranteed, and nothing shows a phone number or an address.
 */

type Tab = "find" | "requests" | "records";

const AMBER = theme.color.harmattan["600"];
const AMBER_WASH = theme.color.harmattan["100"];
const KOLA = theme.color.kola["600"];
const LAGOON = theme.color.lagoon["600"];
const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];
const MUTED = theme.color.ink["500"];

const TABS: { key: Tab; label: string }[] = [
  { key: "find", label: "Find" },
  { key: "requests", label: "Requests" },
  { key: "records", label: "Records" },
];

export default function ArtisansScreen() {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ tab?: string; trade?: string }>();
  const pageBottom = useSafeBottom(space[10]);
  const [tab, setTab] = useState<Tab>(params.tab === "requests" || params.tab === "records" ? params.tab : "find");
  const [open, setOpen] = useState<string | null>(null);

  // Becoming an artisan is offered here and only here — a quiet link in the
  // header, never a prompt. Once approved, Menu carries the switch instead.
  const { state } = useAuth();
  const router = useRouter();
  const artisan = state.status === "signed_in" ? state.me.capabilities.artisan : null;
  const becomeLabel = !artisan || artisan.workspace_access
    ? null
    : artisan.status === "not_started" ? "Become an artisan?" : "Your application";

  useLayoutEffect(() => {
    navigation.setOptions({
      title: open ? "Artisan" : "Artisans",
      headerRight: becomeLabel && !open
        ? () => (
          <Pressable
            onPress={() => router.push("/(app)/artisan-application" as never)}
            accessibilityRole="link"
            hitSlop={8}
            style={{ paddingHorizontal: space[2] }}
          >
            <Type variant="captionStrong" style={{ color: shell.onChrome }}>{becomeLabel}</Type>
          </Pressable>
        )
        : undefined,
    });
  }, [navigation, open, becomeLabel, router]);

  return (
    <ScrollView
      style={styles.ground}
      contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.column}>
        {open ? (
          <>
            <Pressable
              onPress={() => setOpen(null)}
              accessibilityRole="button"
              hitSlop={8}
              style={styles.backRow}
            >
              <Ionicons name="chevron-back" size={18} color={KOLA} />
              <Type variant="captionStrong" style={{ color: KOLA }}>All artisans</Type>
            </Pressable>
            <Profile id={open} />
          </>
        ) : (
          <>
            <View style={styles.tabs} accessibilityRole="tablist">
              {TABS.map((option) => {
                const on = tab === option.key;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setTab(option.key)}
                    accessibilityRole="tab"
                    aria-selected={on}
                    style={[styles.tab, on ? styles.tabOn : null]}
                  >
                    <Type variant="captionStrong" style={{ color: on ? WHITE : theme.color.ink["700"] }}>{option.label}</Type>
                  </Pressable>
                );
              })}
            </View>
            {tab === "find" ? (
              <Find initialTrade={typeof params.trade === "string" ? params.trade : ""} onOpen={setOpen} />
            ) : tab === "requests" ? (
              <View style={styles.card}>
                <Empty ground={WHITE} icon="document-text-outline" title="No quote requests yet" hint="Quotes you ask for and receive appear here, with any waiting for your approval." />
              </View>
            ) : (
              <View style={styles.card}>
                <Empty ground={WHITE} icon="construct-outline" title="No artisan jobs yet" hint="Ongoing and completed work stays here, with its photos, costs and reviews." />
              </View>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Find({ initialTrade, onOpen }: { initialTrade: string; onOpen: (id: string) => void }) {
  const [trade, setTrade] = useState(initialTrade);
  const [area, setArea] = useState<District[]>([]);
  const [certified, setCertified] = useState(false);
  const [showUncertified, setShowUncertified] = useState(false);
  // Kept with the query it answers, so a result for an earlier filter is never
  // shown as the answer to the current one while the next is on its way.
  const [answer, setAnswer] = useState<{ key: string; result: DiscoverResult; error: string } | null>(null);

  // A different trade starts the electrical choice afresh: opting in to see
  // uncertified electricians is a choice about wiring, not a lasting setting.
  const [seenTrade, setSeenTrade] = useState(trade);
  if (seenTrade !== trade) {
    setSeenTrade(trade);
    setShowUncertified(false);
  }

  const district = area[0]?.id ?? "";
  const key = [trade, district, certified, showUncertified].join("|");
  useEffect(() => {
    let live = true;
    discoverArtisans({ trade, district, certified, showUncertified })
      .then((next) => { if (live) setAnswer({ key, result: next, error: "" }); })
      .catch((cause) => {
        if (!live) return;
        setAnswer({
          key,
          result: { results: [], electrical: false, hidden_uncertified: 0 },
          error: cause instanceof ApiFailure ? cause.error.message : "Could not load artisans.",
        });
      });
    return () => { live = false; };
  }, [key, trade, district, certified, showUncertified]);
  const result = answer?.key === key ? answer.result : null;
  const error = answer?.key === key ? answer.error : "";

  const electrical = trade === "electrical";

  return (
    <View style={{ gap: space[4] }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trades}>
        <Chip label="All trades" selected={trade === ""} onPress={() => setTrade("")} />
        {TRADES.map((option) => (
          <Chip key={option.value} label={option.label} selected={trade === option.value} onPress={() => setTrade(option.value)} />
        ))}
      </ScrollView>

      <View style={styles.card}>
        <DistrictPicker selected={area} onChange={setArea} max={1} label="Area" />
        {electrical ? null : <ToggleField label="Certified only" value={certified} onChange={setCertified} />}
      </View>

      {electrical ? (
        <View style={styles.electrical} accessibilityRole="summary">
          <Ionicons name="shield-checkmark" size={22} color={AMBER} />
          <View style={{ flex: 1, gap: 4 }}>
            <Type variant="bodyStrong">Wiring work needs a certified professional</Type>
            <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
              {showUncertified
                ? "Showing every electrician. Those without a verified electrical certificate are listed after the certified ones."
                : "Only electricians with a verified electrical certificate are shown."}
            </Type>
            {showUncertified ? (
              <Pressable onPress={() => setShowUncertified(false)} accessibilityRole="button" hitSlop={6}>
                <Type variant="captionStrong" style={{ color: KOLA }}>Show certified electricians only</Type>
              </Pressable>
            ) : result && result.hidden_uncertified > 0 ? (
              <Pressable onPress={() => setShowUncertified(true)} accessibilityRole="button" hitSlop={6}>
                <Type variant="captionStrong" style={{ color: KOLA }}>
                  Also show {result.hidden_uncertified} uncertified electrician{result.hidden_uncertified === 1 ? "" : "s"}
                </Type>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      {result === null ? (
        <ActivityIndicator color={AMBER} style={{ paddingVertical: space[8] }} />
      ) : result.results.length ? (
        <View style={{ gap: space[3] }}>
          {result.results.map((artisan) => (
            <Row key={artisan.id} artisan={artisan} onOpen={() => onOpen(artisan.id)} />
          ))}
        </View>
      ) : (
        <View style={styles.card}>
          <Empty
            ground={WHITE}
            icon="hammer-outline"
            title="No artisans match yet"
            hint={trade || district || certified ? "Try another trade or area, or include artisans without a certificate." : "Approved artisans appear here as they join Danpa HQ."}
          />
        </View>
      )}
    </View>
  );
}

function Row({ artisan, onOpen }: { artisan: ArtisanCard; onOpen: () => void }) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${artisan.name}, ${artisan.trades.map((trade) => trade.label).join(", ")}`}
      {...pressableFeedback(alpha(DEEP, 0.04))}
      style={styles.row}
    >
      <View style={styles.cover}>
        {artisan.cover_url ? (
          <Image source={{ uri: artisan.cover_url }} style={StyleSheet.absoluteFill} />
        ) : (
          <Ionicons name="hammer" size={26} color={AMBER} />
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Type variant="bodyStrong" numberOfLines={1}>{artisan.name}</Type>
        <Type variant="caption" numberOfLines={1} style={{ color: theme.color.ink["700"] }}>
          {artisan.trades.map((trade) => trade.label).join(" · ")}
        </Type>
        <View style={styles.area}>
          <Ionicons name="location-outline" size={13} color={MUTED} />
          <Type variant="caption" numberOfLines={1} style={{ color: MUTED, flexShrink: 1 }}>
            {artisan.districts.map((district) => district.name).join(", ")}
          </Type>
        </View>
        <Facts artisan={artisan} />
      </View>
    </Pressable>
  );
}

/** The facts a listing states, in the same order everywhere. Never a score. */
function Facts({ artisan }: { artisan: ArtisanCard }) {
  return (
    <View style={styles.facts}>
      {artisan.id_checked ? <Fact icon="shield-checkmark-outline" tone={{ ink: theme.color.kola["800"], wash: theme.color.kola["50"] }} text="ID checked" /> : null}
      {artisan.certified_trades.map((trade) => (
        <Fact key={trade} icon="ribbon-outline" tone={{ ink: LAGOON, wash: theme.color.lagoon["100"] }} text={`${trade} certificate verified`} />
      ))}
      <Fact icon="construct-outline" text={`${artisan.jobs_completed} job${artisan.jobs_completed === 1 ? "" : "s"} on Danpa HQ`} />
      <Fact icon="star-outline" text={artisan.reviews_count ? `${artisan.reviews_count} reviews` : "No reviews yet"} />
    </View>
  );
}

function Fact({ icon, text, tone }: { icon: keyof typeof Ionicons.glyphMap; text: string; tone?: { ink: string; wash: string } }) {
  const ink = tone?.ink ?? theme.color.ink["700"];
  return (
    <View style={[styles.fact, { backgroundColor: tone?.wash ?? theme.color.field["100"] }]}>
      <Ionicons name={icon} size={12} color={ink} />
      <Type variant="caption" style={{ color: ink, fontSize: 12, lineHeight: 16 }}>{text}</Type>
    </View>
  );
}

function shortDate(value: string): string {
  const iso = value.length === 10 ? `${value}T12:00:00` : value;
  return new Date(iso).toLocaleDateString("en-GH", { day: "numeric", month: "short", year: "numeric" });
}

function Profile({ id }: { id: string }) {
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

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: theme.color.field["50"] },
  page: { paddingTop: space[4], paddingHorizontal: space[4] },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", gap: space[4] },
  tabs: {
    flexDirection: "row",
    gap: space[1],
    padding: 4,
    borderRadius: 999,
    backgroundColor: alpha(DEEP, 0.06),
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 40, borderRadius: 999 },
  tabOn: { backgroundColor: KOLA },
  trades: { gap: space[2], paddingRight: space[4] },
  card: {
    gap: space[3],
    padding: space[4],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.08),
    backgroundColor: WHITE,
  },
  electrical: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    padding: space[4],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: alpha(theme.color.harmattan["500"], 0.35),
    backgroundColor: AMBER_WASH,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    padding: space[3],
    borderRadius: 18,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.08),
    backgroundColor: WHITE,
  },
  cover: {
    width: 72,
    height: 72,
    borderRadius: 14,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AMBER_WASH,
  },
  area: { flexDirection: "row", alignItems: "center", gap: 4 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  fact: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3, paddingHorizontal: space[2], borderRadius: 999 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", paddingVertical: space[1] },
  gallery: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  photo: { width: 104, height: 104, borderRadius: 14, backgroundColor: theme.color.field["100"] },
  cert: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: 14, backgroundColor: alpha(DEEP, 0.03) },
  foot: { color: MUTED, textAlign: "center", paddingHorizontal: space[2] },
});
