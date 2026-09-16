import Ionicons from "@expo/vector-icons/Ionicons";
import { Asset } from "expo-asset";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type LayoutRectangle,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Type, radius, space } from "@/components/ui";
import { WelcomeProgress } from "@/components/welcome/WelcomeProgress";
import { WelcomeWorld } from "@/components/welcome/WelcomeWorld";
import { WELCOME_ASSET_MODULES } from "@/components/welcome/scenes";
import { useReduceMotion } from "@/motion";
import { rememberOnboardingIntent, type OnboardingIntent } from "@/onboardingIntent";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";
import { hasSeenWelcome, rememberWelcomeSeen } from "@/welcomeSeen";

/**
 * The first thing anybody sees, once per installation.
 *
 * Rooomly is not a listings app, and the introduction has one job: to say so
 * before somebody decides what it is. A tenant and a provider are two ends of
 * the *same* record — a Unit, an agreement, rent, the months that follow — and
 * three screens are spent establishing that relationship rather than
 * advertising a search box.
 *
 * So the scenes are one street seen three ways: the neighbourhood, then one
 * home from the inside, then the same street held as a portfolio. `WelcomeWorld`
 * moves the camera; this file only says what each stop means.
 *
 * **The story is for first-timers; the choice is for everybody.** Somebody who
 * has seen it before opens on the last page — the three ways into Rooomly —
 * because making a person swipe through an introduction they have finished, to
 * reach the thing they came for, is a toll rather than a welcome. The journey is
 * still there: "Back to the beginning" replays it.
 *
 * That is also why this is one screen and not two. The last page is not a
 * separate landing that happens to look like the journey's end; it *is* the
 * journey's end, so returning simply means starting at the other side of it.
 *
 * The choice hands over to the existing full sign-in screen, carrying the
 * requested workspace. Authentication remains its own focused task rather than
 * being embedded into the final page of the introduction.
 */

type Scene = {
  eyebrow: string;
  headline: string;
  line: string;
};

/**
 * Three stops, and almost no words.
 *
 * Each is a headline somebody can read at a glance and one line underneath. The
 * picture is doing the explaining; §10.1 applies here more than anywhere,
 * because this is the one screen where nobody has any reason to persevere.
 */
const SCENES: Scene[] = [
  {
    eyebrow: "ROOOMLY",
    headline: "Property. Renting.\nConnected.",
    line: "Homes, the people in them, and everything between — in one place.",
  },
  {
    eyebrow: "FOR TENANTS",
    headline: "Your home,\nin one place.",
    line: "Your tenancy, your agreement and your rent. Not a folder of screenshots.",
  },
  {
    eyebrow: "FOR PROVIDERS",
    headline: "Manage property\nwithout the chaos.",
    line: "Properties, Units, tenants and rent — one record each, start to finish.",
  },
];

