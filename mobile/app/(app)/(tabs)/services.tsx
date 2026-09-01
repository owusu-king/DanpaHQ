import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, View } from "react-native";

import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { ServiceGlyph } from "@/components/services/ServiceGlyph";
import { Notice, Surface, Type, radius, space } from "@/components/ui";
import { useReduceMotion } from "@/motion";
import { isAndroid } from "@/platform";
import {
  detailTitle,
  listRecentPurchases,
  listSavedDetails,
  type RecentPurchase,
  type SavedDetail,
} from "@/serviceAccounts";
import { formatMinor } from "@/listings";
import { CATEGORIES, serviceById, servicesIn, type Service } from "@/serviceCatalogue";
import { theme } from "@/theme";

/**
 * Services: what a household buys, beside the rent.
 *
 * **Glance → Understand → Act**, in that order down the page. Anything already
 * set up sits at the top as a one-tap repeat. Below it the catalogue is grouped
 * the way a person thinks about a house — power and water, screens, network,
 * people who come round — with one rule per row and colour doing the sorting so
 * a thumb finds Electricity without reading four labels.
 *
 * **Not a grid of tiles.** A tile has to be big enough to hold an icon and a
 * word, which means four fit on a screen, which means a nine-service catalogue
 * becomes three screens of scrolling and no hierarchy at all. Ruled rows inside
 * one surface per category fit the whole hub above the fold and let spacing and
 * type carry the structure instead of chrome.
 *
 * **Nothing here sells anything yet, and it does not pretend to.** No biller is
 * integrated and `apps.payments` registers no production adapter, so a service
 * that is `preparing` opens to what it will do and lets you save the number it
 * will need. That is a real thing to do today and it is why those rows are
 * pressable; `later` rows are not controls at all.
 */
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
    <ScrollView
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[6] }}
    >
      <View style={{ gap: space[1] }}>
        <Type variant="label">YOUR HOUSEHOLD</Type>
        <Type variant="display2" accessibilityRole="header">
          Services
        </Type>
        <Type variant="body" style={{ color: theme.color.ink["700"] }}>
          Power, screens, network and the people who come round — paid for in one place.
        </Type>
      </View>

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
          blurb={category.blurb}
          services={servicesIn(category.id)}
          savedCount={countByService(saved)}
          onOpen={openService}
        />
      ))}

      <MoreServices />
    </ScrollView>
  );
}

function countByService(details: SavedDetail[]): Record<string, number> {
  return details.reduce<Record<string, number>>((totals, detail) => {
    totals[detail.serviceId] = (totals[detail.serviceId] ?? 0) + 1;
    return totals;
  }, {});
}

/**
 * The saved numbers, as a horizontal strip of one-tap repeats.
 *
 * Ordered by use, so the meter this household actually tops up leads and the
 * one they saved once sits behind it. Horizontal because these are shortcuts
 * past the page, not part of it — a vertical list here would compete with the
 * catalogue for the same reading.
 */
