import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { getMyArtisanApplication, type ArtisanApplication } from "@/artisan";
import { useAuth, type Me, type Workspace } from "@/auth";
import { ArtisanFacts } from "@/components/artisan/ArtisanFacts";
import { Notice, Type, space } from "@/components/ui";
import { Briefing, Empty } from "@/components/work/WorkParts";
import { resolveEntryRoute } from "@/navigation";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";
import { WORKSPACE_LABELS, chooseWorkspace } from "@/workspace";

/**
 * The artisan experience on mobile: Home, Requests, Jobs and My Profile.
 *
 * An artisan sees the work they were invited to or given and nothing beyond it
 * — no tenants, no properties, no maintenance they are not part of. Requests
 * and Jobs are honest about being empty until a quote invitation arrives; the
 * gate in `app/_layout.tsx` keeps anybody without an approved application out.
 */

const AMBER = theme.color.harmattan["600"];
const AMBER_WASH = theme.color.harmattan["100"];
const KOLA = theme.color.kola["600"];
const LAGOON = theme.color.lagoon["600"];
const DEEP = theme.color.kola["900"];
const WHITE = theme.color.field["0"];

function useArtisanApplication() {
  const [application, setApplication] = useState<ArtisanApplication | null>(null);
  const [error, setError] = useState("");
  useFocusEffect(
    useCallback(() => {
      let live = true;
      getMyArtisanApplication()
        .then((next) => { if (live) { setApplication(next); setError(""); } })
        .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load your artisan profile."); });
      return () => { live = false; };
    }, []),
  );
  return { application, error };
}

function useMe(): Me | null {
  const { state } = useAuth();
  return state.status === "signed_in" ? state.me : null;
}

/** Shown on every artisan tab while Management has paused new work. */
function SuspendedNotice({ me }: { me: Me | null }) {
  if (!me || me.capabilities.artisan.can_quote) return null;
  return (
    <Notice
      tone="warning"
      title="Your artisan account is suspended"
      body="You cannot send new quotes or take on new jobs for now. Everything you have already done stays here."
    />
  );
}

function Page({ children }: { children: ReactNode }) {
  const pageBottom = useSafeBottom(space[10]);
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.column}>{children}</View>
    </ScrollView>
  );
}

