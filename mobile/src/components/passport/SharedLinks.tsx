import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import { Bone } from "@/components/billing/BillingParts";
import { PassportSection } from "@/components/passport/PassportDocument";
import { FAINT, INK, KOLA, KOLA_DEEP, MUTED, RULE } from "@/components/portfolio/PortfolioList";
import { Act, Acts, Empty, Fold } from "@/components/work/WorkParts";
import { Type, radius, space } from "@/components/ui";
import { tick } from "@/components/auth/AuthMotion";
import { timeAgo } from "@/notifications";
import { revokePassportShare, shareUrl, type PassportShare } from "@/passport";
import { dayMonthYear, scopeLine, shareLifeLine, viewsLine } from "@/passportMeaning";
import { pressableFeedback } from "@/platform";
import { theme } from "@/theme";

export type PageNotice = { tone: "success" | "error"; title: string; body?: string };

/**
 * Who can read the passport right now, and the way to stop them.
 *
 * Live links first, each with its copy and its withdraw; links that have
 * stopped working stay folded underneath, so the tenant can see what they
 * shared and when it ended. The words are web's (`SharedLinks.tsx`).
 */
export function SharedLinks({
  shares,
  error,
  onShare,
  onChanged,
  onNotice,
}: {
  shares: PassportShare[] | null;
  error: string;
  onShare: () => void;
  onChanged: (share: PassportShare) => void;
  onNotice: (notice: PageNotice) => void;
}) {
  const live = (shares ?? []).filter((share) => share.state === "active");
  const ended = (shares ?? []).filter((share) => share.state !== "active");
  const [showEnded, setShowEnded] = useState(false);

  return (
    <PassportSection title="Shared links" count={live.length ? `${live.length} live` : undefined} card={false}>
      {shares === null ? (
        <View style={styles.card} accessible accessibilityRole="progressbar" accessibilityLabel="Loading your links">
          <View style={styles.skeleton}><Bone width="55%" height={16} /><Bone width="80%" /></View>
        </View>
      ) : error && !shares.length ? (
        <View style={[styles.card, styles.errorRow]} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={16} color={theme.color.laterite["600"]} />
          <Type variant="caption" style={{ flex: 1, color: theme.color.laterite["600"] }}>{error}</Type>
        </View>
      ) : !live.length ? (
        <View style={styles.card}>
          <Empty
            compact
            icon="link-outline"
            ground={theme.color.field["0"]}
            title="Not shared with anyone"
            hint="Make a read-only link for a landlord you’re applying to."
            action={<Act primary icon="share-outline" label="Share" onPress={onShare} />}
          />
        </View>
      ) : (
        <View style={[styles.card, styles.list]}>
          {live.map((share, index) => <LinkRow key={share.id} share={share} first={index === 0} onChanged={onChanged} onNotice={onNotice} />)}
        </View>
      )}

      {ended.length ? (
        <View style={styles.ended}>
          <Fold
            icon="link-outline"
            title={`${ended.length} ended link${ended.length === 1 ? "" : "s"}`}
            summary="Expired or withdrawn"
            count={ended.length}
            open={showEnded}
            onToggle={() => setShowEnded((value) => !value)}
          />
          {showEnded ? (
            <View style={[styles.card, styles.list]}>
              {ended.map((share, index) => <LinkRow key={share.id} share={share} first={index === 0} onChanged={onChanged} onNotice={onNotice} />)}
            </View>
          ) : null}
        </View>
      ) : null}
    </PassportSection>
  );
}

