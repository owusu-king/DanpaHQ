import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexPage } from "@/components/account/IndexRows";
import { ph, useHomeDensity } from "@/components/home/plinth";
import { ServiceGlyph, TONE } from "@/components/services/ServiceGlyph";
import { Notice, Type, radius, space } from "@/components/ui";
import { formatMinor } from "@/listings";
import { useReduceMotion } from "@/motion";
import { isAndroid } from "@/platform";
import {
  detailTitle,
  listRecentPurchases,
  listSavedDetails,
  type RecentPurchase,
  type SavedDetail,
} from "@/serviceAccounts";
import { CATEGORIES, serviceById, servicesIn, type Service } from "@/serviceCatalogue";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * Services: what a household buys, beside the rent.
 *
 * **Glance → Understand → Act**, in that order down the page. Anything already
 * set up sits at the top as a one-tap repeat. Below it the catalogue is grouped
 * the way a person thinks about a house — power and water, screens, network,
 * help at home — and every service is a tile.
 *
 * **Tiles, and as few words as the page can manage** (product owner review,
 * 2026-09-15). Ruled rows read as a settings list, and the sentences around them
 * — an introduction, a line under every category, a summary under every service
 * — said what the glyphs and colours already say. A tile is a glyph in its
 * service's colour and a name. The summary is still read to a screen reader, and
 * the service's own screen says what it will do. A service that opens is frosted
 * glass with its colour washed into one corner; one that does not is thinner
 * glass, a drained glyph and a clock. Categories are named in type, never boxed:
 * cards holding cards is how a hub turns into a dashboard.
 *
 * **Nothing here sells anything yet, and it does not pretend to.** No biller is
 * integrated and `apps.payments` registers no production adapter, so a service
 * that is `preparing` opens to what it will do and lets you save the number it
 * will need. That is a real thing to do today and it is why those tiles are
 * pressable; `later` tiles are not controls at all.
 */

const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];
const INK = theme.color.ink["900"];

/** Glass for a service that opens, and a thinner glass for one that does not yet. */
const GLASS = alpha(WHITE, 0.62);
const GLASS_LATER = alpha(WHITE, 0.4);
const EDGE = alpha(DEEP, 0.08);
const EDGE_LATER = alpha(DEEP, 0.06);
/** How much of a service's colour washes into the corner of its tile. */
const TINT_OPACITY = 0.7;
/** The footer's name on the ground, in the tab bar's muted green — as on More. */
const LABEL = alpha(DEEP, 0.76);
/** Secondary words on glass, dark enough to read over the deepest part of the ground. */
const SUMMARY = alpha(INK, 0.7);
/** The clock on a service that is not open yet: present, and no louder than that. */
const FAINT = alpha(INK, 0.5);
const BONE = alpha(DEEP, 0.05);
/** Two to a row on any phone: the space between them is what is left over. */
const TILE_WIDTH = "48.5%";

export default function ServicesScreen() {
  const router = useRouter();
  const { state } = useAuth();
  const [saved, setSaved] = useState<SavedDetail[]>([]);
  const [recent, setRecent] = useState<RecentPurchase[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const signedIn = state.status === "signed_in";

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      const [details, purchases] = await Promise.all([
        listSavedDetails(),
        listRecentPurchases(),
      ]);
      setSaved(details);
      setRecent(purchases);
      setError("");
    } catch {
      // Saved details are a convenience, not the page. If the store cannot be
      // read the catalogue still works, so this says so and gets out of the way
      // rather than replacing the screen with a failure.
      setError("We could not read your saved details on this device.");
    } finally {
      setLoaded(true);
    }
  }, [signedIn]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!signedIn) {
    return (
      <AuthPrompt
        title="Household services"
        body="Sign in to set up the meters, decoders and numbers your home pays for."
        next="/(app)/(tabs)/services"
      />
    );
  }

  const openService = (service: Service) =>
    router.push({ pathname: "/(app)/service", params: { id: service.id } } as never);

  return (
    // The same page and ground as More, so the two hub tabs read as one product.
    // The header says "Services", so the page opens straight onto what it holds.
    <IndexPage>
      {error ? <Notice tone="info" title={error} /> : null}

      {/* GLANCE — only when there is something to glance at. A strip of zeroes
          is not a shortcut, it is a reminder that nothing is set up. */}
      {!loaded ? <QuickSkeleton /> : null}
      {loaded && saved.length ? (
        <QuickAccess details={saved.slice(0, 6)} onOpen={openService} />
      ) : null}
      {loaded && recent.length ? <RecentActivity purchases={recent} /> : null}

      {/* UNDERSTAND + ACT */}
      {CATEGORIES.map((category) => (
        <CategoryBlock
          key={category.id}
          title={category.label}
          services={servicesIn(category.id)}
          savedCount={countByService(saved)}
          onOpen={openService}
        />
      ))}

      <MoreServices />
    </IndexPage>
  );
}

