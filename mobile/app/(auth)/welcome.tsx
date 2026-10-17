import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { useAuth } from "@/auth";
import { TextLink } from "@/components/auth/AuthFields";
import { Rise, SuccessMark } from "@/components/auth/AuthMotion";
import { VerificationTrack } from "@/components/auth/VerificationTrack";
import { AuthAction, AuthFoot, AuthHeading, AuthMark, AuthScene } from "@/components/auth/AuthScene";
import { Type, space } from "@/components/ui";
import { resolveEntryRoute } from "@/navigation";
import { accountJustCreated, finishAccountWelcome } from "@/registrationDraft";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * The account exists. The last screen of the journey, and the only one that
 * looks back at it.
 *
 * Shown once, by the route gate, right after `/me/registration/` succeeds — a
 * relaunch never brings it back. It answers the four things somebody should
 * always know: where they are (in, with an account), what Danpa HQ needs next,
 * why, and what happens after.
 *
 * A tenant needs nothing more, so it is one line and one act. A provider needs
 * to know, before anything else, that operating waits on verification — so it
 * says so plainly, shows the four steps with the first already done, and leads
 * with the act that moves them along.
 */

const KOLA = theme.color.kola["600"];
const LAGOON = theme.color.lagoon["600"];
const GOLD = theme.color.gold["600"];

export default function WelcomeScreen() {
  const router = useRouter();
  const { state, activeContext } = useAuth();
  const me = state.status === "signed_in" ? state.me : null;
  const provider = (accountJustCreated() ?? me?.capabilities.account_type) === "provider";
  const name = me?.preferred_name || me?.first_name || "";

  function leave(route: string) {
    finishAccountWelcome();
    router.replace(route as never);
  }

  const home = me ? resolveEntryRoute(me, activeContext) : "/(app)/(tabs)";

  if (provider) {
    return (
      <AuthScene>
        <AuthMark />
        <AuthHeading
          title={name ? `Welcome, ${name}` : "Welcome to Danpa HQ"}
          line="Your provider account is created."
        />

        <SuccessMark tone={LAGOON} />

        <Rise index={1}>
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={[styles.badge, { backgroundColor: theme.color.gold["50"] }]}>
                <Ionicons name="shield-half-outline" size={18} color={GOLD} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Type variant="bodyStrong">Verification is required</Type>
                <Type variant="caption" style={styles.muted}>
                  Provider operations open once we have checked who you are. It protects your tenants, and you.
                </Type>
              </View>
            </View>

            <View style={styles.track}>
              <VerificationTrack
                stops={[
                  { state: "done", label: "Account created" },
                  { state: "next", label: "Send one ID document", detail: "Ghana Card, passport or driver's licence" },
                  { state: "later", label: "We review it", detail: "You can look around while you wait" },
                  { state: "later", label: "Provider tools unlock", detail: "Properties, tenants, rent and listings" },
                ]}
              />
            </View>
          </View>
        </Rise>

        <AuthAction label="Verify now" onPress={() => leave("/(app)/provider?send=1")} />

        <AuthFoot>
          <TextLink label="Look around first" onPress={() => leave(home)} />
        </AuthFoot>
      </AuthScene>
    );
  }

  return (
    <AuthScene>
      <AuthMark />
      <AuthHeading
        title={name ? `You're in, ${name}` : "You're in"}
        line="Your tenant account is ready."
      />

      <SuccessMark tone={KOLA} />

      <Rise index={1}>
        <View style={styles.card}>
          <Next icon="search" label="Find a place" detail="Browse, save and ask to view homes" />
          <View style={styles.rule} />
          <Next icon="key-outline" label="Already renting?" detail="Join your home with the code from your provider" />
          <View style={styles.rule} />
          <Next icon="person-circle-outline" label="Your profile" detail="Add an email and the rest whenever you like" />
        </View>
      </Rise>

      <AuthAction label="Go to Home" onPress={() => leave(home)} />
    </AuthScene>
  );
}

/** A thing they can do now, said in one line under its name. */
function Next({
  icon,
  label,
  detail,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
}) {
  return (
    <View style={styles.next}>
      <View style={[styles.badge, { backgroundColor: theme.color.kola["50"] }]}>
        <Ionicons name={icon} size={18} color={KOLA} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Type variant="bodyStrong">{label}</Type>
        <Type variant="caption" style={styles.muted}>
          {detail}
        </Type>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[4],
    padding: space[4],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: alpha(theme.color.kola["900"], 0.08),
    backgroundColor: theme.color.field["0"],
  },
  cardHead: {
    flexDirection: "row",
    gap: space[3],
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  muted: {
    color: theme.color.ink["700"],
  },
  next: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 48,
    backgroundColor: alpha(theme.color.kola["900"], 0.08),
  },
  track: {
    paddingLeft: space[1],
  },
});
