import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexPage } from "@/components/account/IndexRows";
import { useHomeDensity } from "@/components/home/plinth";
import { ServiceHighlights } from "@/components/services/ServiceHighlights";
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
import {
  CATEGORIES,
  serviceById,
  servicesIn,
  type Service,
  type ServiceCategory,
} from "@/serviceCatalogue";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * Services: what a household buys, beside the rent.
 *
 * A fading glass banner introduces the service tools. The full
 * catalogue appears once below, grouped into bills and help around the home.
 *
 * **Nothing here sells anything yet, and it does not pretend to.** No biller is
 * integrated and `apps.payments` registers no production adapter, so the page
 * offers to save the number a service will need, never to buy, and a `later`
 * card is not a control at all.
 */

const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];
const INK = theme.color.ink["900"];

/** A quiet translucent surface; colour belongs to the service glyphs. */
const CARD = alpha(WHITE, 0.9);
const CARD_EDGE = alpha(DEEP, 0.09);
/** The quiet words: a strip tile's second line, the reassurance, a count. */
const SUMMARY = theme.color.ink["500"];
/** A closed service's name: still read, no longer leading. */
const CLOSED = theme.color.ink["700"];
/** The clock on a service that is not open yet: present, and no louder than that. */
const FAINT = theme.color.ink["500"];
/** The catalogue's closing label. */
const EYEBROW = theme.color.kola["800"];
const BONE = alpha(DEEP, 0.05);

/** The range, in two groups and no more (owner, 2026-10-06), in the catalogue's order. */
const GROUPS: { title: string; categories: ServiceCategory[] }[] = [
  { title: "Bills and top-ups", categories: ["utilities", "entertainment", "connectivity"] },
  { title: "Around your home", categories: ["home"] },
];

