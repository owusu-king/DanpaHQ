import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { IndexGround } from "@/components/account/IndexRows";
import { Bone } from "@/components/billing/BillingParts";
import { Panel, Pill } from "@/components/billing/BillingSurfaces";
import { useHomeDensity } from "@/components/home/plinth";
import {
  Footnote,
  GroupLabel,
  HARMATTAN,
  INK,
  KOLA,
  KOLA_DEEP,
  LATERITE,
  MUTED,
  RULE,
  RowLine,
  rowStyles,
  type IconName,
} from "@/components/portfolio/PortfolioList";
import { Notice, Type, radius, space } from "@/components/ui";
import { destructiveConfirmStyle, isAndroid, pressableFeedback, useSafeBottom } from "@/platform";
import { theme } from "@/theme";

type Device = {
  id: string;
  label: string;
  platform: string;
  last_seen_at: string;
  is_current: boolean;
};

type SecurityStatus = {
  level: "normal" | "elevated" | "high";
  reasons: string[];
  payouts_held: boolean;
  hold_remaining_hours: number;
  active_sessions: number;
};

/**
 * The security screen a user can actually act on.
 *
 * Two things it does that most consumer apps do not:
 *
 * 1. **It explains the hold in plain words.** If payouts are paused after a
 *    number or SIM change, the person is told that, why, and for how long -
 *    rather than discovering it when a withdrawal fails.
 * 2. **Two device actions, because there are two intentions.** Signing a device
 *    out ends its sessions and is reversible - the installation can sign in
 *    again with a one-time code. Reporting a handset lost or stolen bars it, and
 *    only support can lift that. Both used to be the same button at the second
 *    one's price, which is how tidying a device list cost people their own
 *    phone. Each confirms in the platform's own idiom (an action sheet on iOS,
 *    a dialog on Android).
 *
 * Refined on review (2026-09-15): how the account stands leads as one panel in its
 * own colour, the devices are one glass list with the two actions as pills, and
 * what to watch for is a note rather than a section of prose.
 */
export default function SecurityScreen() {
  const density = useHomeDensity();
  const pageBottom = useSafeBottom(space[12]);
  const { signOut } = useAuth();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [error, setError] = useState("");
  const [removingDevice, setRemovingDevice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [deviceList, securityStatus] = await Promise.all([
        apiFetch<Device[]>("/me/devices/"),
        apiFetch<SecurityStatus>("/me/security/"),
      ]);
      setDevices(deviceList);
      setStatus(securityStatus);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Both actions end the sessions; only one of them bars the handset. */
  async function act(device: Device, path: string, method: "DELETE" | "POST") {
    setRemovingDevice(device.id);
    try {
      await apiFetch(path, { method });
      // Drop it immediately. The server list also excludes signed-out and
      // blocked devices, so the background refresh cannot redraw the stale row
      // and its actions afterwards.
      setDevices((current) => current?.filter((item) => item.id !== device.id) ?? current);
      void load();
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not do that.");
    } finally {
      setRemovingDevice(null);
    }
  }

  /**
   * Signing a device out is the everyday action and is reversible.
   *
   * It used to bar that installation from the account for good, with no way
   * back anywhere in the product — so a person tidying their device list lost
   * their own phone. Signing out ends the sessions; getting back in needs a
   * one-time code to this number, which is the control that was doing the work.
   */
  function confirmSignOut(device: Device) {
    Alert.alert(
      `Sign out ${device.label || "this device"}?`,
      "It will be signed out straight away. Signing in again on it will need a code sent to your number.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          onPress: () => void act(device, `/me/devices/${device.id}/`, "DELETE"),
        },
      ],
    );
  }

  /** The stolen-handset action, stated as such and kept irreversible. */
  function confirmBlock(device: Device) {
    Alert.alert(
      `Report ${device.label || "this device"} lost or stolen?`,
      "It will be signed out and blocked from signing in again. Only support can undo this.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report it",
          style: destructiveConfirmStyle,
          onPress: () => void act(device, `/me/devices/${device.id}/block/`, "POST"),
        },
      ],
    );
  }

  return (
    <IndexGround>
      <ScrollView contentContainerStyle={{ paddingHorizontal: density.pagePadding, paddingTop: density.compact ? space[4] : space[5], paddingBottom: pageBottom, gap: density.sectionGap + space[2] }}>
        {error ? <Notice tone="error" title={error} /> : null}

        {status ? <StatusPanel status={status} devices={devices?.length ?? 0} /> : null}

        <View style={styles.section}>
          <GroupLabel count={devices?.length}>Devices signed in</GroupLabel>
          {devices === null ? (
            <DevicesSkeleton />
          ) : (
            <Panel>
              {devices.map((device, index) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  first={index === 0}
                  busy={removingDevice === device.id}
                  disabled={removingDevice !== null}
                  onSignOut={() => confirmSignOut(device)}
                  onBlock={() => confirmBlock(device)}
                />
              ))}
            </Panel>
          )}
          <Footnote>
            Signing a device out ends its sessions; it can sign in again with a code sent to your
            number. Reporting it lost or stolen stops it signing in at all.
          </Footnote>
        </View>

        <View style={styles.section}>
          <GroupLabel>Keeping your account safe</GroupLabel>
          <Panel>
            <View style={styles.advice}>
              <View style={[rowStyles.well, styles.adviceWell]}>
                <Ionicons name="lock-closed-outline" size={16} color={KOLA} />
              </View>
              <View style={rowStyles.rowBody}>
                <Type variant="bodyStrong" style={styles.adviceTitle}>Rooomly never asks for your code</Type>
                <Type variant="caption" style={rowStyles.rowSub}>
                  Anyone who calls or texts asking for it is trying to take your account.
                </Type>
              </View>
            </View>
            <View style={[styles.advice, styles.ruled]}>
              <View style={[rowStyles.well, styles.adviceWell]}>
                <Ionicons name="time-outline" size={16} color={KOLA} />
              </View>
              <View style={rowStyles.rowBody}>
                <Type variant="bodyStrong" style={styles.adviceTitle}>A number change pauses payouts</Type>
                <Type variant="caption" style={rowStyles.rowSub}>
                  If your SIM is swapped or your number changes, payouts pause for three days so there
                  is time to notice.
                </Type>
              </View>
            </View>
          </Panel>
        </View>

        <Pill label="Sign out" icon="log-out-outline" tone="quiet" onPress={signOut} />
      </ScrollView>
    </IndexGround>
  );
}