function QuickAccess({
  details,
  onOpen,
}: {
  details: SavedDetail[];
  onOpen: (service: Service) => void;
}) {
  return (
    <View style={{ gap: space[3] }}>
      <Type variant="label">SET UP AND READY</Type>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space[3], paddingRight: space[5] }}
      >
        {details.map((detail) => {
          const service = serviceById(detail.serviceId);
          if (!service) return null;
          return (
            <PressableScale
              key={`${detail.serviceId}:${detail.value}`}
              accessibilityLabel={`${service.label}, ${detailTitle(detail)}`}
              onPress={() => onOpen(service)}
            >
              <View style={styles.quickCard}>
                <ServiceGlyph service={service} size={32} />
                <View style={{ gap: space[1] / 2 }}>
                  <Type variant="bodyStrong" numberOfLines={1}>
                    {service.label}
                  </Type>
                  <Type variant="caption" numberOfLines={1}>
                    {detailTitle(detail)}
                  </Type>
                </View>
              </View>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** The same shape as the strip, before it has loaded. Not a spinner. */
function QuickSkeleton() {
  return (
    <View style={{ gap: space[3] }} accessibilityLabel="Loading your saved services">
      <View style={[styles.bone, { width: 132, height: 12 }]} />
      <View style={{ flexDirection: "row", gap: space[3] }}>
        <View style={[styles.bone, styles.quickCard, { height: 88 }]} />
        <View style={[styles.bone, styles.quickCard, { height: 88 }]} />
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
  return (
    <View style={{ gap: space[3] }}>
      <Type variant="label">RECENT</Type>
      <Surface style={{ paddingVertical: space[1] }}>
        {purchases.map((purchase, index) => {
          const service = serviceById(purchase.serviceId);
          if (!service) return null;
          return (
            <View
              key={purchase.id}
              style={[styles.row, index === 0 ? null : styles.ruled]}
            >
              <ServiceGlyph service={service} size={36} />
              <View style={{ flex: 1, gap: space[1] / 2 }}>
                <Type variant="bodyStrong">{service.label}</Type>
                <Type variant="caption" numberOfLines={1}>
                  {purchase.maskedValue}
                </Type>
              </View>
              <Type variant="bodyStrong">
                {formatMinor(purchase.amountMinor, purchase.currency)}
              </Type>
            </View>
          );
        })}
      </Surface>
    </View>
  );
}

/**
 * One category: a heading, a line of context, and its services as ruled rows.
 *
 * The heading is type and space rather than a card header. Four cards holding
 * four cards is how a hub turns into a dashboard.
 */
function CategoryBlock({
  title,
  blurb,
  services,
  savedCount,
  onOpen,
}: {
  title: string;
  blurb: string;
  services: Service[];
  savedCount: Record<string, number>;
  onOpen: (service: Service) => void;
}) {
  if (!services.length) return null;
  return (
    <View style={{ gap: space[3] }}>
      <View style={{ gap: space[1] / 2 }}>
        <Type variant="title2">{title}</Type>
        <Type variant="caption">{blurb}</Type>
      </View>
      <Surface style={{ paddingVertical: space[1] }}>
        {services.map((service, index) => (
          <ServiceRow
            key={service.id}
            service={service}
            first={index === 0}
            savedCount={savedCount[service.id] ?? 0}
            onPress={service.status === "later" ? undefined : () => onOpen(service)}
          />
        ))}
      </Surface>
    </View>
  );
}

/**
 * One service.
 *
 * A `later` row is not a `Pressable`. A disabled control still invites a tap and
 * answers with nothing, which teaches people the screen is broken; a row that
 * was never a control says the same thing without the rejection.
 */
function ServiceRow({
  service,
  first,
  savedCount,
  onPress,
}: {
  service: Service;
  first: boolean;
  savedCount: number;
  onPress?: () => void;
}) {
  const later = service.status === "later";

  const body = (
    <View style={[styles.row, first ? null : styles.ruled]}>
      <ServiceGlyph service={service} muted={later} />
      <View style={{ flex: 1, gap: space[1] / 2 }}>
        <Type variant="bodyStrong" style={later ? { color: theme.color.ink["500"] } : undefined}>
          {service.label}
        </Type>
        <Type variant="caption" numberOfLines={1}>
          {savedCount
            ? `${savedCount} saved · ${service.summary}`
            : service.summary}
        </Type>
      </View>
      {later ? (
        <Type variant="caption" style={{ color: theme.color.ink["300"] }}>
          Coming later
        </Type>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={theme.color.ink["300"]} />
      )}
    </View>
  );

  if (later) {
    return (
      <View
        accessible
        accessibilityLabel={`${service.label}. ${service.summary}. Coming later.`}
      >
        {body}
      </View>
    );
  }

  return (
    <PressableScale
      accessibilityLabel={`${service.label}. ${service.summary}.`}
      onPress={onPress}
    >
      {body}
    </PressableScale>
  );
}

/**
 * The end of the list, said plainly.
 *
 * Quiet on purpose: it is the only block on the page with nothing behind it, so
 * it gets no surface, no icon and no colour. It closes the catalogue instead of
 * competing with it.
 */
function MoreServices() {
  return (
    <View style={styles.more}>
      <Type variant="label">MORE SERVICES</Type>
      <Type variant="caption">
        Coming soon. Tell us what your household pays for and we will look at it next.
      </Type>
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
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
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
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onPressIn={() => animate(0.98)}
        onPressOut={() => animate(1)}
        android_ripple={isAndroid ? { color: theme.color.kola["50"] } : undefined}
        style={({ pressed }) => (pressed && !isAndroid ? { opacity: 0.72 } : null)}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = {
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: theme.targetMin,
    paddingVertical: space[3],
    paddingHorizontal: space[1],
  },
  ruled: {
    borderTopWidth: 1,
    borderTopColor: theme.color.field["200"],
  },
  quickCard: {
    width: 150,
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.color.field["200"],
    backgroundColor: theme.color.field["0"],
  },
  bone: {
    borderRadius: radius.md,
    backgroundColor: theme.color.field["100"],
  },
  more: {
    gap: space[2],
    paddingTop: space[5],
    borderTopWidth: 1,
    borderTopColor: theme.color.field["200"],
  },
} as const;
