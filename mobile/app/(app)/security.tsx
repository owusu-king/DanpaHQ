import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";

import { apiFetch, ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { Button, Notice, Surface, Type, space } from "@/components/ui";
import { destructiveConfirmStyle, pressableFeedback } from "@/platform";
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
 */
export default function SecurityScreen() {
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
    <ScrollView contentContainerStyle={{ padding: space[5], gap: space[5] }}>
      {error ? <Notice tone="error" title={error} /> : null}

      {status?.payouts_held ? (
        <Notice
          tone="warning"
          title="Payouts are paused for now"
          body={`${status.reasons.join(" ")} This lasts about ${Math.ceil(
            status.hold_remaining_hours,
          )} more hours. You can use everything else as normal.`}
        />
      ) : status && status.reasons.length > 0 ? (
        <Notice
          tone="info"
          title="Worth knowing"
          body={status.reasons.join(" ")}
        />
      ) : status ? (
        <Notice tone="success" title="Nothing unusual on your account" />
      ) : null}

      <View style={{ gap: space[3] }}>
        <Type variant="title2">Devices signed in</Type>
        <Type variant="caption">
          Signing a device out ends its sessions; it can sign in again with a code sent
          to your number. Report it lost or stolen to stop it signing in at all.
        </Type>

        {devices === null ? (
          <ActivityIndicator color={theme.color.kola["600"]} />
        ) : (
          devices.map((device) => (
            <Surface key={device.id} style={{ gap: space[2] }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Type variant="bodyStrong">{device.label || device.platform}</Type>
                {device.is_current ? (
                  <Type variant="label" style={{ color: theme.color.kola["600"] }}>
                    THIS DEVICE
                  </Type>
                ) : null}
              </View>
              <Type variant="caption">
                Last used {new Date(device.last_seen_at).toLocaleString("en-GH")}
              </Type>
              {!device.is_current ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space[5],
                    opacity: removingDevice !== null && removingDevice !== device.id ? 0.5 : 1,
                  }}
                >
                  <Pressable
                    onPress={() => confirmSignOut(device)}
                    accessibilityRole="button"
                    accessibilityHint="Ends its sessions. It can sign in again with a code."
                    disabled={removingDevice !== null}
                    {...pressableFeedback(theme.color.kola["50"])}
                    style={{ minHeight: theme.targetMin, justifyContent: "center" }}
                  >
                    <Type variant="body" style={{ color: theme.color.kola["600"] }}>
                      {removingDevice === device.id ? "Working…" : "Sign out"}
                    </Type>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmBlock(device)}
                    accessibilityRole="button"
                    accessibilityHint="Blocks it from signing in. Only support can undo this."
                    disabled={removingDevice !== null}
                    {...pressableFeedback(theme.color.laterite["100"])}
                    style={{ minHeight: theme.targetMin, justifyContent: "center" }}
                  >
                    <Type variant="body" style={{ color: theme.color.laterite["600"] }}>
                      Lost or stolen
                    </Type>
                  </Pressable>
                </View>
              ) : null}
            </Surface>
          ))
        )}
      </View>

      <View style={{ gap: space[3] }}>
        <Type variant="title2">Keeping your account safe</Type>
        <Surface style={{ gap: space[2] }}>
          <Type variant="body">
            We will never call or text asking for your code. Anyone who does is trying
            to take your account.
          </Type>
          <Type variant="caption">
            If your SIM is swapped or your number changes, payouts pause for three days so
            there is time to notice.
          </Type>
        </Surface>
      </View>

      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </ScrollView>
  );
}