/** The space between catalogue cards. */
const TILE_GAP = 12;

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
        body="Sign in to use household services."
        next="/(app)/(tabs)/services"
      />
    );
  }


  // A service with a screen of its own opens it; the rest open the service screen.
  const openService = (service: Service) =>
    service.route
      ? router.push(service.route as never)
      : router.push({ pathname: "/(app)/service", params: { id: service.id } } as never);

  const savedCount = countByService(saved);

  return (
    // The same page and ground as More, so the two hub tabs read as one product.
    <IndexPage>
      {error ? <Notice tone="info" title={error} /> : null}

      <ServiceHighlights />

      {/* Only when there is something to glance at. A strip of zeroes is not a
          shortcut, it is a reminder that nothing is set up. */}
      {!loaded ? <QuickSkeleton /> : null}
      {loaded && saved.length ? (
        <QuickAccess details={saved.slice(0, 6)} onOpen={openService} />
      ) : null}
      {loaded && recent.length ? <RecentActivity purchases={recent} /> : null}

      {GROUPS.map((group) => (
        <Catalogue
          key={group.title}
          title={group.title}
          services={CATEGORIES.filter((category) => group.categories.includes(category.id)).flatMap((category) => servicesIn(category.id))}
          savedCount={savedCount}
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

/** A section's name, in the page's one heading size, with an optional count after it. */
function SectionTitle({ children, count }: { children: string; count?: number }) {
  return (
    <View style={styles.sectionTitle}>
      <Type variant="title2" accessibilityRole="header" style={styles.sectionText}>
        {children}
      </Type>
      {count ? <Type variant="caption" style={{ color: SUMMARY }}>{count}</Type> : null}
    </View>
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
      // Vertical room so a card's shadow is not clipped by the scroller.
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
              frame={[styles.lift, { borderRadius: 16 }]}
              style={[styles.stripTile, styles.card]}
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
              style={[styles.stripTile, styles.card]}
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

/** One group of the range, with two or three columns to suit the phone. */
function Catalogue({
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
  const { width } = useWindowDimensions();
  // Keep names whole on narrow phones instead of squeezing three cards across.
  const columns = width < 360 ? 2 : 3;
  const tileWidth = Math.floor((width - density.pagePadding * 2 - TILE_GAP * (columns - 1)) / columns);
  return (
    <View style={{ gap: space[3] }}>
      <SectionTitle>{title}</SectionTitle>
      <View style={styles.grid}>
        {services.map((service) => (
          <ServiceTile
            key={service.id}
            service={service}
            width={tileWidth}
            savedCount={savedCount[service.id] ?? 0}
            onPress={service.status === "later" ? undefined : () => onOpen(service)}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One service, with a centred outline glyph and its name beneath it.
 * The card's accessible label also describes what the service does.
 *
 * A service that opens is in its colour, with a check and a count when numbers
 * are saved for it.
 *
 * A `later` card is not a `Pressable`. A disabled control still invites a tap and
 * answers with nothing, which teaches people the screen is broken; a card that
 * was never a control says the same thing without the rejection. It keeps its
 * shape and position, with a quieter name and a clock. The glyph's colour
 * identifies the service family; a screen reader hears "Coming later".
 */
function ServiceTile({
  service,
  width,
  savedCount,
  onPress,
}: {
  service: Service;
  width: number;
  savedCount: number;
  onPress?: () => void;
}) {
  const later = service.status === "later";
  const tone = TONE[service.tone];
  const shape = {
    // Room for two-line names, including on a narrow phone.
    width,
    minHeight: 112,
    borderRadius: 12,
  };

  const body = (
    <>
      {later ? (
        <View style={[styles.corner, styles.clock]}>
          <Ionicons name="time-outline" size={12} color={FAINT} />
        </View>
      ) : savedCount ? (
        <View style={[styles.corner, styles.saved, { backgroundColor: tone.wash }]}>
          <Ionicons name="checkmark-circle" size={12} color={tone.ink} />
          <Type variant="captionStrong" style={[styles.savedText, { color: tone.ink }]}>
            {savedCount}
          </Type>
        </View>
      ) : null}
      <View style={styles.tileGlyph} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name={service.icon} size={28} color={tone.ink} />
      </View>
      <Type
        variant="bodyStrong"
        numberOfLines={2}
        style={[styles.tileName, { fontSize: width < 96 ? 12.5 : width < 108 ? 13 : 14, color: later ? CLOSED : INK }]}
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
        style={[styles.tile, styles.card, shape]}
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
      frame={[styles.lift, { width, borderRadius: shape.borderRadius }]}
      style={[styles.tile, styles.card, shape]}
    >
      {body}
    </PressableScale>
  );
}

/**
 * The end of the catalogue, said once and briefly. No card, no art and no
 * colour: it closes the catalogue instead of competing with it.
 */
function MoreServices() {
  return (
    <View style={styles.more}>
      <Type variant="label" style={{ color: EYEBROW }}>MORE SERVICES</Type>
      <Type variant="caption" style={{ color: SUMMARY }}>Coming soon</Type>
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
  /** Where the card sits: its width, and the shadow outside its clip. */
  frame?: StyleProp<ViewStyle>;
  /** The card itself: its paper, its edge and its corners. */
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const [scale] = useState(() => new Animated.Value(1));

  const animate = (toValue: number) => {
    if (reduceMotion) {
      scale.setValue(toValue);
      return;
    }
    Animated.spring(scale, { toValue, speed: 34, bounciness: 2, useNativeDriver: true }).start();
  };

  return (
    // Android's ripple ignores the card's rounded corners and fills its whole
    // rectangle, so there the frame clips it to the card's own radius. The frame
    // carries no shadow on Android, so nothing else is cut.
    <Animated.View style={[frame, isAndroid ? styles.clip : null, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onPressIn={() => animate(0.97)}
        onPressOut={() => animate(1)}
        style={({ pressed }) => [style, pressed ? { opacity: 0.85 } : null]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space[2],
    paddingHorizontal: space[1],
  },
  sectionText: {
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
    color: INK,
  },
  // Keep an incomplete final row centred within its group.
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: TILE_GAP,
  },
  // A soft green shadow on iOS and the web preview. Android draws elevation
  // under a rounded card as a hard ring, so there the edge does it.
  lift: isAndroid
    ? {}
    : {
      shadowColor: DEEP,
      shadowOpacity: 0.045,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 2 },
    },
  clip: {
    overflow: "hidden",
  },
  card: {
    backgroundColor: CARD,
    borderColor: CARD_EDGE,
    borderWidth: 1,
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 18,
    overflow: "hidden",
  },
  tileName: {
    maxWidth: "100%",
    minHeight: 36,
    lineHeight: 18,
    textAlign: "center",
    fontWeight: "500",
  },
  tileGlyph: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  corner: {
    position: "absolute",
    top: 7,
    right: 7,
  },
  clock: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.field["100"],
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
    borderRadius: 16,
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