function Card({ icon, tone, title, link, children }: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: { ink: string; wash: string };
  title: string;
  link?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.cardIcon, { backgroundColor: tone.wash }]}>
          <Ionicons name={icon} size={18} color={tone.ink} />
        </View>
        <Type variant="bodyStrong" accessibilityRole="header" style={{ flex: 1 }}>{title}</Type>
        {link ? (
          <Pressable onPress={link.onPress} accessibilityRole="link" hitSlop={8}>
            <Type variant="captionStrong" style={{ color: KOLA }}>{link.label}</Type>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function ArtisanHomeScreen() {
  const router = useRouter();
  const me = useMe();
  const { application, error } = useArtisanApplication();
  const profile = application?.profile;
  const firstName = me?.display_name.split(/\s+/)[0] ?? "";

  return (
    <Page>
      <View style={styles.hero}>
        <Ionicons name="hammer" size={150} color={alpha(WHITE, 0.1)} style={styles.heroMark} />
        <View style={styles.heroEyebrow}>
          <Type variant="captionStrong" style={{ color: WHITE, letterSpacing: 0.6 }}>ARTISAN</Type>
        </View>
        <Type variant="display3" accessibilityRole="header" style={{ color: WHITE }}>
          {firstName ? `Good to see you, ${firstName}` : "Artisan work"}
        </Type>
        <Type variant="caption" style={styles.heroLine}>
          {profile
            ? `${profile.trades.map((trade) => trade.label).join(", ")} · ${profile.districts.map((district) => district.name).join(", ")}`
            : "Quote invitations, jobs and what needs you, in one place."}
        </Type>
      </View>

      <SuspendedNotice me={me} />
      {error ? <Notice tone="error" title={error} /> : null}

      <Card
        icon="document-text-outline"
        tone={{ ink: AMBER, wash: AMBER_WASH }}
        title="New quote invitations"
        link={{ label: "Requests", onPress: () => router.navigate("/(app)/(artisan-tabs)/artisan-requests" as never) }}
      >
        <Empty compact ground={WHITE} icon="document-text-outline" title="No invitations yet" hint="When a tenant or property provider asks you to quote, it appears here with the area and what needs doing." />
      </Card>

      <Card
        icon="construct-outline"
        tone={{ ink: KOLA, wash: theme.color.kola["50"] }}
        title="Active jobs"
        link={{ label: "Jobs", onPress: () => router.navigate("/(app)/(artisan-tabs)/artisan-jobs" as never) }}
      >
        <Empty compact ground={WHITE} icon="construct-outline" title="No active jobs" hint="A job starts here once a customer approves your quote." />
      </Card>

      <Card
        icon="person-circle-outline"
        tone={{ ink: LAGOON, wash: theme.color.lagoon["100"] }}
        title="Your profile"
        link={{ label: "My Profile", onPress: () => router.navigate("/(app)/(artisan-tabs)/artisan-profile" as never) }}
      >
        {profile ? <ArtisanFacts profile={profile} /> : application || error ? null : <ActivityIndicator color={KOLA} />}
      </Card>
    </Page>
  );
}

export function ArtisanRequestsScreen() {
  const me = useMe();
  return (
    <Page>
      <Briefing title="Quote invitations" parts={[{ text: "and the quotes you send in reply", tone: theme.color.ink["500"] }]} />
      <SuspendedNotice me={me} />
      <View style={styles.card}>
        <Empty
          ground={WHITE}
          icon="document-text-outline"
          title="No quote invitations yet"
          hint="A tenant or property provider invites you to quote. You see the area and what needs doing; the exact address and a contact open only after your quote is approved."
        />
      </View>
    </Page>
  );
}

export function ArtisanJobsScreen() {
  const me = useMe();
  return (
    <Page>
      <Briefing title="Jobs" parts={[{ text: "work a customer approved, its photos and history", tone: theme.color.ink["500"] }]} />
      <SuspendedNotice me={me} />
      <View style={styles.card}>
        <Empty
          ground={WHITE}
          icon="construct-outline"
          title="No jobs yet"
          hint="A job appears here once a customer approves your quote. Its photos, cost and history stay here after it is finished."
        />
      </View>
    </Page>
  );
}

const CROSSING: Record<Exclude<Workspace, "discovery" | "artisan">, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  tenant: { label: "Switch to renting", icon: "home-outline" },
  provider: { label: "Switch to managing property", icon: "business-outline" },
};

/**
 * My Profile: the facts customers will read, then the account. There is no
 * Menu tab here, so the ways back to the other experiences and out of the app
 * live at the foot of this page.
 */
export function ArtisanProfileScreen() {
  const router = useRouter();
  const { refreshMe, signOut } = useAuth();
  const me = useMe();
  const { application, error } = useArtisanApplication();
  const [switching, setSwitching] = useState<Workspace | null>(null);
  const [failure, setFailure] = useState("");

  async function switchTo(workspace: Workspace) {
    setSwitching(workspace);
    setFailure("");
    try {
      const next = await chooseWorkspace(workspace);
      await refreshMe();
      router.replace(resolveEntryRoute(next) as never);
    } catch (cause) {
      setFailure(cause instanceof ApiFailure ? cause.error.message : "Could not switch.");
    } finally {
      setSwitching(null);
    }
  }

  const others = (me?.capabilities.available_workspaces ?? []).filter(
    (workspace): workspace is "tenant" | "provider" => workspace === "tenant" || workspace === "provider",
  );

  return (
    <Page>
      <Briefing title="My Profile" parts={[{ text: "what customers will see: facts, not ratings", tone: theme.color.ink["500"] }]} />
      <SuspendedNotice me={me} />
      {error ? <Notice tone="error" title={error} /> : null}

      {application ? (
        <>
          <View style={styles.factsRow}>
            <Stat icon="shield-checkmark-outline" tone={{ ink: KOLA, wash: theme.color.kola["50"] }} title={application.identity_on_file ? "ID checked" : "ID not checked"} line="By Danpa HQ" />
            <Stat icon="construct-outline" tone={{ ink: AMBER, wash: AMBER_WASH }} title="0 jobs" line="Done on Danpa HQ" />
            <Stat icon="star-outline" tone={{ ink: LAGOON, wash: theme.color.lagoon["100"] }} title="No reviews" line="After confirmed jobs" />
          </View>
          {application.profile ? (
            <View style={styles.card}>
              <ArtisanFacts profile={application.profile} />
            </View>
          ) : null}
        </>
      ) : error ? null : (
        <ActivityIndicator color={KOLA} />
      )}

      <View style={styles.card}>
        {others.map((workspace) => (
          <Row
            key={workspace}
            icon={CROSSING[workspace].icon}
            label={switching === workspace ? "Switching…" : CROSSING[workspace].label}
            onPress={() => void switchTo(workspace)}
            disabled={switching !== null}
          />
        ))}
        <Row icon="create-outline" label="Edit profile" onPress={() => router.push("/(app)/artisan-profile-edit" as never)} />
        <Row icon="document-text-outline" label="Your artisan application" onPress={() => router.push("/(app)/artisan-application" as never)} />
        <Row icon="notifications-outline" label="Updates" onPress={() => router.push("/(app)/notifications" as never)} />
        <Row icon="key-outline" label="Security" onPress={() => router.push("/(app)/security" as never)} />
        <Row icon="log-out-outline" label="Sign out" danger onPress={() => void signOut().then(() => router.replace("/(auth)/sign-in" as never))} />
      </View>
      {failure ? <Notice tone="error" title={failure} /> : null}
      <Type variant="caption" style={styles.footnote}>
        You are in the {WORKSPACE_LABELS.artisan.toLowerCase()} experience. Switching is only a change of view.
      </Type>
    </Page>
  );
}

function Stat({ icon, tone, title, line }: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: { ink: string; wash: string };
  title: string;
  line: string;
}) {
  return (
    <View style={styles.stat}>
      <View style={[styles.cardIcon, { backgroundColor: tone.wash }]}>
        <Ionicons name={icon} size={18} color={tone.ink} />
      </View>
      <Type variant="captionStrong" numberOfLines={1}>{title}</Type>
      <Type variant="caption" numberOfLines={2} style={{ color: theme.color.ink["500"], fontSize: 12, lineHeight: 16 }}>{line}</Type>
    </View>
  );
}

