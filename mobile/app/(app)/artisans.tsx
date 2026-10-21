import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  TRADES,
  discoverArtisans,
  getArtisanWork,
  type ArtisanCard,
  type CustomerWorkItem,
  type DiscoverResult,
  type District,
} from "@/artisan";
import { useAuth } from "@/auth";
import { DistrictPicker } from "@/components/artisan/ArtisanApplicationForm";
import { Facts } from "@/components/artisan/ArtisanChips";
import { ToggleField } from "@/components/filters/FilterFields";
import { Pill } from "@/components/record/RecordSurfaces";
import { Chip, Notice, Type, space } from "@/components/ui";
import { Empty } from "@/components/work/WorkParts";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

/**
 * Find Artisans: the one way into the artisan network for somebody who rents
 * or manages property. A page of its own, pushed from Menu, More, the Services
 * tile or a repair (owner, 2026-10-20) — never a sheet hanging over another.
 *
 * Three tabs on the page, not new tabs in the bar. **Find** browses approved
 * artisans by trade and area, and each profile is its own pushed page.
 * **Requests** holds the quotes asked for and waiting — on repairs, and on jobs
 * somebody posted for themselves (Post a job) — and **Records** the work an
 * artisan was chosen for. Opened from a repair or a posted job, profiles offer
 * to invite (or, for a tenant, suggest) for it.
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
  const params = useLocalSearchParams<{
    tab?: string;
    trade?: string;
    request?: string;
    kind?: string;
    mode?: string;
    label?: string;
  }>();
  const pageBottom = useSafeBottom(space[10]);
  const [tab, setTab] = useState<Tab>(params.tab === "requests" || params.tab === "records" ? params.tab : "find");

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
      title: "Find Artisans",
      headerRight: becomeLabel && !params.request
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
  }, [navigation, becomeLabel, router, params.request]);

  function open(id: string) {
    router.push({
      pathname: "/(app)/artisan-view",
      params: {
        id,
        ...(params.request
          ? { request: params.request, kind: params.kind ?? "maintenance", mode: params.mode ?? "invite", label: params.label ?? "" }
          : {}),
      },
    } as never);
  }

  return (
    <ScrollView
      style={styles.ground}
      contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.column}>
        {params.request ? (
          <View style={styles.forRequest}>
            <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
              {params.mode === "suggest" ? "Suggesting an artisan for " : "Asking artisans to quote for "}
              <Type variant="captionStrong">{params.label}</Type>. Open a profile to {params.mode === "suggest" ? "suggest them." : "ask them."}
            </Type>
          </View>
        ) : null}
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
          <Find initialTrade={typeof params.trade === "string" ? params.trade : ""} onOpen={open} />
        ) : (
          <Work tab={tab} />
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
  forRequest: { padding: space[3], borderRadius: 14, backgroundColor: AMBER_WASH },
  workRow: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: 18, borderWidth: 1, borderColor: alpha(DEEP, 0.08), backgroundColor: WHITE },
  workIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.kola["50"] },
  workIconDirect: { backgroundColor: theme.color.lagoon["100"] },
  gallery: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  photo: { width: 104, height: 104, borderRadius: 14, backgroundColor: theme.color.field["100"] },
  cert: { flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderRadius: 14, backgroundColor: alpha(DEEP, 0.03) },
  foot: { color: MUTED, textAlign: "center", paddingHorizontal: space[2] },
});

/**
 * Requests and Records: quotes asked for and waiting, and the work under way or
 * done. A repair opens its maintenance page; a posted job its own page.
 */
function Work({ tab }: { tab: "requests" | "records" }) {
  const router = useRouter();
  const [work, setWork] = useState<{ requests: CustomerWorkItem[]; records: CustomerWorkItem[] } | null>(null);
  const [error, setError] = useState("");

  // Read again on every return: a job posted, asked about or decided on a
  // deeper page lands here on the way back.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      getArtisanWork()
        .then((next) => { if (live) { setWork(next); setError(""); } })
        .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load artisan work."); });
      return () => { live = false; };
    }, []),
  );

  const post = <Pill icon="add" label="Post a job" onPress={() => router.push("/(app)/direct-job-new" as never)} />;

  if (error) return <Notice tone="error" title={error} />;
  if (!work) return <ActivityIndicator color={AMBER} style={{ paddingVertical: space[8] }} />;
  const rows = tab === "requests" ? work.requests : work.records;
  if (!rows.length) {
    return (
      <View style={{ gap: space[3] }}>
        <View style={styles.card}>
          {tab === "requests" ? (
            <Empty ground={WHITE} icon="document-text-outline" title="No quote requests yet" hint="Post a job for work at home, or invite an artisan from a repair." />
          ) : (
            <Empty ground={WHITE} icon="construct-outline" title="No artisan jobs yet" hint="Work an artisan was chosen for stays here, with its price." />
          )}
        </View>
        {tab === "requests" ? post : null}
      </View>
    );
  }
  return (
    <View style={{ gap: space[3] }}>
      {tab === "requests" ? post : null}
      {rows.map((item) => {
        const waiting = item.invitations.flatMap((row) => row.quotes).filter((quote) => quote.status === "submitted").length;
        const who = item.assigned?.artisan.name ?? (item.invitations.map((row) => row.artisan.name).join(", ") || "Nobody asked yet");
        const direct = item.request.kind === "direct_job";
        return (
          <Pressable
            key={`${item.request.kind}:${item.request.id}`}
            onPress={() =>
              router.push(
                (direct
                  ? { pathname: "/(app)/direct-job", params: { id: item.request.id } }
                  : { pathname: "/(app)/maintenance-request", params: { id: item.request.id } }) as never,
              )
            }
            accessibilityRole="button"
            {...pressableFeedback(alpha(DEEP, 0.04))}
            style={styles.workRow}
          >
            <View style={[styles.workIcon, direct ? styles.workIconDirect : null]}>
              <Ionicons name={direct ? "clipboard-outline" : "construct-outline"} size={18} color={direct ? LAGOON : KOLA} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Type variant="bodyStrong" numberOfLines={1}>{item.request.title}</Type>
              <Type variant="caption" numberOfLines={1} style={{ color: MUTED }}>
                {direct ? `${item.request.category_display} · ${item.request.place}` : item.request.place}
              </Type>
              <Type variant="caption" numberOfLines={1} style={{ color: MUTED }}>{who}</Type>
            </View>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              {waiting ? <Type variant="captionStrong" style={{ color: LAGOON }}>{waiting} waiting</Type> : null}
              {item.assigned?.price_on_record ? <Type variant="captionStrong">{item.assigned.price_on_record.price_display}</Type> : null}
              <Type variant="caption" style={{ color: MUTED, fontSize: 12 }}>{item.request.status_display}</Type>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
