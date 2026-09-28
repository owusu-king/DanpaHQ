import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { IndexGround } from "@/components/account/IndexRows";
import { TONE } from "@/components/services/ServiceGlyph";
import { Type, space } from "@/components/ui";
import { rememberOnboardingIntent } from "@/onboardingIntent";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * What a tab shows somebody who has not signed in.
 *
 * It used to be a `display2` heading, an info `Notice` carrying the body copy,
 * and a `Button` labelled "Sign In" — on bare ivory, while the signed-in
 * version of the same tab stood on the hub's green ground behind frosted glass.
 * So the tab changed character at the moment somebody signed in, and the state
 * most likely to be a person's *first* look at Payments or Services was the one
 * that had had no design attention: a notice box used as a paragraph is a
 * warning shape carrying no warning, and it is the only thing on the page.
 *
 * What it is now:
 *
 * - **The same ground as the tab it stands in.** `IndexGround`, so signing in
 *   changes the contents and nothing else.
 * - **A reason, not a demand.** Two or three lines saying what signing in gets
 *   you *here* — this tab's own promises, in this tab's own colour — before the
 *   act that asks for something. A wall that only says "Sign In" is a toll.
 * - **One act, in kola**, the weight the auth flow gives its single act, with
 *   the way to make an account beside it rather than hidden behind it. Somebody
 *   who has never signed up cannot use a screen whose only control assumes they
 *   already have.
 *
 * The workspace intent is still remembered before handing over, and `next` is
 * still carried, so the tab they were standing in is the tab they come back to.
 */

const DEEP = theme.color.kola["900"];
const KOLA = theme.color.kola["600"];
const WHITE = theme.color.field["0"];

const GLASS = alpha(WHITE, 0.72);
const EDGE = alpha(DEEP, 0.08);
const RULE = alpha(DEEP, 0.08);

export type PromptPoint = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
};

export function AuthPrompt({
  icon,
  tone = "kola",
  title,
  body,
  next,
  points,
}: {
  /** The tab's own glyph, so the page is recognisably this tab and not a wall. */
  icon: keyof typeof Ionicons.glyphMap;
  tone?: keyof typeof TONE;
  title: string;
  body: string;
  next: string;
  /** What signing in gets you here. Two or three; never a manifesto. */
  points?: PromptPoint[];
}) {
  const router = useRouter();
  const hue = TONE[tone];
  const pageBottom = useSafeBottom(space[10]);

  // Sign-in, not sign-up: most people tapping this already have an account, and
  // the sign-in screen is the one place that offers both. The intent is written
  // down first so the backend opens the experience they were already using.
  const go = (pathname: "/(auth)/sign-in" | "/(auth)/phone") =>
    void rememberOnboardingIntent("find_property").then(() =>
      router.push({ pathname, params: { next, intent: "find_property" } }),
    );

  return (
    <IndexGround>
      <View style={[styles.page, { paddingBottom: pageBottom }]}>
        <View style={styles.block}>
          <View style={[styles.emblem, { backgroundColor: hue.wash }]}>
            <Ionicons name={icon} size={28} color={hue.ink} />
          </View>

          <View style={styles.heading}>
            <Type variant="display3" style={styles.title}>
              {title}
            </Type>
            <Type variant="body" style={styles.body}>
              {body}
            </Type>
          </View>

          {points?.length ? (
            <View style={styles.points}>
              {points.map((point, index) => (
                <View key={point.label}>
                  {index > 0 ? <View style={styles.rule} /> : null}
                  <View style={styles.point}>
                    <Ionicons name={point.icon} size={18} color={hue.ink} />
                    <Type variant="caption" style={styles.pointLabel}>
                      {point.label}
                    </Type>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <PromptAct label="Sign in" onPress={() => go("/(auth)/sign-in")} />

          <View style={styles.aside}>
            <Type variant="caption">New to Rooomly?</Type>
            <Pressable
              onPress={() => go("/(auth)/phone")}
              accessibilityRole="link"
              hitSlop={12}
              {...pressableFeedback(theme.color.kola["50"])}
              style={styles.link}
            >
              <Type variant="bodyStrong" style={styles.linkText}>
                Create an account
              </Type>
            </Pressable>
          </View>
        </View>
      </View>
    </IndexGround>
  );
}

/** The one act, at the weight the auth flow gives its own. */
function PromptAct({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...pressableFeedback(WHITE)}
      style={({ pressed }) => [styles.act, pressed ? styles.actPressed : null]}
    >
      <Type variant="bodyStrong" style={styles.actText}>
        {label}
      </Type>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: space[5],
  },
  // Capped and centred: these tabs are reachable on a tablet, where a
  // full-bleed column of reassurance reads as a billboard.
  block: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    alignItems: "center",
    gap: space[4],
  },
  emblem: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    gap: space[2],
    alignItems: "center",
  },
  title: {
    textAlign: "center",
    color: theme.color.ink["900"],
  },
  body: {
    textAlign: "center",
    color: theme.color.ink["700"],
    maxWidth: 320,
  },
  points: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
    overflow: "hidden",
  },
  point: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  pointLabel: {
    flex: 1,
    color: theme.color.ink["800"],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 18 + space[3] + space[4],
    backgroundColor: RULE,
  },
  act: {
    width: "100%",
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space[5],
    borderRadius: 16,
    backgroundColor: KOLA,
    overflow: "hidden",
  },
  actPressed: {
    backgroundColor: theme.color.kola["800"],
  },
  actText: {
    color: WHITE,
  },
  aside: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
  },
  link: {
    minHeight: theme.targetMin,
    justifyContent: "center",
  },
  linkText: {
    color: KOLA,
  },
});