function countByService(details: SavedDetail[]): Record<string, number> {
  return details.reduce<Record<string, number>>((totals, detail) => {
    totals[detail.serviceId] = (totals[detail.serviceId] ?? 0) + 1;
    return totals;
  }, {});
}

/** A section's name, and the only words a section has. */
function SectionTitle({ children }: { children: string }) {
  const density = useHomeDensity();
  return (
    <Type
      variant="title2"
      accessibilityRole="header"
      style={{
        paddingHorizontal: space[1],
        fontSize: density.compact ? 16.5 : 17.5,
        lineHeight: 23,
        letterSpacing: -0.2,
        color: INK,
      }}
    >
      {children}
    </Type>
  );
}

/**
 * A strip that runs to the screen's edges while its first tile lines up with the
 * page. Horizontal because these are shortcuts past the page, not part of it.
 */
function Strip({ children }: { children: ReactNode }) {
  const density = useHomeDensity();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -density.pagePadding }}
      // Vertical room so the glass's shadow is not clipped by the scroller.
      contentContainerStyle={{ gap: space[2], paddingHorizontal: density.pagePadding, paddingVertical: space[1] }}
    >
      {children}
    </ScrollView>
  );
}

/**
 * The saved numbers, as a horizontal strip of one-tap repeats.
 *
 * Ordered by use, so the meter this household actually tops up leads and the
 * one they saved once sits behind it. The nickname stays: it is the one word
 * that says which meter this is.
 */
function QuickAccess({
  details,
  onOpen,
}: {
  details: SavedDetail[];
  onOpen: (service: Service) => void;
}) {
  const density = useHomeDensity();
  return (
    <View style={{ gap: space[2] }}>
      <SectionTitle>Saved</SectionTitle>
      <Strip>
        {details.map((detail) => {
          const service = serviceById(detail.serviceId);
          if (!service) return null;
          return (
            <PressableScale
              key={`${detail.serviceId}:${detail.value}`}
              accessibilityLabel={`${service.label}, ${detailTitle(detail)}`}
              onPress={() => onOpen(service)}
              frame={styles.lift}
              style={[styles.stripTile, styles.glass]}
            >
              <ServiceGlyph service={service} size={density.compact ? 30 : 32} />
              <View style={{ gap: 1 }}>
                <Type variant="bodyStrong" numberOfLines={1} style={[styles.stripName, { fontSize: density.compact ? 13.5 : 14 }]}>
                  {service.label}
                </Type>
                <Type variant="caption" numberOfLines={1} style={[styles.stripValue, { fontSize: density.compact ? 11.5 : 12 }]}>
                  {detailTitle(detail)}
                </Type>
              </View>
            </PressableScale>
          );
        })}
      </Strip>
    </View>
  );
}

/** The same shape as the strip, before it has loaded. Not a spinner. */
function QuickSkeleton() {
  return (
    <View style={{ gap: space[2] }} accessibilityLabel="Loading your saved services">
      <View style={[styles.bone, { width: 96, height: 14, marginLeft: space[1] }]} />
      <View style={{ flexDirection: "row", gap: space[2] }}>
        <View style={[styles.bone, styles.stripTile, { height: 92 }]} />
        <View style={[styles.bone, styles.stripTile, { height: 92 }]} />
      </View>
    </View>
  );
}