function Row({ icon, label, onPress, danger = false, disabled = false }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const ink = danger ? theme.color.laterite["600"] : theme.color.ink["900"];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      {...pressableFeedback(alpha(DEEP, 0.05))}
      style={({ pressed }) => [styles.row, pressed ? { opacity: 0.7 } : null]}
    >
      <Ionicons name={icon} size={20} color={danger ? ink : KOLA} />
      <Type variant="body" style={{ flex: 1, color: ink }}>{label}</Type>
      {danger ? null : <Ionicons name="chevron-forward" size={16} color={alpha(DEEP, 0.3)} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: space[4], paddingHorizontal: space[4] },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", gap: space[4] },
  hero: {
    gap: space[2],
    padding: space[5],
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: AMBER,
  },
  heroMark: { position: "absolute", right: -24, bottom: -36, transform: [{ rotate: "-18deg" }] },
  heroEyebrow: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: space[2],
    borderRadius: 999,
    backgroundColor: alpha(WHITE, 0.18),
  },
  heroLine: { color: alpha(WHITE, 0.86), fontSize: 15, lineHeight: 21 },
  card: {
    gap: space[3],
    padding: space[4],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.08),
    backgroundColor: WHITE,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: space[3] },
  cardIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  factsRow: { flexDirection: "row", gap: space[2] },
  stat: {
    flex: 1,
    gap: 4,
    padding: space[3],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: alpha(DEEP, 0.08),
    backgroundColor: WHITE,
  },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 48 },
  footnote: { textAlign: "center", color: theme.color.ink["500"], paddingHorizontal: space[4] },
});

