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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexPage } from "@/components/account/IndexRows";
import { useHomeDensity } from "@/components/home/plinth";
import { ServiceArt } from "@/components/services/ServiceArt";
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
  SERVICES,
  openableServices,
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
 * **A carousel first, then the range in two groups** (owner, 2026-10-06). The
 * page opens on a strip of slides that swipe sideways, one for each service
 * that opens today, in its own colour, with what it is and what it will do —
 * and a last slide pointing to where the rent lives. The household's own
 * service leads. Under it, the range as small square cards three to a row and
 * centred, in two groups: the bills and top-ups, and the help around the home.
 *
 * **Nothing here sells anything yet, and it does not pretend to.** No biller is
 * integrated and `apps.payments` registers no production adapter, so a slide
 * offers to save the number a service will need, never to buy, and a `later`
 * card is not a control at all.
 */

const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];
const INK = theme.color.ink["900"];

/** Cards are paper on the ground, edged rather than boxed in shadow. */
const CARD = WHITE;
const CARD_EDGE = theme.color.field["200"];
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

/** Three to a row, with this between them. */
const TILE_GAP = 10;
/** A slide is this much of the page's width, so the next one shows and the strip says it swipes. */
const SLIDE_SHARE = 0.8;
/** On a narrow phone a slide takes more, so its act still fits on one line. */
const NARROW_SLIDE_SHARE = 0.88;
const SLIDE_GAP = 10;

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
        icon="grid"
        tone="harmattan"
        title="Household services"
        body="Electricity, water, data and TV — paid from the same place as your rent."
        next="/(app)/(tabs)/services"
        points={[
          { icon: "bookmark-outline", label: "Keep your meter and decoder numbers" },
          { icon: "flash-outline", label: "Top up in a few taps, not a few screens" },
          { icon: "receipt-outline", label: "Every purchase kept with its receipt" },
        ]}
      />
    );
  }

  // Every service that opens has a slide, and the one this household already
  // uses leads. A `later` service never does: there is nothing to do there yet.
  const openable = openableServices();
  const mine = openable.find((service) => service.id === saved[0]?.serviceId);
  const featured = mine ? [mine, ...openable.filter((service) => service !== mine)] : openable;

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

      <Carousel
        services={featured}
        onOpen={openService}
        onRent={() => router.push("/(app)/(tabs)/payments" as never)}
      />

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
 * The page's opening: one slide per service that opens, swiped sideways.
 *
 * Each slide is a short white card like the rest of the page (revised on
 * review, 2026-10-06: full-colour slides were too big and too loud). Colour is
 * kept to the illustration's tile and the act. It shows the service's name
 * over what it is, from the catalogue's own words, so a new service brings its
 * slide with it. Its one act is what the service can do today: save the number
 * it will need, or open its own screen. What the service will do is read out,
 * not printed. The next slide shows at the edge, and the dots say where you
 * are. The last slide points to the rent, which lives in Payments.
 */
function Carousel({
  services,
  onOpen,
  onRent,
}: {
  services: Service[];
  onOpen: (service: Service) => void;
  onRent: () => void;
}) {
  const density = useHomeDensity();
  const { width } = useWindowDimensions();
  const slideWidth = Math.round((width - density.pagePadding * 2) * (width < 360 ? NARROW_SLIDE_SHARE : SLIDE_SHARE));
  const [current, setCurrent] = useState(0);
  const count = services.length + 1;

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / (slideWidth + SLIDE_GAP));
    const next = Math.max(0, Math.min(count - 1, index));
    if (next !== current) setCurrent(next);
  };

  return (
    <View style={{ gap: space[3] }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={slideWidth + SLIDE_GAP}
        snapToAlignment="start"
        disableIntervalMomentum
        onScroll={onScroll}
        scrollEventThrottle={32}
        accessibilityLabel="Featured services"
        style={{ marginHorizontal: -density.pagePadding, marginVertical: -6 }}
        contentContainerStyle={{ gap: SLIDE_GAP, paddingHorizontal: density.pagePadding, paddingVertical: 6 }}
      >
        {services.map((service, index) => (
          <Slide
            key={service.id}
            width={slideWidth}
            tone={TONE[service.tone]}
            eyebrow={service.label}
            title={service.summary}
            body={service.promise}
            act={service.identifier ? `Save ${service.identifier.label.toLowerCase()}` : `Open ${service.label}`}
            position={`${index + 1} of ${count}`}
            art={<ServiceArt service={service} index={SERVICES.indexOf(service)} width={56} />}
            onPress={() => onOpen(service)}
          />
        ))}
        <Slide
          width={slideWidth}
          tone={TONE.kola}
          eyebrow="Rent"
          title="Rent is in Payments"
          body="What is due, what you have paid and every receipt."
          act="Go to Payments"
          position={`${count} of ${count}`}
          art={<Ionicons name="receipt-outline" size={26} color={TONE.kola.ink} />}
          onPress={onRent}
        />
      </ScrollView>

      <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: count }, (_, index) => (
          <View key={index} style={[styles.dot, index === current ? styles.dotOn : null]} />
        ))}
      </View>

      <Type variant="caption" style={styles.reassure}>
        Nothing is charged yet. Save your numbers now, and paying is one tap when it opens.
      </Type>
    </View>
  );
}