/**
 * How the account stands, in one panel and one colour: paused payouts lead, then
 * anything worth knowing, and otherwise the quiet all-clear.
 */
function StatusPanel({ status, devices }: { status: SecurityStatus; devices: number }) {
  const held = status.payouts_held;
  const noted = status.reasons.length > 0;
  const tone = held ? LATERITE : noted ? HARMATTAN : KOLA;
  const wash = held ? theme.color.laterite["100"] : noted ? theme.color.harmattan["100"] : theme.color.kola["50"];
  const icon: IconName = held ? "pause-circle-outline" : noted ? "information-circle-outline" : "shield-checkmark-outline";
  const title = held
    ? "Payouts are paused for now"
    : noted ? "Worth knowing" : "Nothing unusual on your account";
  const body = held
    ? `${status.reasons.join(" ")} This lasts about ${Math.ceil(status.hold_remaining_hours)} more hours. You can use everything else as normal.`
    : noted ? status.reasons.join(" ") : "We watch for SIM swaps, number changes and new sign-ins.";
  return (
    <View accessible accessibilityLabel={`${title}. ${body}`} style={styles.status}>
      <View style={[styles.statusWell, { backgroundColor: wash }]}>
        <Ionicons name={icon} size={20} color={tone} />
      </View>
      <View style={styles.statusText}>
        <Type variant="bodyStrong" style={[styles.statusTitle, { color: held ? LATERITE : INK }]}>{title}</Type>
        <Type variant="caption" style={styles.statusBody}>{body}</Type>
        <Type variant="caption" style={styles.statusMeta}>
          {devices} {devices === 1 ? "device" : "devices"} signed in
        </Type>
      </View>
    </View>
  );
}

/**
 * One device: what it is and when it was last used, with the two actions kept
 * apart — signing out is reversible, reporting it lost is not.
 */
