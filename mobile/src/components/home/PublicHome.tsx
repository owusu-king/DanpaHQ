import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { TONE } from "@/components/services/ServiceGlyph";
import { Type, space } from "@/components/ui";
import { pressableFeedback } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * Home, for somebody who has not signed in.
 *
 * **It does not list anything.** It used to open on a hero and then six listing
 * cards under "New verified listings", which made the first screen of the
 * product a worse copy of the tab next door: Explore is the place with the
 * search field, the filters, the map and the whole catalogue, and Home could
 * only ever show the first handful in whatever order the API returned them.
 * Worse, the same rule had already been written down for signed-in people —
 * "listings live in Explore, which is a tab" — and applied to everyone except
 * the one audience who had not yet been given a reason to care.
 *
 * So this says what Danpa HQ is and hands over. Three claims, because a renter
 * in Ghana has been burned by a listings site before and "verified" is the word
 * that has to be backed up; then one act, which is to go and look.
 *
 * The provider way in stays, quietly. Somebody who owns property and opens the
 * app cold has no other door on this screen, but it is not what the page is
 * for, so it is a line at the foot rather than a second button competing with
 * the first.
 */

const DEEP = theme.color.kola["900"];
const KOLA = theme.color.kola["600"];
const WHITE = theme.color.field["0"];

const GLASS = alpha(WHITE, 0.72);
const EDGE = alpha(DEEP, 0.08);
const RULE = alpha(DEEP, 0.08);

type Claim = {
  icon: keyof typeof Ionicons.glyphMap;
  tone: keyof typeof TONE;
  title: string;
  line: string;
};

/**
 * Why this rather than a Facebook group.
 *
 * Each is a promise the product actually keeps elsewhere in the app — the
 * verification stamp, the agreement record, the rent account — so none of them
 * is marketing that a tenant later finds was not true.
 */
const CLAIMS: Claim[] = [
  {
    icon: "shield-checkmark-outline",
    tone: "kola",
    title: "Checked before it is listed",
    line: "Providers are verified, not just registered.",
  },
  {
    icon: "document-text-outline",
    tone: "lagoon",
    title: "Agreements that hold",
    line: "Your tenancy in writing, kept where you can find it.",
  },
  {
    icon: "wallet-outline",
    tone: "harmattan",
    title: "Rent you can see",
    line: "What is due, what is paid, and a receipt for each.",
  },
];

export function PublicHome({
  onExplore,
  onProvider,
  providerLabel,
  providerBusy = false,
  providerBusyLabel,
  showProvider = true,
}: {
  onExplore: () => void;
  onProvider: () => void;
  providerLabel: string;
  providerBusy?: boolean;
  providerBusyLabel?: string;
  showProvider?: boolean;
}) {
  return (
    <View style={styles.page}>
      <View style={styles.hero}>
        <Type variant="label" style={styles.eyebrow}>
          VERIFIED RENTALS IN GHANA
        </Type>
        <Type variant="display3" style={styles.headline}>
          {`Find a place\nyou can trust.`}
        </Type>
        <Type variant="body" style={styles.line}>
          Browse freely. Your number is only needed when you want us to remember
          or send something.
        </Type>
      </View>

      <HeroAct icon="search" label="Search rentals" onPress={onExplore} />

      <View style={styles.claims}>
        {CLAIMS.map((claim, index) => {
          const hue = TONE[claim.tone];
          return (
            <View key={claim.title}>
              {index > 0 ? <View style={styles.rule} /> : null}
              <View style={styles.claim}>
                <View style={[styles.tile, { backgroundColor: hue.wash }]}>
                  <Ionicons name={claim.icon} size={19} color={hue.ink} />
                </View>
                <View style={styles.claimBody}>
                  <Type variant="bodyStrong" numberOfLines={2}>
                    {claim.title}
                  </Type>
                  <Type variant="caption" numberOfLines={2}>
                    {claim.line}
                  </Type>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {showProvider ? (
        <QuietAct
          icon="business-outline"
          label={providerBusy ? providerBusyLabel ?? "Opening…" : providerLabel}
          busy={providerBusy}
          onPress={onProvider}
        />
      ) : null}
    </View>
  );
}

/**
 * The one act: go and look.
 *
 * Kola and full width, the same weight the auth flow gives its own single act,
 * because a page with one thing to do should make that thing unmistakable. The
 * old screen had two equal buttons stacked — "Search rentals" and "I own/manage
 * property" — which is how a primary action stops being one.
 */
function HeroAct({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...pressableFeedback(WHITE)}
      style={({ pressed }) => [styles.act, pressed ? styles.actPressed : null]}
    >
      <Ionicons name={icon} size={19} color={WHITE} />
      <Type variant="bodyStrong" style={styles.actText}>
        {label}
      </Type>
    </Pressable>
  );
}

/** The other way in, offered without competing. */
function QuietAct({
  icon,
  label,
  busy,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      aria-busy={busy}
      aria-disabled={busy}
      accessibilityLabel={label}
      {...pressableFeedback(KOLA)}
      style={({ pressed }) => [
        styles.quiet,
        pressed ? { opacity: 0.85 } : null,
        busy ? { opacity: 0.5 } : null,
      ]}
    >
      <Ionicons name={icon} size={18} color={KOLA} />
      <Type variant="bodyStrong" style={styles.quietText} numberOfLines={2}>
        {label}
      </Type>
      <Ionicons name="chevron-forward" size={16} color={alpha(DEEP, 0.34)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    gap: space[5],
  },
  hero: {
    gap: space[2],
  },
  eyebrow: {
    color: KOLA,
  },
  headline: {
    color: theme.color.ink["900"],
  },
  line: {
    color: theme.color.ink["700"],
    maxWidth: 340,
  },
  act: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
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
  // One frosted panel with hairlines between, never a card per claim: three
  // floating boxes read as three unrelated adverts.
  claims: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: GLASS,
    overflow: "hidden",
  },
  claim: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  claimBody: {
    flex: 1,
    gap: 1,
  },
  tile: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 54 + space[3],
    backgroundColor: RULE,
  },
  quiet: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: alpha(WHITE, 0.5),
    overflow: "hidden",
  },
  quietText: {
    flex: 1,
    color: theme.color.kola["800"],
  },
});