/**
 * What was last bought.
 *
 * Reads from the platform, not the device — see `listRecentPurchases`. Empty
 * until a biller lands, which is why this renders nothing rather than an empty
 * state: a heading over a blank box is a promise the page cannot keep yet.
 */
function RecentActivity({ purchases }: { purchases: RecentPurchase[] }) {
  const density = useHomeDensity();
  return (
    <View style={{ gap: space[2] }}>
      <SectionTitle>Recent</SectionTitle>
      <Strip>
        {purchases.map((purchase) => {
          const service = serviceById(purchase.serviceId);
          if (!service) return null;
          const amount = formatMinor(purchase.amountMinor, purchase.currency);
          return (
            <View
              key={purchase.id}
              accessible
              accessibilityLabel={`${service.label}, ${purchase.maskedValue}, ${amount}`}
              style={[styles.stripTile, styles.glass]}
            >
              <ServiceGlyph service={service} size={density.compact ? 30 : 32} />
              <View style={{ gap: 1 }}>
                <Type variant="bodyStrong" numberOfLines={1} style={[styles.stripName, { fontSize: density.compact ? 13.5 : 14 }]}>
                  {amount}
                </Type>
                <Type variant="caption" numberOfLines={1} style={[styles.stripValue, { fontSize: density.compact ? 11.5 : 12 }]}>
                  {purchase.maskedValue}
                </Type>
              </View>
            </View>
          );
        })}
      </Strip>
    </View>
  );
}

