import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useIsFocused, useLocalSearchParams, useNavigation, useRouter, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Image, Keyboard, Pressable, ScrollView, StyleSheet, View, type NativeSyntheticEvent } from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs as NativeSheetTabs, type TabSelectedEvent } from "react-native-screens";

import { ApiFailure } from "@/api";
import {
  DISCOVERY_TRADES,
  discoverArtisans,
  getArtisanWork,
  type ArtisanCard,
  type CustomerWorkItem,
  type DiscoverResult,
  type District,
} from "@/artisan";
import { useAuth } from "@/auth";
import { DistrictPicker } from "@/components/artisan/ArtisanApplicationForm";
import { ArtisanProfile } from "@/components/artisan/ArtisanProfile";
import { Facts } from "@/components/artisan/ArtisanChips";
import { nativeTabHaptics } from "@/components/nav/NativeTabFrame";
import { ToggleField } from "@/components/filters/FilterFields";
import { Pill } from "@/components/record/RecordSurfaces";
import { Chip, Notice, Type, space } from "@/components/ui";
import { Empty } from "@/components/work/WorkParts";
import { resolveEntryRoute } from "@/navigation";
import { isIOS, pressableFeedback, safeHeaderTop } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * Find Artisans: the one way into the artisan network for somebody who rents
 * or manages property. One full page holds discovery and profiles, with
 * Find, Requests and Records pinned below its scrolling content. Applications
 * and full job records replace the directory.
 *
 * **Find** browses approved artisans by trade and area.
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

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap; sf: string; selectedSf: string }[] = [
  { key: "find", label: "Find", icon: "search-outline", sf: "magnifyingglass", selectedSf: "magnifyingglass" },
  { key: "requests", label: "Requests", icon: "clipboard-outline", sf: "clipboard", selectedSf: "clipboard.fill" },
  { key: "records", label: "Records", icon: "document-text-outline", sf: "doc.text", selectedSf: "doc.text.fill" },
];

