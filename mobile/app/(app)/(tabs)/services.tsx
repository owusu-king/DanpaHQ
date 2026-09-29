import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState, type ReactNode } from "react";
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
import { ServiceArt } from "@/components/services/ServiceArt";
import { ServiceGlyph, TONE } from "@/components/services/ServiceGlyph";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { SheetCard } from "@/components/sheet/SheetParts";
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
} from "@/serviceCatalogue";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * Services: what a household buys, beside the rent.
 *
 * **One question first, then the range** (product owner, 2026-09-27, after a
 * banking app's loans tab). The page opens on a picker — which service — and one
 * button that goes there, with a line under it saying what that costs today:
 * nothing. The button is a kola tint rather than a solid slab, so it leads
 * without weighing the page down. A row points to where the rent itself lives.
 * Then the catalogue, under one heading and no group names — the colours already
 * sort power from screens from the network — as compact white cards two to a
 * row: an illustration in its service's colour, its name and one short line.
 *
 * **Nothing here sells anything yet, and it does not pretend to.** No biller is
 * integrated and `apps.payments` registers no production adapter, so a service
 * that is `preparing` opens to what it will do and lets you save the number it
 * will need. The picker only offers those, the button says "Continue" rather
 * than anything that takes money, and `later` cards are not controls at all.
 */

const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];
const INK = theme.color.ink["900"];

/** Cards are paper on the ivory ground, edged rather than boxed in shadow. */
const CARD = WHITE;
const CARD_EDGE = theme.color.field["200"];
/** The short line under a service's name, and the page's other quiet words. */
const SUMMARY = theme.color.ink["500"];
/** A closed service's name: still read, no longer leading. */
const CLOSED = theme.color.ink["700"];
/** The clock on a service that is not open yet: present, and no louder than that. */
const FAINT = theme.color.ink["500"];
/**
 * The way in: kola, as a tint with deep kola words rather than a solid slab, so
 * the page's first thing is the question and not a button (owner, 2026-09-27).
 */
const ACTION = theme.color.kola["600"];
const ACTION_WASH = theme.color.kola["50"];
const ACTION_INK = theme.color.kola["800"];
/** The catalogue's closing label. */
const EYEBROW = theme.color.kola["800"];
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
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

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

  const openable = openableServices();
  // The picker starts on what this household already uses, else the first thing
  // that opens. It never holds a `later` service.
  const chosen =
    openable.find((service) => service.id === chosenId) ??
    openable.find((service) => service.id === saved[0]?.serviceId) ??
    openable[0];

  const openService = (service: Service) =>
    router.push({ pathname: "/(app)/service", params: { id: service.id } } as never);

  return (
    // The same page and ground as More, so the two hub tabs read as one product.
    // The header says "Services", so the page opens straight onto the question.
    <IndexPage>
      {error ? <Notice tone="info" title={error} /> : null}

      {chosen ? (
        <StartPanel
          service={chosen}
          onPick={() => setPicking(true)}
          onContinue={() => openService(chosen)}
        />
      ) : null}

      <RentRow onPress={() => router.push("/(app)/(tabs)/payments" as never)} />

      {/* Only when there is something to glance at. A strip of zeroes is not a
          shortcut, it is a reminder that nothing is set up. */}
      {!loaded ? <QuickSkeleton /> : null}
      {loaded && saved.length ? (
        <QuickAccess details={saved.slice(0, 6)} onOpen={openService} />
      ) : null}
      {loaded && recent.length ? <RecentActivity purchases={recent} /> : null}

      {/* One grid, in the catalogue's category order, with no group names over it:
          the colours already sort power from screens from the network. */}
      <Catalogue
        services={CATEGORIES.flatMap((category) => servicesIn(category.id))}
        savedCount={countByService(saved)}
        onOpen={openService}
      />

      <MoreServices />

      <ServicePicker
        visible={picking}
        services={openable}
        chosen={chosen}
        onClose={() => setPicking(false)}
        onChoose={(service) => {
          setChosenId(service.id);
          setPicking(false);
        }}
      />
    </IndexPage>
  );
}

