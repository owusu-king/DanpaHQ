import { CameraView, useCameraPermissions } from "expo-camera";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { ApiFailure } from "@/api";
import { Button, Field, Notice, Surface, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { theme } from "@/theme";
import { validateViewingCheckIn } from "@/viewings";

/** Provider scanner and manual fallback both terminate at the same backend validator. */
export default function ProviderViewingCheckInScreen() {
  // Android draws edge-to-edge: the last row would sit under the
  // navigation buttons, which then look as though the page showed through.
  const pageBottom = useSafeBottom(space[8]);
  const { viewingId } = useLocalSearchParams<{ viewingId: string }>();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState("");

  async function validate(input: { credential?: string; code?: string }) {
    if (!viewingId || busy) return;
    setBusy(true);
    setError("");
    try {
      await validateViewingCheckIn(viewingId, input);
      router.replace("/(app)/provider-viewings");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "This check-in could not be verified.");
      setScanned(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Type variant="display2">Check in tenant</Type>
        <Type variant="body">Scan the temporary QR shown on the tenant&apos;s Danpa HQ screen.</Type>
      </View>

      {manual ? (
        <Surface style={{ gap: space[3] }}>
          <Field
            label="6-digit check-in code"
            hint="Enter the code shown beneath the tenant's QR."
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
          />
          <Button label="Verify check-in" busy={busy} busyLabel="Checking…" disabled={code.length !== 6} onPress={() => validate({ code })} />
          <Button label="Scan QR instead" variant="quiet" disabled={busy} onPress={() => setManual(false)} />
        </Surface>
      ) : permission?.granted ? (
        <View style={{ gap: space[3] }}>
          <View style={{ height: 360, overflow: "hidden", borderRadius: 12, backgroundColor: theme.color.ink["900"] }}>
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={scanned || busy ? undefined : ({ data }) => {
                setScanned(true);
                void validate({ credential: data });
              }}
            />
          </View>
          <Type variant="caption" style={{ textAlign: "center" }}>Keep the QR inside the frame. No tenant or Property data is stored in it.</Type>
          <Button label="Enter code instead" variant="secondary" disabled={busy} onPress={() => setManual(true)} />
        </View>
      ) : (
        <Surface style={{ gap: space[3] }}>
          <Notice tone="info" title="Camera access is needed to scan" body="You can still use the six-digit code without camera access." />
          <Button label="Allow camera" onPress={() => void requestPermission()} />
          <Button label="Enter code instead" variant="secondary" onPress={() => setManual(true)} />
        </Surface>
      )}

      {error ? <Notice tone="error" title={error} /> : null}
    </ScrollView>
  );
}