/** One category: its name, then its services as tiles, two to a row. */
function CategoryBlock({
  title,
  services,
  savedCount,
  onOpen,
}: {
  title: string;
  services: Service[];
  savedCount: Record<string, number>;
  onOpen: (service: Service) => void;
}) {
  const density = useHomeDensity();
  if (!services.length) return null;
  return (
    <View style={{ gap: density.compact ? space[2] : space[3] }}>
      <SectionTitle>{title}</SectionTitle>
      <View style={[styles.grid, { rowGap: density.compact ? 9 : 10 }]}>
        {services.map((service) => (
          <ServiceTile
            key={service.id}
            service={service}
            savedCount={savedCount[service.id] ?? 0}
            onPress={service.status === "later" ? undefined : () => onOpen(service)}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One service, as a tile: its glyph, its state, its name.
 *
 * A service that opens is glass with its colour washed into the corner, and a
 * check with a count when numbers are saved for it.
 *
 * A `later` tile is not a `Pressable`. A disabled control still invites a tap and
 * answers with nothing, which teaches people the screen is broken; a tile that
 * was never a control says the same thing without the rejection. It keeps its
 * shape and position and loses its colour — thinner glass, a drained glyph and a
 * clock — and a screen reader hears "Coming later".
 */
function ServiceTile({
  service,
  savedCount,
  onPress,
}: {
  service: Service;
  savedCount: number;
  onPress?: () => void;
}) {
  const density = useHomeDensity();
  const later = service.status === "later";
  const tone = TONE[service.tone];
  const shape = {
    minHeight: density.compact ? 100 : 108,
    padding: density.compact ? space[3] : 14,
    borderRadius: density.compact ? 14 : 16,
  };

  const body = (
    <>
      {later ? null : <Tint colour={tone.wash} />}
      <View style={styles.tileTop}>
        <ServiceGlyph service={service} size={density.compact ? 38 : 42} muted={later} />
        {later ? (
          <Ionicons name="time-outline" size={15} color={FAINT} />
        ) : savedCount ? (
          <View style={[styles.saved, { backgroundColor: tone.wash }]}>
            <Ionicons name="checkmark-circle" size={12} color={tone.ink} />
            <Type variant="captionStrong" style={[styles.savedText, { color: tone.ink }]}>
              {savedCount}
            </Type>
          </View>
        ) : null}
      </View>
      <Type
        variant="bodyStrong"
        style={{
          fontSize: density.compact ? 14.5 : 15.5,
          lineHeight: density.compact ? 19 : 20,
          color: later ? SUMMARY : INK,
        }}
      >
        {service.label}
      </Type>
    </>
  );

  if (later) {
    return (
      <View
        accessible
        accessibilityLabel={`${service.label}. ${service.summary}. Coming later.`}
        style={[styles.tile, styles.tileLater, shape, { width: TILE_WIDTH }]}
      >
        {body}
      </View>
    );
  }

  return (
    <PressableScale
      accessibilityLabel={
        savedCount
          ? `${service.label}. ${service.summary}. ${savedCount} saved.`
          : `${service.label}. ${service.summary}.`
      }
      onPress={onPress}
      frame={[styles.lift, { width: TILE_WIDTH, borderRadius: shape.borderRadius }]}
      style={[styles.tile, styles.glass, styles.fill, shape]}
    >
      {body}
    </PressableScale>
  );
}

/**
 * A service's colour, washed into the top corner of its glass and gone before the
 * far one, so its name always stands on clear glass.
 */
function Tint({ colour }: { colour: string }) {
  const id = `tint${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="1" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colour} stopOpacity={TINT_OPACITY} />
            <Stop offset="0.62" stopColor={colour} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/**
 * The end of the catalogue, said once and briefly. No glass, no glyph and no
 * colour: it closes the catalogue instead of competing with it.
 */
function MoreServices() {
  return (
    <View style={styles.more}>
      <Type variant="label" style={{ color: LABEL }}>MORE SERVICES</Type>
      <Type variant="caption" style={{ color: ph.ink70 }}>Coming soon</Type>
    </View>
  );
}

/**
 * The press every service surface shares.
 *
 * Same spring as the tab bar and the Explore header buttons, because two
 * navigation affordances on one screen that answer a thumb differently feel
 * like two products. Reduce Motion is honoured by setting the value rather than
 * animating to it — the feedback stays, the movement goes.
 */
function PressableScale({
  children,
  onPress,
  accessibilityLabel,
  frame,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  /** Where the tile sits: its width, and the shadow outside its clip. */
  frame?: StyleProp<ViewStyle>;
  /** The tile itself: its glass, its edge and its corners. */
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const animate = (toValue: number) => {
    if (reduceMotion) {
      scale.setValue(toValue);
      return;
    }
    Animated.spring(scale, { toValue, speed: 34, bounciness: 2, useNativeDriver: true }).start();
  };

  return (
    <Animated.View style={[frame, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onPressIn={() => animate(0.97)}
        onPressOut={() => animate(1)}
        android_ripple={isAndroid ? { color: alpha(theme.color.kola["600"], 0.12) } : undefined}
        style={({ pressed }) => [style, pressed && !isAndroid ? { opacity: 0.8 } : null]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  // A whisper of green shadow on iOS and the web preview. Android draws
  // elevation through a translucent fill as a smudge, so there the edge does it.
  lift: isAndroid
    ? {}
    : {
      shadowColor: DEEP,
      shadowOpacity: 0.05,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 5 },
    },
  glass: {
    backgroundColor: GLASS,
    borderColor: EDGE,
  },
  tile: {
    justifyContent: "space-between",
    gap: space[3],
    borderWidth: 1,
    overflow: "hidden",
  },
  // Only the pressable fills its frame, so tiles in one row stand equally tall.
  // A grid item that grew would eat the gap between the two.
  fill: {
    flexGrow: 1,
  },
  tileLater: {
    backgroundColor: GLASS_LATER,
    borderColor: EDGE_LATER,
  },
  tileTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[2],
  },
  saved: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
  },
  savedText: {
    fontSize: 11,
    lineHeight: 14,
  },
  stripTile: {
    width: 144,
    gap: space[3],
    padding: space[3],
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  stripName: {
    lineHeight: 18,
    color: INK,
  },
  stripValue: {
    lineHeight: 16,
    color: SUMMARY,
  },
  bone: {
    borderRadius: radius.md,
    borderColor: "transparent",
    backgroundColor: BONE,
  },
  more: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space[3],
    paddingTop: space[4],
    paddingHorizontal: space[1],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: alpha(DEEP, 0.1),
  },
});