function DeviceRow({
  device,
  first,
  busy,
  disabled,
  onSignOut,
  onBlock,
}: {
  device: Device;
  first: boolean;
  busy: boolean;
  /** While any device is being acted on, no other device's actions take a press. */
  disabled: boolean;
  onSignOut: () => void;
  onBlock: () => void;
}) {
  return (
    <View style={[styles.device, first ? null : styles.ruled, disabled && !busy ? styles.dim : null]}>
      <View style={[rowStyles.well, styles.deviceWell]}>
        <Ionicons name={deviceIcon(device.platform)} size={17} color={device.is_current ? KOLA : MUTED} />
      </View>
      <View style={rowStyles.rowBody}>
        <RowLine
          start={<Type variant="bodyStrong" numberOfLines={1} style={rowStyles.rowTitle}>{device.label || device.platform}</Type>}
          end={device.is_current ? <Type variant="label" style={styles.current}>THIS DEVICE</Type> : undefined}
        />
        <Type variant="caption" numberOfLines={2} style={rowStyles.rowSub}>
          Last used {lastUsed(device.last_seen_at)}
        </Type>
        {!device.is_current ? (
          <View style={styles.actions}>
            <DeviceAction
              label={busy ? "Working…" : "Sign out"}
              hint="Ends its sessions. It can sign in again with a code."
              disabled={disabled}
              onPress={onSignOut}
            />
            <DeviceAction
              label="Lost or stolen"
              hint="Blocks it from signing in. Only support can undo this."
              tone="danger"
              disabled={disabled}
              onPress={onBlock}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DeviceAction({
  label,
  hint,
  tone = "quiet",
  disabled,
  onPress,
}: {
  label: string;
  hint: string;
  tone?: "quiet" | "danger";
  disabled: boolean;
  onPress: () => void;
}) {
  const danger = tone === "danger";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      {...pressableFeedback(danger ? theme.color.laterite["100"] : theme.color.kola["50"])}
      style={({ pressed }) => [
        styles.action,
        danger ? styles.actionDanger : null,
        pressed && !isAndroid ? { opacity: 0.8 } : null,
      ]}
    >
      <Type variant="captionStrong" style={[styles.actionText, danger ? { color: LATERITE } : null]}>{label}</Type>
    </Pressable>
  );
}

/** Shaped like the rows it becomes, so nothing jumps when the devices arrive. */
function DevicesSkeleton() {
  return (
    <Panel>
      <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your devices">
        {[0, 1].map((key) => (
          <View key={key} style={[styles.device, key ? styles.ruled : null]}>
            <Bone width={32} height={32} round={10} />
            <View style={rowStyles.rowBody}>
              <Bone width="52%" height={14} />
              <Bone width="70%" />
              <Bone width="46%" height={26} round={13} />
            </View>
          </View>
        ))}
      </View>
    </Panel>
  );
}

/** When a device was last used, as somebody reads it: the day, then the time. */
function lastUsed(value: string) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  const time = at.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (at.toDateString() === now.toDateString()) return `today at ${time}`;
  if (at.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return `${at.toLocaleDateString("en-GH", { day: "numeric", month: "short" })} at ${time}`;
}

function deviceIcon(platform: string): IconName {
  const value = platform.toLowerCase();
  if (value.includes("web") || value.includes("desktop")) return "laptop-outline";
  if (value.includes("tablet") || value.includes("ipad")) return "tablet-portrait-outline";
  return "phone-portrait-outline";
}

const styles = StyleSheet.create({
  section: {
    gap: space[2],
  },
  ruled: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: RULE,
  },
  status: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    padding: space[4],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.color.field["200"],
    backgroundColor: theme.color.field["0"],
  },
  statusWell: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: {
    flex: 1,
    minWidth: 0,
    gap: space[1],
  },
  statusTitle: {
    fontSize: 15.5,
    lineHeight: 21,
  },
  statusBody: {
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
  },
  statusMeta: {
    marginTop: 2,
    fontSize: 12.5,
    lineHeight: 17,
    color: MUTED,
  },
  device: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  deviceWell: {
    marginTop: 2,
    backgroundColor: theme.color.field["100"],
  },
  current: {
    color: KOLA_DEEP,
    letterSpacing: 0.4,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    marginTop: space[2],
  },
  action: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: theme.color.kola["50"],
  },
  actionDanger: {
    backgroundColor: theme.color.laterite["100"],
  },
  actionText: {
    fontSize: 13,
    lineHeight: 17,
    color: KOLA_DEEP,
  },
  dim: {
    opacity: 0.5,
  },
  advice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: 14,
  },
  adviceWell: {
    marginTop: 2,
    backgroundColor: theme.color.kola["50"],
  },
  adviceTitle: {
    fontSize: 14.5,
    lineHeight: 20,
    color: INK,
  },
});