function Slide({
  width,
  tone,
  eyebrow,
  title,
  body,
  act,
  position,
  art,
  onPress,
}: {
  width: number;
  /** The service's colour: a tint behind the art, and the ink of the act. */
  tone: { ink: string; wash: string };
  eyebrow: string;
  title: string;
  body: string;
  act: string;
  position: string;
  art: ReactNode;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityLabel={`${eyebrow}. ${title}. ${body} ${act}. ${position}.`}
      onPress={onPress}
      frame={[styles.lift, styles.slideFrame, { width }]}
      style={[styles.slide, styles.card]}
    >
      <View style={[styles.slideArt, { backgroundColor: tone.wash }]}>{art}</View>
      <View style={styles.slideWords}>
        <Type variant="caption" numberOfLines={1} style={styles.slideEyebrow}>{eyebrow}</Type>
        <Type variant="bodyStrong" numberOfLines={2} style={styles.slideTitle}>{title}</Type>
        <View style={styles.slideAct}>
          <Type variant="captionStrong" numberOfLines={1} style={[styles.slideActText, { color: tone.ink }]}>{act}</Type>
          <Ionicons name="arrow-forward" size={13} color={tone.ink} />
        </View>
      </View>
    </PressableScale>
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

/** One group of the range: its name, then its services three to a row, centred. */
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
  // Three across whatever the phone, and a short last row sits in the middle.
  const tileWidth = Math.floor((width - density.pagePadding * 2 - TILE_GAP * 2) / 3);
  return (
    <View style={{ gap: space[3] }}>
      <SectionTitle count={services.length}>{title}</SectionTitle>
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
 * One service, as a small square card: its illustration in the middle and its
 * name under it. What it is lives in the card's label and on its slide.
 *
 * A service that opens is in its colour, with a check and a count when numbers
 * are saved for it.
 *
 * A `later` card is not a `Pressable`. A disabled control still invites a tap and
 * answers with nothing, which teaches people the screen is broken; a card that
 * was never a control says the same thing without the rejection. It keeps its
 * shape and position and loses its colour — a drained illustration, a quieter
 * name and a clock — and a screen reader hears "Coming later".
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
    // A rounded square, as tall as it is wide.
    width,
    aspectRatio: 1,
    borderRadius: 20,
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
      <ServiceArt
        service={service}
        index={SERVICES.indexOf(service)}
        width={Math.round(width * 0.56)}
        muted={later}
      />
      <Type
        variant="bodyStrong"
        numberOfLines={1}
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
  // Three to a row, the rows centred, so a group of four ends on one card in the middle.
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
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
    },
  clip: {
    overflow: "hidden",
  },
  card: {
    backgroundColor: CARD,
    borderColor: CARD_EDGE,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // The frame takes the card's corners, or the web draws its shadow square.
  slideFrame: {
    borderRadius: 20,
  },
  // A short white card: the art's tile on the left, three lines on the right.
  slide: {
    // Fills its frame, so every slide in the strip stands as tall as the tallest.
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 12,
    borderRadius: 20,
  },
  slideArt: {
    width: 62,
    height: 62,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  slideWords: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  slideEyebrow: {
    fontSize: 12.5,
    lineHeight: 16,
    color: SUMMARY,
  },
  slideTitle: {
    fontSize: 15.5,
    lineHeight: 21,
    color: INK,
  },
  slideAct: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  slideActText: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 17,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: alpha(DEEP, 0.18),
  },
  dotOn: {
    width: 18,
    backgroundColor: theme.color.kola["600"],
  },
  reassure: {
    textAlign: "center",
    fontSize: 12.5,
    lineHeight: 18,
    color: SUMMARY,
    paddingHorizontal: space[4],
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  tileName: {
    maxWidth: "100%",
    lineHeight: 18,
    textAlign: "center",
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