function countByService(details: SavedDetail[]): Record<string, number> {
  return details.reduce<Record<string, number>>((totals, detail) => {
    totals[detail.serviceId] = (totals[detail.serviceId] ?? 0) + 1;
    return totals;
  }, {});
}

/** A section's name, in the page's one heading size. */
function SectionTitle({ children }: { children: string }) {
  const density = useHomeDensity();
  return (
    <Type
      variant="title2"
      accessibilityRole="header"
      style={{
        paddingHorizontal: space[1],
        fontSize: density.compact ? 19 : 20,
        lineHeight: 26,
        letterSpacing: -0.3,
        color: INK,
      }}
    >
      {children}
    </Type>
  );
}

/**
 * The question the page opens on: which service, and the way into it.
 *
 * The field is a control that looks like one — a label, the answer, a chevron —
 * rather than a row of chips, because the answer is one of six and the sheet is
 * where six can be read properly. The button goes to that service's own screen,
 * which is where saving its number happens; the line under it says, before the
 * tap, that nothing is charged.
 */
function StartPanel({
  service,
  onPick,
  onContinue,
}: {
  service: Service;
  onPick: () => void;
  onContinue: () => void;
}) {
  const density = useHomeDensity();
  // A narrow phone has room for the name alone; the sheet carries the summary.
  const narrow = useWindowDimensions().width < 360;
  return (
    <View style={{ gap: density.compact ? space[3] : space[4] }}>
      <PressableScale
        accessibilityLabel={`Service: ${service.label}. Change service.`}
        onPress={onPick}
        frame={[styles.lift, styles.round]}
        style={[styles.card, styles.select]}
      >
        <ServiceGlyph service={service} size={density.compact ? 36 : 40} />
        <View style={{ flex: 1, gap: 1 }}>
          <Type variant="caption" style={styles.selectLabel}>What do you need?</Type>
          <Type variant="bodyStrong" numberOfLines={1} style={styles.selectValue}>
            {narrow ? service.label : `${service.label} · ${service.summary}`}
          </Type>
        </View>
        <Ionicons name="chevron-down" size={20} color={INK} />
      </PressableScale>

      <PressableScale
        accessibilityLabel={`Continue to ${service.label}`}
        onPress={onContinue}
        frame={styles.round}
        style={styles.action}
      >
        <Type variant="bodyStrong" style={styles.actionText}>Continue</Type>
      </PressableScale>

      <Type variant="caption" style={styles.reassure}>
        <Type variant="captionStrong" style={styles.reassureStrong}>Nothing</Type> is charged — save your number for later
      </Type>
    </View>
  );
}

/**
 * Every service that opens, in a sheet, with the one in the field ticked. Only
 * these: a `later` service is not a choice the page can act on.
 */
function ServicePicker({
  visible,
  services,
  chosen,
  onClose,
  onChoose,
}: {
  visible: boolean;
  services: Service[];
  chosen: Service | undefined;
  onClose: () => void;
  onChoose: (service: Service) => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="What do you need?" closeLabel="Close services">
      <SheetCard>
        <View style={{ gap: space[1], paddingVertical: space[2] }}>
        {services.map((service) => {
          const selected = service.id === chosen?.id;
          return (
            <Pressable
              key={service.id}
              accessibilityRole="radio"
              aria-checked={selected}
              accessibilityLabel={`${service.label}. ${service.summary}.`}
              onPress={() => onChoose(service)}
              style={({ pressed }) => [
                styles.option,
                selected ? styles.optionSelected : null,
                pressed ? { opacity: 0.8 } : null,
              ]}
            >
              <ServiceGlyph service={service} size={40} />
              <View style={{ flex: 1, gap: 1 }}>
                <Type variant="bodyStrong" style={{ color: INK }}>{service.label}</Type>
                <Type variant="caption" style={{ color: SUMMARY }}>{service.summary}</Type>
              </View>
              {selected ? <Ionicons name="checkmark-circle" size={22} color={ACTION} /> : null}
            </Pressable>
          );
        })}
        </View>
      </SheetCard>
    </BottomSheet>
  );
}