function LinkRow({ share, first, onChanged, onNotice }: {
  share: PassportShare;
  first: boolean;
  onChanged: (share: PassportShare) => void;
  onNotice: (notice: PageNotice) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = share.state === "active";
  const url = share.token ? shareUrl(share.token) : null;

  async function revoke() {
    setBusy(true);
    try {
      onChanged(await revokePassportShare(share.id));
      onNotice({ tone: "success", title: "Link withdrawn", body: "It stopped working straight away." });
    } catch (cause) {
      onNotice({ tone: "error", title: "The link is still live", body: cause instanceof ApiFailure ? cause.error.message : "Try again." });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const lifeTone = share.state === "active" ? KOLA : share.state === "revoked" ? theme.color.laterite["600"] : FAINT;

  return (
    <View style={[styles.row, first ? null : styles.ruled, live ? null : styles.rowEnded]}>
      <Type variant="bodyStrong" numberOfLines={1} style={styles.rowTitle}>{share.recipient_label || "Shared by link"}</Type>
      <Type variant="caption" style={{ color: MUTED }}>{scopeLine(share.scope)}</Type>
      <Type variant="caption" style={{ color: FAINT }}>
        <Type variant="captionStrong" style={{ color: lifeTone }}>{shareLifeLine(share)}</Type>
        {" · "}
        {live ? viewsLine(share) : `Made ${dayMonthYear(share.created_at)}`}
        {live && share.last_viewed_at ? `, last ${timeAgo(share.last_viewed_at)}` : ""}
      </Type>
      {live && share.token ? (
        confirming ? (
          <View style={styles.confirm} accessibilityRole="alert" accessibilityLabel="Withdraw this link?">
            <Type variant="caption" style={{ color: INK }}>Withdraw? It stops working at once.</Type>
            <Acts>
              <Act label="Keep" onPress={() => setConfirming(false)} />
              <DangerAct busy={busy} onPress={() => void revoke()} />
            </Acts>
          </View>
        ) : (
          <Acts>
            {url ? <CopyLink url={url} compact /> : null}
            <Act label="Withdraw" onPress={() => setConfirming(true)} />
          </Acts>
        )
      ) : null}
    </View>
  );
}

/** Withdraw, confirmed: laterite, the one act on the row that ends something. */
function DangerAct({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? "Withdrawing…" : "Withdraw"}
      aria-busy={busy}
      disabled={busy}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      {...pressableFeedback(theme.color.laterite["600"])}
      style={({ pressed }) => [styles.danger, pressed || busy ? { opacity: 0.8 } : null]}
    >
      {busy ? <ActivityIndicator size="small" color={theme.color.field["0"]} /> : null}
      <Type variant="captionStrong" style={{ color: theme.color.field["0"] }}>{busy ? "Withdrawing…" : "Withdraw"}</Type>
    </Pressable>
  );
}

/** The link, readable and copyable, with a confirmation that it was copied. */
export function CopyLink({ url, compact = false }: { url: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    await Clipboard.setStringAsync(url);
    tick();
    setCopied(true);
  }

  if (compact) {
    return <Act icon={copied ? "checkmark" : "copy-outline"} label={copied ? "Copied" : "Copy link"} onPress={() => void copy()} />;
  }
  return (
    <View style={styles.field}>
      <Type variant="caption" numberOfLines={1} ellipsizeMode="middle" selectable style={styles.fieldText}>{url}</Type>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? "Copied" : "Copy link"}
        aria-live="polite"
        onPress={() => void copy()}
        {...pressableFeedback(theme.color.kola["900"])}
        style={({ pressed }) => [styles.fieldButton, copied ? { backgroundColor: KOLA } : null, pressed ? { backgroundColor: theme.color.kola["900"] } : null]}
      >
        <Ionicons name={copied ? "checkmark" : "copy-outline"} size={15} color={theme.color.field["0"]} />
        <Type variant="captionStrong" style={{ color: theme.color.field["0"] }}>{copied ? "Copied" : "Copy"}</Type>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: RULE,
    backgroundColor: theme.color.field["0"],
  },
  list: { paddingHorizontal: space[4] },
  skeleton: { gap: space[2], padding: space[4] },
  errorRow: { flexDirection: "row", alignItems: "center", gap: space[2], padding: space[4] },
  ended: { gap: space[2], marginTop: space[1] },
  row: { gap: 3, paddingVertical: space[4] },
  rowEnded: { opacity: 0.78 },
  ruled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: RULE },
  rowTitle: { fontSize: 15, lineHeight: 20, color: INK },
  confirm: { gap: 2, marginTop: space[2] },
  danger: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: theme.color.laterite["600"],
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    minHeight: 48,
    paddingLeft: space[3],
    paddingRight: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.color.field["300"],
    backgroundColor: theme.color.field["0"],
  },
  fieldText: { flex: 1, color: KOLA_DEEP },
  fieldButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["800"],
  },
});