/** The scenes, then the question. */
const STOPS = SCENES.length + 1;

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const widthRef = useRef(width);
  widthRef.current = width;
  const pager = useRef<ScrollView>(null);
  /* The pager's offset, shared with the world behind it.
     `Animated.event` with `useNativeDriver` already kept this off the JS
     thread; what changes is that the value is now readable from any worklet,
     so the parallax and the progress rule interpolate it in the same place
     rather than each holding their own interpolation of the same number. */
  const scroll = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scroll.value = event.contentOffset.x;
  });
  const [frame, setFrame] = useState<LayoutRectangle | null>(null);
  const reduceMotion = useReduceMotion();

  /**
   * Where this opens. `null` until the local flag is read.
   *
   * Read before the first render rather than scrolled to afterwards: setting an
   * offset after mount is a visible jump from scene one, which is precisely the
   * introduction a returning person is being spared.
   */
  const [opensAt, setOpensAt] = useState<number | null>(null);
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      hasSeenWelcome(),
      // Bundled assets are decoded before any scene can ask for them. A missing
      // optional illustration must never trap the journey on its quiet ground.
      Asset.loadAsync(WELCOME_ASSET_MODULES).catch(() => []),
    ]).then(([seen]) => {
      if (!mounted) return;
      const opening = seen ? STOPS - 1 : 0;
      // `contentOffset` positions the native scroll view without necessarily
      // emitting an initial scroll event. Keep every interpolation on that same
      // coordinate before the pager is allowed to appear.
      scroll.value = opening * widthRef.current;
      setOpensAt(opening);
      // The pager mounts at an offset without scrolling to it, so no momentum
      // event ever fires and the controls would still think this is page one.
      setStop(opening);
    });
    return () => {
      mounted = false;
    };
  }, [scroll]);

  const [stop, setStop] = useState(0);
  const atEnd = stop >= STOPS - 1;

  function goTo(index: number) {
    if (reduceMotion) setStop(index);
    pager.current?.scrollTo({ x: index * width, animated: !reduceMotion });
  }

  function stopForOffset(offset: number) {
    return Math.max(0, Math.min(STOPS - 1, Math.round(offset / width)));
  }

  function finishMomentum(event: NativeSyntheticEvent<NativeScrollEvent>) {
    setStop(stopForOffset(event.nativeEvent.contentOffset.x));
  }

  function finishDrag(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (Platform.OS !== "ios") return;

    // iOS does not emit `onMomentumScrollEnd` when a page settles without
    // momentum. Its predicted resting offset is available at drag-end, so use
    // that to keep hit-testing in lockstep with the page the person can see.
    const offset =
      event.nativeEvent.targetContentOffset?.x ?? event.nativeEvent.contentOffset.x;
    setStop(stopForOffset(offset));
  }

  /**
   * Which side of the relationship this person is on.
   *
   * The choice is remembered as an onboarding intent — the same value the rest
   * of the flow already reads — and carried into sign-in as a workspace, so the
   * backend puts them where they asked to be rather than inferring it from
   * whatever they last were. Marking the introduction seen happens here and on
   * skip, so a person who chose is never shown it again.
   */
  async function choose(intent: OnboardingIntent) {
    await Promise.all([rememberOnboardingIntent(intent), rememberWelcomeSeen()]);

    // Browsing needs no account and no workspace: it is the one way in that
    // asks nothing of anybody.
    if (intent === "find_property") {
      router.replace("/(app)/(tabs)/explore");
      return;
    }

    router.push({
      pathname: "/(auth)/sign-in",
      params: { workspace: intent === "manage_property" ? "provider" : "tenant" },
    });
  }

  async function leave(destination: string) {
    await rememberWelcomeSeen();
    router.push(destination as never);
  }

  // A flat ground rather than a flash of the wrong page. The read is a local
  // one and resolves in milliseconds.
  if (opensAt === null) {
    return <View style={{ flex: 1, backgroundColor: theme.color.field["50"] }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.field["50"] }}>
      {/* The art sits behind everything and is never in the way of a control. */}
      <View
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: "62%" }}
        onLayout={(event) => {
          const next = event.nativeEvent.layout;
          setFrame((current) =>
            current
            && current.x === next.x
            && current.y === next.y
            && current.width === next.width
            && current.height === next.height
              ? current
              : next,
          );
        }}
      >
        <WelcomeWorld scroll={scroll} width={width} scenes={STOPS} frame={frame} />
      </View>

      <Animated.ScrollView
        ref={pager as never}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // 16ms: the parallax is driven straight from this value, so a coarser
        // throttle would show as the world stepping rather than moving.
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollEndDrag={finishDrag}
        onMomentumScrollEnd={finishMomentum}
        contentOffset={{ x: opensAt * width, y: 0 }}
        style={{ flex: 1 }}
      >
        {SCENES.map((scene) => (
          <SceneCopy key={scene.eyebrow} scene={scene} width={width} insets={insets.top} />
        ))}
        <RoleStop width={width} insets={insets.top} onChoose={choose} />
      </Animated.ScrollView>

      {/* Controls, held out of the swipe and clear of the home indicator. */}
      <View
        style={{
          paddingHorizontal: space[5],
          paddingBottom: insets.bottom + space[5],
          paddingTop: space[4],
        }}
      >
        <JourneyControls
          scroll={scroll}
          width={width}
          stops={STOPS}
          atEnd={atEnd}
          reduceMotion={reduceMotion}
          onReplay={() => goTo(0)}
          onSkip={() => void leave("/(auth)/sign-in")}
          onNext={() => goTo(stop + 1)}
          onSignUp={() => void leave("/(auth)/phone")}
        />
      </View>
    </View>
  );
}