/** Where the rent lives. Services is beside it, not instead of it. */
function RentRow({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale
      accessibilityLabel="Your rent is in Payments"
      onPress={onPress}
      frame={[styles.lift, styles.round]}
      style={[styles.card, styles.row]}
    >
      <Ionicons name="receipt-outline" size={24} color={INK} />
      <Type variant="bodyStrong" numberOfLines={1} style={styles.rowText}>
        Your rent is in Payments
      </Type>
      <Ionicons name="chevron-forward" size={18} color={SUMMARY} />
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

/** The range: one heading, then every service as a card, two to a row. */
function Catalogue({
  services,
  savedCount,
  onOpen,
}: {
  services: Service[];
  savedCount: Record<string, number>;
  onOpen: (service: Service) => void;
}) {
  const density = useHomeDensity();
  return (
    <View style={{ gap: density.compact ? space[3] : space[4] }}>
      <SectionTitle>Explore our range of offers</SectionTitle>
      <View style={[styles.grid, { rowGap: density.compact ? 10 : 12 }]}>
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
 * One service, as a card: its illustration, its name and one short line.
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
    // A rounded square: as tall as it is wide, with what is left over between
    // the art and the words.
    aspectRatio: 1,
    padding: density.compact ? space[3] : 14,
    borderRadius: 18,
  };

  const body = (
    <>
      <View style={styles.tileTop}>
        <ServiceArt
          service={service}
          index={SERVICES.indexOf(service)}
          width={density.compact ? 64 : 72}
          muted={later}
        />
        {later ? (
          <View style={styles.clock}>
            <Ionicons name="time-outline" size={13} color={FAINT} />
          </View>
        ) : savedCount ? (
          <View style={[styles.saved, { backgroundColor: tone.wash }]}>
            <Ionicons name="checkmark-circle" size={12} color={tone.ink} />
            <Type variant="captionStrong" style={[styles.savedText, { color: tone.ink }]}>
              {savedCount}
            </Type>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 2 }}>
        <Type
          variant="bodyStrong"
          numberOfLines={1}
          style={{
            fontSize: density.compact ? 15 : 16,
            lineHeight: density.compact ? 20 : 21,
            color: later ? CLOSED : INK,
          }}
        >
          {service.label}
        </Type>
        <Type
          variant="caption"
          numberOfLines={2}
          style={{ fontSize: 12.5, lineHeight: 17, minHeight: 34, color: SUMMARY }}
        >
          {service.summary}
        </Type>
      </View>
    </>
  );

  if (later) {
    return (
      <View
        accessible
        accessibilityLabel={`${service.label}. ${service.summary}. Coming later.`}
        style={[styles.tile, styles.card, shape, { width: TILE_WIDTH }]}
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
      style={[styles.tile, styles.card, styles.fill, shape]}
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
  const scale = useRef(new Animated.Value(1)).current;

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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
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
  // The shadow frame takes the card's corners, or the web draws its shadow square.
  round: {
    borderRadius: 18,
  },
  clip: {
    overflow: "hidden",
  },
  card: {
    backgroundColor: CARD,
    borderColor: CARD_EDGE,
    borderWidth: StyleSheet.hairlineWidth,
  },
  select: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: 18,
  },
  selectLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: SUMMARY,
  },
  selectValue: {
    fontSize: 16,
    lineHeight: 22,
    color: INK,
  },
  action: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: alpha(ACTION, 0.22),
    backgroundColor: ACTION_WASH,
  },
  actionText: {
    fontSize: 16,
    color: ACTION_INK,
  },
  reassure: {
    textAlign: "center",
    color: SUMMARY,
    paddingHorizontal: space[2],
  },
  reassureStrong: {
    color: INK,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[3],
    paddingVertical: space[2] + 2,
    borderRadius: 14,
  },
  optionSelected: {
    backgroundColor: theme.color.kola["50"],
  },
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    borderRadius: 18,
  },
  rowText: {
    flex: 1,
    fontSize: 15.5,
    color: INK,
  },
  tile: {
    justifyContent: "space-between",
    gap: space[2],
    overflow: "hidden",
  },
  // Only the pressable fills its frame, so cards in one row stand equally tall.
  // A grid item that grew would eat the gap between the two.
  fill: {
    flexGrow: 1,
  },
  tileTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[2],
  },
  clock: {
    width: 24,
    height: 24,
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
