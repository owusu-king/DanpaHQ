import Ionicons from "@expo/vector-icons/Ionicons";
import { Children, forwardRef, isValidElement, useImperativeHandle, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FieldEdge, Rise } from "@/components/auth/AuthMotion";
import { ph } from "@/components/home/plinth";
import { HeaderChromeBackground } from "@/components/nav/HeaderChromeBackground";
import { Type, space } from "@/components/ui";
import { isIOS, maxFontSizeMultiplier, otpInputProps, pressableFeedback } from "@/platform";
import { alpha, shell } from "@/shell";
import { theme } from "@/theme";

/**
 * The ground every auth screen stands on, and the parts they are all made of.
 *
 * Signing in used to open on flat ivory under a 132-point band that drew a
 * gradient and nothing else — the crest was built to carry an illustration that
 * was never drawn, so in every build anybody has actually run it was empty
 * space at the top of the one screen most launches end on.
 *
 * What replaced it is a composition rather than a header:
 *
 * - **The colour is in the ground.** A warm dawn over the top half of the page —
 *   Danpa HQ's green let down into the ivory, a gold bloom off one corner and a
 *   deeper green off the other. It cannot be empty, it is the same on every
 *   screen in the flow, and the surfaces on top of it lift by tone alone.
 * - **The column is centred and bounded.** Auth is the one part of this product
 *   with no navigation and almost no content, so a full-bleed page leaves a
 *   void in the middle and stretches a two-field form across a tablet. The
 *   block sits in the optical centre of whatever screen it is on, capped at a
 *   readable measure.
 * - **Fields are rows of one surface, not a stack of boxes.** Each field used to
 *   carry its own label above its own bordered shell, so five fields were five
 *   floating rectangles and ten separate elements. Grouped, the card is the
 *   frame and a hairline is the join — which is also what makes the number and
 *   the password read as one credential rather than two questions.
 * - **The order never changes**: mark, heading, one supporting line, the form,
 *   the one act, then everything else as text.
 *
 * **Redesigned on the product's own look (owner, 2026-10-06).** The dawn read
 * as decoration rather than as Danpa HQ: every page past sign-in opens on the
 * textured green chrome with a pale panel rising under it, and these did not.
 * So an auth screen is now built the way the Homes are — the green hero carries
 * the mark, the way back, the step marks and the heading in white, and the form
 * stands on the dashboards' pale green in a rounded panel that rises over the
 * hero's foot, on white cards. The order is unchanged.
 *
 * The frame is here rather than in each screen for one unglamorous reason too:
 * the bottom inset. Android draws edge-to-edge, and eight of these nine screens
 * had their last control sitting under the navigation buttons.
 */

const DEEP = theme.color.kola["900"];
const KOLA = theme.color.kola["600"];
const INK = theme.color.ink["900"];
const WHITE = theme.color.field["0"];
const MUTED = theme.color.ink["500"];
const ALERT = theme.color.laterite["600"];

/** A card on the panel: white paper, as the dashboards' are. */
const GLASS = WHITE;
/** How strong a press ripple is: a wash of the card's colour, never the colour itself. */
const RIPPLE = 0.12;
const EDGE = alpha(DEEP, 0.09);
const JOIN = alpha(DEEP, 0.07);
const CHEVRON = alpha(DEEP, 0.3);
const PANEL_RADIUS = 20;
/** The icon column of a field row: the icon and the gap after it. */
const MESSAGE_INDENT = 20 + space[4];
/** How far the panel rises over the hero's foot, and its corner: the Homes' own. */
const RISE = 28;

/** The widest the column is allowed to get, whatever the screen is. */
const MEASURE = 440;

/** Which hue a card, a tile or a field is carrying. */
export type AuthTone = "kola" | "lagoon" | "gold";

const TONE: Record<AuthTone, { ink: string; wash: string }> = {
  kola: { ink: KOLA, wash: theme.color.kola["50"] },
  lagoon: { ink: theme.color.lagoon["600"], wash: theme.color.lagoon["100"] },
  gold: { ink: theme.color.gold["600"], wash: theme.color.gold["50"] },
};

/** Whether a child belongs in the green hero rather than on the panel. */
function inHero(child: ReactNode): boolean {
  return isValidElement(child) && (child.type === AuthMark || child.type === AuthHeading);
}