/**
 * One stable footer with two visual layers.
 *
 * The old conditional replaced a 48pt row with a differently sized column at
 * `onMomentumScrollEnd`. That resized the flex pager above it, so every
 * bottom-aligned page visibly shifted after the swipe had already settled.
 * Both states now occupy the same fixed frame for the lifetime of the screen;
 * only native-driver opacity and transform values change.
 */
function JourneyControls({
  scroll,
  width,
  stops,
  atEnd,
  reduceMotion,
  onReplay,
  onSignUp,
  onSkip,
  onNext,
}: {
  scroll: SharedValue<number>;
  width: number;
  stops: number;
  atEnd: boolean;
  reduceMotion: boolean;
  onReplay: () => void;
  onSignUp: () => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  const start = (stops - 2) * width;
  const end = (stops - 1) * width;

  /* Two layers occupying the same 52pt, crossfading as the last scene arrives:
     the journey's controls leave as the choice arrives. Both are computed in
     one worklet per layer rather than as four separate interpolations of the
     same offset.

     `reduceMotion` still gates the four points of travel — it is the shift that
     is decorative, and the crossfade that carries the meaning, so the opacity
     is deliberately not gated with it. */
  const journeyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scroll.value, [start, end], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateY: reduceMotion
          ? 0
          : interpolate(scroll.value, [start, end], [0, -4], Extrapolation.CLAMP),
      },
    ],
  }));
  const choiceStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scroll.value, [start, end], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: reduceMotion
          ? 0
          : interpolate(scroll.value, [start, end], [4, 0], Extrapolation.CLAMP),
      },
    ],
  }));
  const layer = {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };

  return (
    <View style={{ height: 52 }}>
      <Animated.View
        pointerEvents={atEnd ? "none" : "auto"}
        accessibilityElementsHidden={atEnd}
        importantForAccessibility={atEnd ? "no-hide-descendants" : "auto"}
        style={[
          layer,
          {
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          },
          journeyStyle,
        ]}
      >
        <WelcomeProgress scroll={scroll} width={width} scenes={stops} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[4] }}>
          <Pressable
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip the introduction"
            hitSlop={12}
          >
            <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
              Skip
            </Type>
          </Pressable>
          <Pressable
            onPress={onNext}
            accessibilityRole="button"
            accessibilityLabel="Next"
            {...pressableFeedback(theme.color.kola["800"])}
            style={{
              width: theme.targetMin,
              height: theme.targetMin,
              borderRadius: radius.pill,
              backgroundColor: theme.color.kola["600"],
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="arrow-forward" size={22} color={theme.color.field["0"]} />
          </Pressable>
        </View>
      </Animated.View>

      <Animated.View
        pointerEvents={atEnd ? "auto" : "none"}
        accessibilityElementsHidden={!atEnd}
        importantForAccessibility={atEnd ? "auto" : "no-hide-descendants"}
        style={[
          layer,
          {
            alignItems: "center",
            justifyContent: "center",
            gap: space[3],
          },
          choiceStyle,
        ]}
      >
        <Pressable onPress={onSignUp} accessibilityRole="link" hitSlop={12}>
          <Type variant="bodyStrong" style={{ color: theme.color.kola["600"] }}>
            I don&apos;t have an account
          </Type>
        </Pressable>
        {/* The journey is never taken away. */}
        <Pressable
          onPress={onReplay}
          accessibilityRole="button"
          accessibilityLabel="Replay the introduction from the beginning"
          hitSlop={12}
        >
          <Type variant="caption" style={{ color: theme.color.ink["500"] }}>
            ← Back to welcome
          </Type>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function SceneCopy({
  scene,
  width,
  insets,
}: {
  scene: Scene;
  width: number;
  insets: number;
}) {
  return (
    <View
      style={{
        width,
        flex: 1,
        justifyContent: "flex-end",
        paddingHorizontal: space[5],
        paddingTop: insets + space[6],
        paddingBottom: space[6],
        gap: space[3],
      }}
    >
      <Type variant="label" style={{ color: theme.color.kola["600"] }}>
        {scene.eyebrow}
      </Type>
      <Type variant="display2" style={{ lineHeight: 40 }}>
        {scene.headline}
      </Type>
      <Type variant="body" style={{ color: theme.color.ink["700"], maxWidth: 320 }}>
        {scene.line}
      </Type>
    </View>
  );
}

/**
 * The only question the introduction asks.
 *
 * Two answers, because there are two sides to a tenancy. Browsing without an
 * account is still possible and still one tap away below — it is a way of
 * *using* Rooomly, not a third kind of person to be.
 */
function RoleStop({
  width,
  insets,
  onChoose,
}: {
  width: number;
  insets: number;
  onChoose: (intent: OnboardingIntent) => Promise<void>;
}) {
  return (
    <View
      style={{
        width,
        flex: 1,
        justifyContent: "flex-end",
        paddingHorizontal: space[5],
        paddingTop: insets + space[6],
        paddingBottom: space[6],
        gap: space[4],
      }}
    >
      <View style={{ gap: space[2] }}>
        <Type variant="display2">How will you{"\n"}use Rooomly?</Type>
        <Type variant="body" style={{ color: theme.color.ink["700"] }}>
          You can do more than one later.
        </Type>
      </View>

      <View style={{ gap: space[3] }}>
        <RoleCard
          icon="home"
          title="I'm a Tenant"
          body="My home & renting"
          onPress={() => void onChoose("current_tenant")}
        />
        <RoleCard
          icon="business"
          title="I manage property"
          body="Properties & tenants"
          onPress={() => void onChoose("manage_property")}
        />
        {/* No account, no workspace, no commitment — and drawn quieter than the
            two that lead somewhere lasting. */}
        <RoleCard
          icon="search"
          title="Just browsing"
          body="Public homes · no account needed"
          quiet
          onPress={() => void onChoose("find_property")}
        />
      </View>
    </View>
  );
}

function RoleCard({
  icon,
  title,
  body,
  onPress,
  quiet = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  onPress: () => void;
  /** Offered, but not one of the two that start a relationship. */
  quiet?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}.`}
      {...pressableFeedback(theme.color.kola["50"])}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space[4],
        minHeight: quiet ? 68 : 84,
        padding: space[4],
        backgroundColor: quiet ? "transparent" : theme.color.field["0"],
        borderWidth: 1,
        borderColor: quiet ? theme.color.field["200"] : theme.color.field["200"],
        borderRadius: radius.lg,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View
        style={{
          width: quiet ? 40 : 48,
          height: quiet ? 40 : 48,
          borderRadius: radius.pill,
          backgroundColor: quiet ? theme.color.field["100"] : theme.color.kola["50"],
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={icon}
          size={quiet ? 18 : 22}
          color={quiet ? theme.color.ink["500"] : theme.color.kola["600"]}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Type variant={quiet ? "bodyStrong" : "title2"}>{title}</Type>
        <Type variant="caption">{body}</Type>
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.color.ink["300"]} />
    </Pressable>
  );
}
