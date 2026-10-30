/** Compact confirmation for legacy verification links. Creation never opens it. */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { ApiFailure } from "@/api";
import { BottomSheet } from "@/components/sheet/BottomSheet";
import { Button, Notice, Type, space } from "@/components/ui";
import { getProperty, submitPropertyForVerification, type Property } from "@/provider";

export default function PropertyVerifyScreen() {
  const { propertyId } = useLocalSearchParams<{ propertyId: string }>();
  const router = useRouter();
  const [property, setProperty] = useState<Property | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const leave = () => { if (!pending.current) { if (router.canGoBack()) router.back(); else router.replace("/(app)/(provider-tabs)/properties" as never); } };
  useEffect(() => {
    if (!propertyId) return;
    let active = true;
    getProperty(propertyId).then((value) => { if (active) setProperty(value); }).catch(() => { if (active) setError("Could not load submission availability. Close and try again."); });
    return () => { active = false; };
  }, [propertyId]);
  const submit = property?.permitted_actions.submit_for_verification;
  return <BottomSheet visible onClose={leave} title="Submit for verification?" closeLabel="Cancel">
    <View style={{ gap: space[3], padding: space[4] }}>
      <Type variant="body">Send the property details, documents and photos to our team for review? It stays private.</Type>
      {error ? <Notice tone="error" title={error} /> : null}
      {property && !submit?.allowed ? <Notice tone="info" title="Submission unavailable" body={submit?.message} /> : null}
      <Button label="Confirm Submission" busy={busy} disabled={!submit?.allowed} onPress={async () => {
        if (pending.current || !propertyId || !submit?.allowed) return;
        pending.current = true; setBusy(true); setError("");
        try { await submitPropertyForVerification(propertyId); pending.current = false; leave(); }
        catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not send this for verification."); }
        finally { pending.current = false; setBusy(false); }
      }} />
      <Button label="Cancel" variant="quiet" disabled={busy} onPress={leave} />
    </View>
  </BottomSheet>;
}