/**
 * An auth screen: the green hero, the panel that rises over it, a keyboard that
 * gets out of the way, and both insets.
 *
 * Screens keep composing themselves the way they always have — mark, heading,
 * then the body — and the frame sorts them: the mark and the heading go up into
 * the hero, in white on the green, and everything after them stands on the
 * panel. The way back and the step marks ride the hero's top line.
 */
export function AuthScene({
  children,
  header,
  progress,
}: {
  children: ReactNode;
  /**
   * The way back.
   *
   * Pinned to the top of the hero rather than passed as the first child, so it
   * is always where a way back is on every other screen in the app.
   */
  header?: ReactNode;
  /**
   * How far through a journey this screen is: short marks on the hero's top
   * line, never mistaken for the way back beside them.
   */
  progress?: { step: number; of: number };
}) {
  const insets = useSafeAreaInsets();
  const all = Children.toArray(children);
  const hero = all.filter(inHero);
  const body = all.filter((child) => !inHero(child));
  const crown = Boolean(header || progress);
  const bottom = insets.bottom + space[6];

  return (
    <View style={styles.ground}>
      <KeyboardAvoidingView style={styles.fill} behavior={isIOS ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.page, { paddingBottom: bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={[styles.hero, { paddingTop: insets.top + space[3] }]}>
            <HeaderChromeBackground edge={false} />
            <View style={styles.heroInner}>
              {crown ? (
                <View style={styles.crownInner}>
                  {header ?? <View />}
                  {progress ? <AuthProgress step={progress.step} of={progress.of} /> : null}
                </View>
              ) : null}
              {hero.length ? <View style={styles.heroBody}>{hero}</View> : null}
            </View>
          </View>
          {/* The hero stays put; the step's own content rises in on the panel,
              so moving through the journey reads as one surface changing its
              question rather than a page being replaced. */}
          <View style={styles.panel}>
            <Rise style={styles.column}>{body}</Rise>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Danpa HQ, in white on the green, at the top of the hero. A mark, not a
 * heading — the heading is the next line — so it is set small and never scaled
 * by the reader's font size.
 */
export function AuthMark() {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Danpa HQ" style={styles.mark}>
      <View style={styles.markDot}>
        <Ionicons name="home" size={14} color={KOLA} />
      </View>
      <Type variant="bodyStrong" allowFontScaling={false} style={styles.markWord}>
        Danpa HQ
      </Type>
    </View>
  );
}

/**
 * What this screen is asking, in white on the hero: the heading and one line
 * under it. `display3`, because at 40 points "Sign in to manage your property"
 * took two enormous lines and became the screen.
 */
export function AuthHeading({
  title,
  line,
}: {
  title: string;
  line?: string;
}) {
  return (
    <View style={styles.heading}>
      <Type variant="display3" style={styles.title}>
        {title}
      </Type>
      {line ? (
        <Type variant="caption" style={styles.line}>
          {line}
        </Type>
      ) : null}
    </View>
  );
}

/**
 * How far through a journey somebody is: short white marks on the hero. The
 * step is still spoken — the label is the whole sentence.
 */
export function AuthProgress({ step, of }: { step: number; of: number }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${of}`}
      aria-valuenow={step}
      aria-valuemin={1}
      aria-valuemax={of}
      style={styles.progress}
    >
      {Array.from({ length: of }).map((_, index) => {
        const done = index < step - 1;
        const here = index === step - 1;
        return (
          <View key={index} style={[styles.tick, here ? styles.tickHere : done ? styles.tickDone : null]} />
        );
      })}
    </View>
  );
}

/**
 * The fields of one question, as rows of a single surface.
 *
 * This is the piece that stops an auth screen reading as a pile of inputs. The
 * card carries the border, the depth and the radius once; each field inside is
 * a row, and a hairline inset past the icon column is the join between them.
 */
export function AuthFields({ children }: { children: ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : [children];

  return (
    <View style={styles.fieldCard}>
      {rows.map((row, index) => (
        <View key={index}>
          {index > 0 ? <View style={styles.join} /> : null}
          {row}
        </View>
      ))}
    </View>
  );
}

/**
 * One field: an icon, its name, and what you are typing.
 *
 * The name sits inside the row above the value rather than floating above the
 * frame, which is what lets several fields share one surface. Focus tints the
 * row and lights the icon; an error tints it the other way and says what is
 * wrong on the line underneath, inside the same card, so a message can never be
 * mistaken for belonging to the field below it.
 */
export const AuthField = forwardRef<TextInput, TextInputProps & {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  error?: string;
  hint?: string;
  prefix?: string;
  action?: ReactNode;
}>(function AuthField(
  { label, icon, error, hint, prefix, action, style, onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const wrong = Boolean(error);
  const input = useRef<TextInput>(null);
  useImperativeHandle(ref, () => input.current as TextInput);

  return (
    // The whole row is the target, not the one line of text inside it: a tap
    // on the icon, the label or the padding puts the cursor in the field. The
    // input keeps its own accessibility, so the row adds no second element.
    <Pressable accessible={false} onPress={() => input.current?.focus()} style={styles.row}>
      <FieldEdge focused={focused} wrong={wrong} />
      <View style={styles.rowTop}>
        <Ionicons
          name={icon}
          size={20}
          color={wrong ? ALERT : focused ? KOLA : theme.color.ink["300"]}
          style={styles.rowIcon}
        />
        <View style={styles.rowBody}>
          <Type
            variant="caption"
            allowFontScaling={false}
            style={[styles.rowLabel, focused ? { color: KOLA } : null, wrong ? { color: ALERT } : null]}
          >
            {label}
          </Type>
          <View style={styles.rowValue}>
            {prefix ? (
              // The input's own type, size for size, so "+233" and the number
              // typed after it share one baseline.
              <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={styles.rowPrefix}>
                {prefix}
              </Text>
            ) : null}
            <TextInput
              ref={input}
              {...props}
              accessibilityLabel={label}
              accessibilityHint={hint}
              maxFontSizeMultiplier={maxFontSizeMultiplier}
              placeholderTextColor={theme.color.ink["300"]}
              onFocus={(event) => {
                setFocused(true);
                onFocus?.(event);
              }}
              onBlur={(event) => {
                setFocused(false);
                onBlur?.(event);
              }}
              style={[styles.input, style]}
            />
          </View>
        </View>
        {action}
      </View>
      {error ? (
        <Type
          variant="caption"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.rowError}
        >
          {error}
        </Type>
      ) : hint ? (
        <Type variant="caption" style={styles.rowHint}>
          {hint}
        </Type>
      ) : null}
    </Pressable>
  );
});

/**
 * Six boxes, with one real input behind them.
 *
 * Six separate inputs break autofill, break paste and fight the backspace key,
 * so the boxes are presentation and a single hidden field holds the value.
 *
 * It lives here because two screens ask for a code — the sign-up verification
 * and the middle step of a password reset — and only one of them had this. The
 * reset asked for the same six digits in a plain labelled field, so the same
 * task looked like two different tasks depending on which door you came in by,
 * and a fix to one never reached the other.
 */
export function CodeCells({
  value,
  onChangeText,
  error = false,
  autoFocus = false,
  length = 6,
  inputRef,
}: {
  value: string;
  onChangeText: (value: string) => void;
  error?: boolean;
  autoFocus?: boolean;
  length?: number;
  /** Passed when the screen needs to put focus back, as after a refused code. */
  inputRef?: RefObject<TextInput | null>;
}) {
  const own = useRef<TextInput>(null);
  const field = inputRef ?? own;

  return (
    <Pressable onPress={() => field.current?.focus()} accessibilityRole="none" accessible={false}>
      <View style={styles.cells}>
        {Array.from({ length }).map((_, index) => {
          const active = index === value.length;
          return (
            <View
              key={index}
              style={[
                styles.cell,
                active ? styles.cellActive : null,
                error ? styles.cellWrong : null,
              ]}
            >
              <Type variant="title1" style={styles.digit}>
                {index < value.length ? value[index] : ""}
              </Type>
            </View>
          );
        })}
      </View>

      <TextInput
        ref={field}
        value={value}
        onChangeText={onChangeText}
        autoFocus={autoFocus}
        maxLength={length}
        accessibilityLabel={`${length} digit code`}
        accessibilityHint="Enter the code we sent by text message"
        style={styles.hiddenInput}
        {...otpInputProps}
      />
    </Pressable>
  );
}

/** The eye on a password row, drawn as part of the row rather than beside it. */
export function RevealToggle({ shown, onPress }: { shown: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={shown ? "Hide password" : "Show password"}
      hitSlop={12}
      style={styles.reveal}
    >
      <Ionicons name={shown ? "eye-off-outline" : "eye-outline"} size={20} color={MUTED} />
    </Pressable>
  );
}

/**
 * The one act a screen is for.
 *
 * Kola rather than the shared `Button`'s ink, because these screens stand on a
 * green dawn and a near-black slab in the middle of it reads as a foreign
 * object. Disabled is a quiet neutral rather than a faded green: a washed-out
 * version of the live colour reads as broken, where a grey one reads as "not
 * yet". Everything that is not this act is a line of text.
 */
export function AuthAction({
  label,
  busyLabel = "Working…",
  onPress,
  busy = false,
  disabled = false,
}: {
  label: string;
  busyLabel?: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const inactive = busy || disabled;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      aria-disabled={inactive}
      aria-busy={busy}
      accessibilityLabel={busy ? busyLabel : label}
      {...pressableFeedback(WHITE)}
      style={({ pressed }) => [
        styles.action,
        disabled && !busy ? styles.actionOff : null,
        pressed && !inactive ? styles.actionPressed : null,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={WHITE} /> : null}
      <Type
        variant="bodyStrong"
        style={[styles.actionText, disabled && !busy ? styles.actionTextOff : null]}
      >
        {busy ? busyLabel : label}
      </Type>
    </Pressable>
  );
}

/**
 * Everything under the act.
 *
 * One centred block with room between its lines, so "Forgot your password?",
 * "Create an account" and "Browse without an account" read as a short list of
 * ways on rather than as three strays at different heights.
 */
export function AuthFoot({ children }: { children: ReactNode }) {
  return <View style={styles.foot}>{children}</View>;
}

/** A sentence with a tappable word in it, kept on one line. */
export function AuthAside({ children }: { children: ReactNode }) {
  return <View style={styles.aside}>{children}</View>;
}

/**
 * A way in: an icon in its own hue, a name, and a line saying what it gets you.
 *
 * `quiet` is for the way in that asks nothing of anybody — it is offered, but it
 * is not one of the two that start a relationship, and drawing all three alike
 * would make that a three-way decision instead of a two-way one.
 */
export function ChoiceCard({
  icon,
  tone,
  title,
  body,
  quiet = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: AuthTone;
  title: string;
  body: string;
  quiet?: boolean;
  onPress: () => void;
}) {
  const hue = TONE[tone];

  return (
    // Android draws a press ripple as a plain rectangle whatever the corners, and
    // it was drawn in the card's full ink: a tap flashed a dark box over the card.
    // The ripple is now a faint wash of that colour, clipped to the card's shape.
    <View style={styles.cardClip}>
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}.`}
      {...pressableFeedback(alpha(hue.ink, RIPPLE))}
      style={({ pressed }) => [styles.card, quiet ? styles.cardQuiet : null, pressed ? styles.cardPressed : null]}
    >
      <View style={[styles.tile, quiet ? styles.tileQuiet : null, { backgroundColor: hue.wash }]}>
        <Ionicons name={icon} size={quiet ? 18 : 22} color={hue.ink} />
      </View>
      <View style={styles.cardBody}>
        <Type variant={quiet ? "bodyStrong" : "title2"} numberOfLines={2}>
          {title}
        </Type>
        <Type variant="caption" numberOfLines={2}>
          {body}
        </Type>
      </View>
      <Ionicons name="chevron-forward" size={18} color={CHEVRON} />
    </Pressable>
    </View>
  );
}

/**
 * The same card, as one of a set you are choosing between.
 *
 * A chevron says "this leads somewhere"; a tick says "this is the one". The old
 * version said it with a literal "✓ " glued to the front of the title, which
 * reads correctly by eye, says nothing at all to a screen reader, and shifts
 * every title sideways by a character when the choice changes.
 */
export function PickCard({
  icon,
  tone,
  title,
  body,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: AuthTone;
  title: string;
  body: string;
  selected: boolean;
  onPress: () => void;
}) {
  const hue = TONE[tone];

  return (
    <View style={styles.cardClip}>
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={`${title}. ${body}.`}
      {...pressableFeedback(alpha(hue.ink, RIPPLE))}
      style={({ pressed }) => [
        styles.card,
        styles.pick,
        selected ? { borderWidth: 1.5, borderColor: hue.ink, backgroundColor: hue.wash } : null,
        pressed ? styles.cardPressed : null,
      ]}
    >
      <View style={[styles.tile, styles.tileQuiet, { backgroundColor: selected ? WHITE : hue.wash }]}>
        <Ionicons name={icon} size={18} color={hue.ink} />
      </View>
      <View style={styles.cardBody}>
        <Type variant="bodyStrong" numberOfLines={2}>
          {title}
        </Type>
        <Type variant="caption" numberOfLines={3}>
          {body}
        </Type>
      </View>
      <Ionicons
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={21}
        color={selected ? hue.ink : CHEVRON}
      />
    </Pressable>
    </View>
  );
}

/** The way back, as a mark rather than as a full-width button saying "Back". */
export function AuthBack({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      {...pressableFeedback(shell.chromePressed)}
      style={({ pressed }) => [styles.back, pressed ? { backgroundColor: shell.chromePressed } : null]}
    >
      <Ionicons name="arrow-back" size={20} color={shell.onChrome} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ground: {
    flex: 1,
    backgroundColor: ph.ground,
  },
  fill: {
    flex: 1,
  },
  page: {
    flexGrow: 1,
  },
  // The Homes' hero: the chrome's textured green, its foot hidden under the panel.
  hero: {
    paddingHorizontal: space[5],
    paddingBottom: RISE + space[6],
    backgroundColor: shell.chrome,
  },
  heroInner: {
    width: "100%",
    maxWidth: MEASURE,
    alignSelf: "center",
    gap: space[5],
  },
  // The way back on the leading side, the step marks on the trailing side.
  crownInner: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
  },
  heroBody: {
    gap: space[4],
  },
  // The pale green panel rising over the hero's foot, with the Homes' corners.
  panel: {
    flexGrow: 1,
    marginTop: -RISE,
    paddingTop: space[6],
    paddingHorizontal: space[5],
    borderTopLeftRadius: RISE,
    borderTopRightRadius: RISE,
    backgroundColor: ph.ground,
  },
  // Bounded and centred, so a two-field form is a column on a tablet rather
  // than a row of inputs stretched across it.
  column: {
    width: "100%",
    maxWidth: MEASURE,
    alignSelf: "center",
    gap: space[5],
  },

  mark: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    alignSelf: "flex-start",
  },
  markDot: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: shell.onChrome,
  },
  markWord: {
    color: shell.onChrome,
    letterSpacing: -0.3,
  },

  heading: {
    gap: space[2],
  },
  title: {
    color: shell.onChrome,
  },
  line: {
    color: shell.onChromeMuted,
    maxWidth: 360,
    fontSize: 15,
    lineHeight: 21,
  },

  progress: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
  },
  tick: {
    width: 18,
    height: 4,
    borderRadius: 2,
    backgroundColor: alpha(WHITE, 0.28),
  },
  tickDone: {
    backgroundColor: alpha(WHITE, 0.6),
  },
  tickHere: {
    width: 30,
    backgroundColor: WHITE,
  },

  // A whole pixel, never `hairlineWidth`.
  //
  // On Android `hairlineWidth` is 1/density — a third of a pixel on a 3x phone
  // — and a border that thin is rounded away, so every frosted surface in this
  // kit lost its edge there while looking right on iOS. `IndexRows` had already
  // learned this and draws its panels at 1; these now match.
  fieldCard: {
    borderRadius: PANEL_RADIUS,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
    overflow: "hidden",
  },
  cells: {
    flexDirection: "row",
    gap: space[2],
    justifyContent: "space-between",
  },
  // Six white boxes: one grey edge each, the one you are filling in taking a
  // second point of kola, and the row turning laterite when a code is refused.
  cell: {
    flex: 1,
    height: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.14),
    backgroundColor: WHITE,
    alignItems: "center",
    justifyContent: "center",
  },
  cellActive: {
    borderWidth: 2,
    borderColor: KOLA,
  },
  cellWrong: {
    borderColor: ALERT,
  },
  digit: {
    fontFamily: "monospace",
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    height: 56,
    width: "100%",
  },
  join: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 52,
    backgroundColor: JOIN,
  },
  row: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  // Focus and error are drawn by `FieldEdge` behind the row — a tint and an
  // edge over the padding the row already has — so lighting up costs no layout
  // and eases in rather than switching.
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
  },
  rowIcon: {
    width: 20,
    marginRight: space[4],
  },
  rowBody: {
    flex: 1,
    gap: 1,
  },
  // A name in sentence case over the value, as the app's own forms label —
  // not a tracked small-caps tag.
  rowLabel: {
    color: MUTED,
    fontSize: 12.5,
    lineHeight: 16,
    letterSpacing: 0,
  },
  rowValue: {
    flexDirection: "row",
    alignItems: "center",
  },
  // The input's size at its natural height: the row centres both, and a
  // fixed-height Text would draw its glyphs at the top of the box instead.
  rowPrefix: {
    fontSize: 16,
    includeFontPadding: false,
    color: theme.color.ink["500"],
    marginRight: space[2],
  },
  // No lineHeight: iOS draws a TextInput's text low in a line box taller than
  // the font, which is what set the number below "+233". A fixed height
  // centres it instead, and Android drops its extra font padding likewise.
  input: {
    flex: 1,
    height: 24,
    padding: 0,
    fontSize: 16,
    includeFontPadding: false,
    textAlignVertical: "center",
    color: INK,
  },
  // Under the label, not under the label plus the row's padding: the row's
  // own padding is already to the left of this line, so the indent is the icon
  // column alone.
  rowError: {
    marginTop: space[1],
    marginLeft: MESSAGE_INDENT,
    color: ALERT,
  },
  rowHint: {
    marginTop: space[1],
    marginLeft: MESSAGE_INDENT,
    color: MUTED,
  },
  reveal: {
    paddingLeft: space[3],
  },

  action: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingHorizontal: space[5],
    borderRadius: 16,
    backgroundColor: KOLA,
    // Android draws `android_ripple` as a rectangle unless the view clips, so a
    // rounded button squares off under the thumb. iOS takes no ripple at all,
    // which is why this only ever looked wrong on one platform. The app-wide
    // `Button` has carried this for the same reason.
    overflow: "hidden",
  },
  // Not green at all.
  //
  // The live act is solid kola with white on it, and that never changes. Two
  // earlier attempts made the *inactive* state a paler green — `kola-50`, then
  // kola at 16% — on the reasoning that it should still read as the brand. Both
  // were wrong for the same reason: a light green button sitting where a green
  // button goes reads as the button, badly drawn, rather than as a button that
  // is not ready. A neutral says "not yet" and cannot be mistaken for the act.
  actionOff: {
    backgroundColor: alpha(DEEP, 0.09),
  },
  actionPressed: {
    backgroundColor: theme.color.kola["800"],
  },
  actionText: {
    color: WHITE,
    flexShrink: 1,
    textAlign: "center",
  },
  actionTextOff: {
    color: alpha(INK, 0.5),
  },

  // No gap: each link is already a 48-point target, and adding to that spread
  // three lines of secondary text down the page as if they were unrelated.
  foot: {
    alignItems: "center",
  },
  aside: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
  },


  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    minHeight: 76,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: PANEL_RADIUS,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
    overflow: "hidden",
  },
  pick: {
    minHeight: 68,
  },
  // The card's own corners, around its Pressable: Android's ripple ignores the
  // Pressable's radius, so the clip has to come from a parent.
  cardClip: {
    overflow: "hidden",
    borderRadius: PANEL_RADIUS,
  },
  cardQuiet: {
    minHeight: 62,
    backgroundColor: alpha(WHITE, 0.45),
    borderColor: alpha(DEEP, 0.08),
  },
  cardPressed: {
    backgroundColor: alpha(WHITE, 0.98),
  },
  cardBody: {
    flex: 1,
    gap: 1,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  tileQuiet: {
    width: 38,
    height: 38,
    borderRadius: 12,
  },

  // A white well on the green, as every header's controls are.
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: shell.chromeRaised,
    overflow: "hidden",
  },
});

export { CHEVRON, EDGE, GLASS, INK, JOIN, KOLA, MEASURE, PANEL_RADIUS, WHITE };
