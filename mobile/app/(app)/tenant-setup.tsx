import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { apiFetch, ApiFailure, idempotentMutation } from "@/api";
import { Button, Field, Notice, Surface, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { theme } from "@/theme";

type LookupUnit = {
  id: string;
  label: string;
  beds: { id: string; label: string }[];
};

type Lookup = {
  id: string;
  title: string;
  locality: string;
  units: LookupUnit[];
};

export default function TenantSetupScreen() {
  // Android draws edge-to-edge: the last row would sit under the
  // navigation buttons, which then look as though the page showed through.
  const pageBottom = useSafeBottom(space[8]);
  const router = useRouter();
  const [accessCode, setAccessCode] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [unitId, setUnitId] = useState("");
  const [bedId, setBedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedUnit = lookup?.units.find((unit) => unit.id === unitId) ?? null;

  async function findSpace() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await apiFetch<Lookup>(
        `/property-join-lookup/?code=${encodeURIComponent(accessCode.trim())}`,
      );
      setLookup(result);
      setUnitId(result.units[0]?.id ?? "");
      setBedId("");
    } catch (cause) {
      setLookup(null);
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not find the Unit.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!lookup || !unitId) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/properties/${lookup.id}/join-requests/`, {
        method: "POST",
        body: {
          unit_id: unitId,
          bed_id: bedId || undefined,
          access_code: accessCode.trim(),
        },
        ...idempotentMutation(),
      });
      setSuccess("The provider must approve your tenancy request before preparing a lease offer.");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the tenancy request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: pageBottom, gap: space[5] }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: space[2] }}>
        <Type variant="label">YOUR HOMES</Type>
        <Type variant="display2">Add a home</Type>
        <Type variant="body">Enter the access code shared by the provider. It identifies one verified private Unit and lets you send a tenancy request.</Type>
      </View>

      <Surface style={{ gap: space[3] }}>
        <Type variant="title2">I have a Unit access code</Type>
        <Type variant="caption">A code never creates a tenancy. Request approval, review the lease offer, then accept it to activate the tenancy.</Type>
        <Field
          label="Unit access code"
          value={accessCode}
          onChangeText={(value) => {
            setAccessCode(value);
            setLookup(null);
            setUnitId("");
            setBedId("");
          }}
          autoCapitalize="characters"
        />
        <Button label="Find Unit" variant="secondary" onPress={findSpace} busy={busy} disabled={!accessCode.trim()} />

        {lookup ? (
          <View style={{ gap: space[2] }}>
            <Type variant="bodyStrong">{lookup.title}</Type>
            <Type variant="caption">{lookup.locality}</Type>
            {lookup.units.map((unit) => (
              <Pressable
                key={unit.id}
                onPress={() => { setUnitId(unit.id); setBedId(""); }}
                accessibilityRole="radio"
                aria-selected={unitId === unit.id}
                style={{ padding: space[3], borderWidth: unitId === unit.id ? 2 : 1, borderColor: unitId === unit.id ? theme.color.kola["600"] : theme.color.field["300"], borderRadius: 8 }}
              >
                <Type variant="bodyStrong">{unit.label}</Type>
              </Pressable>
            ))}
            {selectedUnit?.beds.length ? (
              <View style={{ gap: space[2] }}>
                <Type variant="caption">Choose the hostel bed you are requesting.</Type>
                {selectedUnit.beds.map((bed) => (
                  <Button key={bed.id} label={bed.label} variant="secondary" selected={bedId === bed.id} onPress={() => setBedId(bed.id)} />
                ))}
              </View>
            ) : null}
            <Button label="Send tenancy request" onPress={submitRequest} busy={busy} disabled={!unitId || Boolean(selectedUnit?.beds.length && !bedId)} />
          </View>
        ) : null}
      </Surface>

      {error ? <Notice tone="error" title={error} /> : null}
      {success ? <Notice tone="success" title="Tenancy request sent" body={success} /> : null}
      <Button label="Back to Home" variant="secondary" onPress={() => router.replace("/(app)/(tabs)" as never)} />
      <Button label="Browse rentals" variant="quiet" onPress={() => router.push("/(app)/(tabs)/explore" as never)} />
    </ScrollView>
  );
}