function ArtisansNavigation({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.navigation, { paddingBottom: Math.max(insets.bottom, space[3]) }]}
      accessibilityRole="tablist"
      accessibilityLabel="Artisan navigation"
    >
      {TABS.map((option) => {
        const selected = tab === option.key;
        return (
          <Pressable key={option.key} onPress={() => onChange(option.key)} accessibilityRole="tab" aria-selected={selected} style={[styles.navItem, selected && styles.navItemOn]}>
            <Ionicons name={option.icon} size={22} color={selected ? theme.color.kola["800"] : MUTED} />
            <Type variant="captionStrong" style={{ color: selected ? theme.color.kola["800"] : MUTED, fontSize: 11 }}>{option.label}</Type>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ArtisansScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string; trade?: string; request?: string; kind?: string; mode?: string; label?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "requests" || params.tab === "records" ? params.tab : "find");
  const [nativeProvenance, setNativeProvenance] = useState(0);
  const [profileId, setProfileId] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  const resultsOffset = useRef(0);
  const { state, activeContext } = useAuth();
  const artisan = state.status === "signed_in" ? state.me.capabilities.artisan : null;
  const becomeLabel = !artisan || artisan.workspace_access
    ? null
    : artisan.status === "not_started" ? "Become an artisan?" : "Your application";

  const chooseSection = useCallback((next: Tab) => {
    resultsOffset.current = 0;
    scroller.current?.scrollTo({ y: 0, animated: false });
    setProfileId(null);
    setTab(next);
  }, []);
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ y: profileId ? 0 : resultsOffset.current, animated: false });
  }, [profileId, tab]);
  const navigationBar = <ArtisansNavigation tab={tab} onChange={chooseSection} />;
  useFocusEffect(useCallback(() => {
    if (!profileId) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { setProfileId(null); return true; });
    return () => listener.remove();
  }, [profileId]));

  const openRecord = (href: Href) => router.replace(href);
  const close = () => {
    Keyboard.dismiss();
    // Target the stack that owns the page, rather than a nested tab.
    const stack = navigation.getState();
    if (stack?.type === "stack" && stack.index > 0) {
      navigation.dispatch({ type: "POP", target: stack.key, payload: { count: 1 } });
      return;
    }
    const home = state.status === "signed_in"
      ? resolveEntryRoute(state.me, activeContext)
      : "/(app)/(tabs)";
    router.replace(home as Href);
  };
  const forRequest = params.request && (params.mode === undefined || params.mode === "invite" || params.mode === "suggest") ? {
    id: params.request,
    kind: params.kind === "direct_job" ? "direct_job" as const : "maintenance" as const,
    mode: params.mode === "suggest" ? "suggest" as const : "invite" as const,
    label: params.label ?? "",
  } : undefined;

  const content = (
      <ScrollView
        ref={scroller}
        style={styles.scroller}
        // UIKit adjusts the iOS scroll view around its native tab bar; elsewhere
        // the navigation is laid out below the scroll view, never over it.
        contentContainerStyle={styles.pageContent}
        contentInsetAdjustmentBehavior={isIOS ? "automatic" : "never"}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScroll={(event) => { if (!profileId) resultsOffset.current = event.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={16}
      >
        <View style={styles.pageHeader}>
          <View style={styles.headerRow}>
            {profileId ? <Pressable accessibilityRole="button" accessibilityLabel="Back to artisans" onPress={() => setProfileId(null)} style={styles.headerControl}><Ionicons name="chevron-back" size={23} color={DEEP} /></Pressable> : null}
            <View style={styles.headerIdentity}>
              <Type variant="title2" accessibilityRole="header" numberOfLines={1}>{profileId ? "Artisan" : tab === "find" ? "Find artisans" : tab === "requests" ? "Quote requests" : "Work records"}</Type>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close artisans" onPress={close} hitSlop={4} style={styles.headerControl}><Ionicons name="close" size={23} color={MUTED} /></Pressable>
          </View>
        </View>
        <View style={styles.page}>
          <View key={tab} style={[styles.column, profileId && styles.hidden]} aria-hidden={Boolean(profileId)}>
            <View style={styles.intro}>
              <Type variant="caption" style={styles.introText}>Skilled help for your home, from approved artisans.</Type>
              {becomeLabel && !params.request ? <Pressable accessibilityRole="link" onPress={() => openRecord("/(app)/artisan-application" as never)} style={styles.applicationLink}><Type variant="captionStrong" style={styles.applicationLabel}>{becomeLabel}</Type><Ionicons name="arrow-forward" size={15} color={KOLA} /></Pressable> : null}
            </View>
            {params.request ? <View style={styles.forRequest}><Type variant="caption" style={{ color: theme.color.ink["700"] }}>{params.mode === "suggest" ? "Suggesting an artisan for " : "Asking artisans to quote for "}<Type variant="captionStrong">{params.label}</Type>. Open a profile to {params.mode === "suggest" ? "suggest them." : "ask them."}</Type></View> : null}
            {tab === "find" ? <Find initialTrade={typeof params.trade === "string" ? params.trade : ""} onOpen={setProfileId} /> : <Work tab={tab} onNavigate={openRecord} />}
          </View>
          {profileId ? <View style={styles.column}><ArtisanProfile key={profileId} id={profileId} forRequest={forRequest} onNavigate={openRecord} /></View> : null}
        </View>
      </ScrollView>
  );

  return (
    <View style={[styles.ground, { paddingTop: safeHeaderTop(insets.top), paddingLeft: insets.left, paddingRight: insets.right }]} collapsable={false}>
      {focused ? <StatusBar style="dark" /> : null}
      {isIOS ? (
        <NativeSheetTabs.Host
          colorScheme="light"
          navStateRequest={{ selectedScreenKey: tab, baseProvenance: nativeProvenance }}
          ios={{ tabBarTintColor: KOLA, tabBarControllerMode: "tabBar", tabBarMinimizeBehavior: "never" }}
          onTabSelected={({ nativeEvent }: NativeSyntheticEvent<TabSelectedEvent>) => {
            const next = TABS.find((option) => option.key === nativeEvent.selectedScreenKey);
            if (!next) return;
            if (nativeEvent.actionOrigin === "user") nativeTabHaptics.tabPress({});
            setNativeProvenance(nativeEvent.provenance);
            if (next.key !== tab) chooseSection(next.key);
          }}
        >
          {TABS.map((option) => (
            <NativeSheetTabs.Screen key={option.key} screenKey={option.key} title={option.label}
              ios={{ icon: { type: "sfSymbol", name: option.sf },
                selectedIcon: { type: "sfSymbol", name: option.selectedSf },
                overrideScrollViewContentInsetAdjustmentBehavior: true }}>
              {tab === option.key ? content : null}
            </NativeSheetTabs.Screen>
          ))}
        </NativeSheetTabs.Host>
      ) : <>{content}{navigationBar}</>}
    </View>
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
        {DISCOVERY_TRADES.map((option) => (
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
      <View style={styles.rowMain}>
        <View style={styles.cover}>
          {artisan.cover_url ? (
            <Image source={{ uri: artisan.cover_url }} style={StyleSheet.absoluteFill} />
          ) : (
            <Ionicons name="hammer-outline" size={24} color={MUTED} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Type variant="bodyStrong" numberOfLines={1}>{artisan.name}</Type>
          <Type variant="caption" numberOfLines={1} style={{ color: theme.color.ink["700"] }}>
            {artisan.trades.map((trade) => trade.label).join(" · ")}
          </Type>
          <View style={styles.area}>
            <Ionicons name="location-outline" size={13} color={MUTED} />
            <Type variant="caption" numberOfLines={2} style={{ color: MUTED, flexShrink: 1 }}>
              {artisan.districts.map((district) => district.name).join(", ")}
            </Type>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.color.ink["300"]} />
      </View>
      <Facts artisan={artisan} compact />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: theme.color.field["50"] },
  page: { paddingTop: space[4], paddingHorizontal: space[4], paddingBottom: space[6] },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", gap: space[4] },
  scroller: { flex: 1, width: "100%" },
  pageContent: { flexGrow: 1 },
  hidden: { display: "none" },
  pageHeader: { flexShrink: 0, paddingTop: space[2], backgroundColor: theme.color.field["50"], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.color.field["200"] },
  headerRow: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 60, paddingHorizontal: space[4], paddingBottom: space[2] },
  headerIdentity: { flex: 1, minWidth: 0, justifyContent: "center" },
  headerControl: { flexShrink: 0, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  intro: { width: "100%", gap: space[2] },
  introText: { flexShrink: 1, color: MUTED, lineHeight: 20 },
  applicationLabel: { flexShrink: 1, color: KOLA },
  applicationLink: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: space[2], minHeight: 44 },
  navigation: { flexDirection: "row", gap: space[2], paddingTop: space[2], paddingHorizontal: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.field["200"], backgroundColor: WHITE },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4, minHeight: 58, borderRadius: 12 },
  navItemOn: { backgroundColor: theme.color.kola["50"] },
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
    gap: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.08),
    backgroundColor: WHITE,
  },
  rowMain: { flexDirection: "row", alignItems: "center", gap: space[3] },
  cover: {
    width: 52,
    height: 64,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["100"],
  },
  area: { flexDirection: "row", alignItems: "center", gap: 4 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  fact: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 3, paddingHorizontal: space[2], borderRadius: 999 },
  forRequest: { padding: space[3], borderRadius: 14, backgroundColor: AMBER_WASH },
  workRow: { gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: alpha(DEEP, 0.08), backgroundColor: WHITE },
  workMain: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  workFoot: { flexDirection: "row", alignItems: "center", gap: space[2], marginLeft: 40, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.field["200"] },
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
function Work({ tab, onNavigate }: { tab: "requests" | "records"; onNavigate: (href: Href) => void }) {
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

  const post = <Pill icon="add" label="Post a job" onPress={() => onNavigate("/(app)/direct-job-new" as never)} />;

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
      <View style={{ gap: 4 }}>
        <Type variant="title2" accessibilityRole="header">{tab === "requests" ? "Quote requests" : "Work records"}</Type>
        <Type variant="caption" style={{ color: MUTED }}>{tab === "requests" ? "Review the people asked to quote and their replies." : "The artisans you chose, with the agreed price and progress."}</Type>
      </View>
      {tab === "requests" ? post : null}
      {rows.map((item) => {
        const waiting = item.invitations.flatMap((row) => row.quotes).filter((quote) => quote.status === "submitted").length;
        const who = item.assigned?.artisan.name ?? (item.invitations.map((row) => row.artisan.name).join(", ") || "Nobody asked yet");
        const direct = item.request.kind === "direct_job";
        return (
          <Pressable
            key={`${item.request.kind}:${item.request.id}`}
            onPress={() =>
              onNavigate(
                (direct
                  ? { pathname: "/(app)/direct-job", params: { id: item.request.id } }
                  : { pathname: "/(app)/maintenance-request", params: { id: item.request.id } }) as never,
              )
            }
            accessibilityRole="button"
            {...pressableFeedback(alpha(DEEP, 0.04))}
            style={styles.workRow}
          >
            <View style={styles.workMain}>
              <View style={[styles.workIcon, direct ? styles.workIconDirect : null]}>
                <Ionicons name={direct ? "clipboard-outline" : "construct-outline"} size={18} color={direct ? LAGOON : KOLA} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                <Type variant="bodyStrong" numberOfLines={2}>{item.request.title}</Type>
                <Type variant="captionStrong" style={{ color: MUTED, fontSize: 11 }}>{item.request.status_display}</Type>
                <Type variant="caption" numberOfLines={2} style={{ color: MUTED }}>
                  {direct ? `${item.request.category_display} · ${item.request.place}` : item.request.place}
                </Type>
                <Type variant="caption" numberOfLines={1} style={{ color: MUTED }}>{who}</Type>
                {waiting ? <Type variant="captionStrong" style={{ color: LAGOON }}>{waiting} quote{waiting === 1 ? "" : "s"} waiting</Type> : null}
              </View>
            </View>
            <View style={styles.workFoot}>
              <View style={{ flex: 1, gap: 3 }}>
                {item.assigned?.price_on_record ? <><Type variant="caption" style={{ color: MUTED, fontSize: 11 }}>Agreed price</Type><Type variant="captionStrong">{item.assigned.price_on_record.price_display}</Type></> : <Type variant="caption" style={{ color: MUTED }}>View details</Type>}
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.color.ink["300"]} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
