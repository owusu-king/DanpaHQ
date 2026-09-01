import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { ServiceGlyph, TONE } from "@/components/services/ServiceGlyph";
import { Button, Field, Notice, Surface, Type, radius, space } from "@/components/ui";
import {
  detailTitle,
  forgetDetail,
  listRecentPurchases,
  maskDetail,
  saveDetail,
  type RecentPurchase,
  type SavedDetail,
  detailsFor,
} from "@/serviceAccounts";
import {
  isPurchase,
  serviceById,
  type IdentifierSpec,
  type Service,
} from "@/serviceCatalogue";
import { theme } from "@/theme";

/**
 * One service: what it does, and the number it will need.
 *
 * The screen exists because "coming soon" is not a destination. A tenant who
 * taps Electricity today gets something real to do — save the meter number, so
 * the day the biller opens the purchase is one tap instead of a hunt for the
 * meter card in a drawer. That is why `preparing` rows in the hub are pressable
 * and `later` rows are not: this screen has a job for the first and nothing
 * honest to offer the second.
 *
 * It never offers to buy. No biller is integrated and `apps.payments` registers
 * no production adapter, so a purchase button would be a lie with a spinner on
 * it. When that changes, the buy affordance belongs here, priced by the server
 * against an obligation and settled through the Payments Core — not by a
 * checkout this screen invents.
 */
export default function ServiceScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const service = typeof id === "string" ? serviceById(id) : undefined;

  const [saved, setSaved] = useState<SavedDetail[]>([]);
  const [recent, setRecent] = useState<RecentPurchase[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!service) return;
    try {
      const [details, purchases] = await Promise.all([
        detailsFor(service.id),
        listRecentPurchases(),
      ]);
      setSaved(details);
      setRecent(purchases.filter((row) => row.serviceId === service.id));
      setError("");
    } catch {
      setError("We could not read your saved details on this device.");
    } finally {
      setLoaded(true);
    }
  }, [service]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!service) {
    return (
      <View style={{ padding: space[5], gap: space[4] }}>
        <Stack.Screen options={{ title: "Service" }} />
        <Notice
          tone="error"
          title="We could not find that service"
          body="It may have been renamed. Open Services and choose it again."
        />
        <Button label="Back to Services" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: space[5], paddingBottom: space[12], gap: space[6] }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: service.label }} />

      <Masthead service={service} />

      {error ? <Notice tone="info" title={error} /> : null}

      {service.identifier ? (
        <SavedDetails
          service={service}
          spec={service.identifier}
          details={saved}
          loaded={loaded}
          onChanged={setSaved}
          onError={setError}
        />
      ) : null}

      {recent.length ? <ServiceHistory purchases={recent} /> : null}

      <HowItWillWork service={service} />
    </ScrollView>
  );
}

/**
 * The service, stated once, in its own colour.
 *
 * The status line is the honest part and it is not a badge — a chip saying
 * "Coming soon" beside a heading reads as decoration. A sentence reads as a
 * statement.
 */
function Masthead({ service }: { service: Service }) {
  const tone = TONE[service.tone];
  return (
    <View style={{ gap: space[4] }}>
      <ServiceGlyph service={service} size={56} />
      <View style={{ gap: space[2] }}>
        <Type variant="display2" accessibilityRole="header">
          {service.label}
        </Type>
        <Type variant="body" style={{ color: theme.color.ink["700"] }}>
          {service.promise}
        </Type>
      </View>
      <View style={[styles.statusRow, { backgroundColor: tone.wash }]}>
        <Ionicons name="time-outline" size={16} color={tone.ink} />
        <Type variant="caption" style={{ color: tone.ink, flex: 1 }}>
          Not open for purchases yet. Save your details now and buying will be one tap.
        </Type>
      </View>
    </View>
  );
}

/**
 * The numbers this household reuses for this service.
 *
 * The whole reason the screen is worth opening today. Adding one is a real,
 * completed action with a real result, which is what separates this from a
 * waiting list.
 */
function SavedDetails({
  service,
  spec,
  details,
  loaded,
  onChanged,
  onError,
}: {
  service: Service;
  /** Passed in rather than read off `service`: this component only exists for
      a service that has one, and the caller is where that is decided. */
  spec: IdentifierSpec;
  details: SavedDetail[];
  loaded: boolean;
  onChanged: (details: SavedDetail[]) => void;
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const compact = value.replace(/\s+/g, "");
  const tooShort = compact.length > 0 && compact.length < spec.minLength;

  async function save() {
    setFieldError("");
    if (compact.length < spec.minLength || compact.length > spec.maxLength) {
      setFieldError(
        `A ${spec.label.toLowerCase()} is ${spec.minLength}–${spec.maxLength} digits.`,
      );
      return;
    }
    setBusy(true);
    try {
      const next = await saveDetail({
        serviceId: service.id,
        value: compact,
        nickname,
      });
      onChanged(next.filter((row) => row.serviceId === service.id));
      setJustSaved(compact);
      setValue("");
      setNickname("");
      setAdding(false);
    } catch {
      onError("We could not save that on this device.");
    } finally {
      setBusy(false);
    }
  }

  function confirmForget(detail: SavedDetail) {
    Alert.alert(
      `Forget ${detailTitle(detail)}?`,
      "It is removed from this device. Nothing you have already paid for changes.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => {
            void forgetDetail(service.id, detail.value)
              .then((next) => onChanged(next.filter((row) => row.serviceId === service.id)))
              .catch(() => onError("We could not remove that on this device."));
          },
        },
      ],
    );
  }

  return (
    <View style={{ gap: space[3] }}>
      <View style={{ gap: space[1] / 2 }}>
        <Type variant="title2">Your {spec.label.toLowerCase()}s</Type>
        <Type variant="caption">
          Kept on this phone only, so nobody types them twice.
        </Type>
      </View>

      {justSaved ? (
        <Notice
          tone="success"
          title="Saved"
          body={`${maskDetail(justSaved)} is ready for when ${service.label} opens.`}
        />
      ) : null}

      {!loaded ? (
        <Surface style={{ gap: space[2] }}>
          <View style={[styles.bone, { width: 120, height: 14 }]} />
          <View style={[styles.bone, { width: 180, height: 12 }]} />
        </Surface>
      ) : details.length ? (
        <Surface style={{ paddingVertical: space[1] }}>
          {details.map((detail, index) => (
            <View key={detail.value} style={[styles.row, index === 0 ? null : styles.ruled]}>
              <View style={{ flex: 1, gap: space[1] / 2 }}>
                <Type variant="bodyStrong">{detailTitle(detail)}</Type>
                <Type variant="caption" style={{ fontFamily: "monospace" }}>
                  {maskDetail(detail.value)}
                  {detail.useCount ? ` · used ${detail.useCount}×` : ""}
                </Type>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Forget ${detailTitle(detail)}`}
                hitSlop={space[2]}
                onPress={() => confirmForget(detail)}
              >
                <Ionicons name="close-circle-outline" size={22} color={theme.color.ink["300"]} />
              </Pressable>
            </View>
          ))}
        </Surface>
      ) : (
        <Surface style={{ gap: space[2] }}>
          <Type variant="bodyStrong">Nothing saved yet</Type>
          <Type variant="caption">
            Add the {spec.label.toLowerCase()} once and it is here whenever you need it.
          </Type>
        </Surface>
      )}

      {adding ? (
        <Surface style={{ gap: space[4] }}>
          <Field
            label={spec.label}
            hint={spec.hint}
            error={fieldError || (tooShort ? "" : undefined)}
            value={value}
            onChangeText={setValue}
            keyboardType={spec.keyboard}
            maxLength={spec.maxLength}
            autoFocus
          />
          <Field
            label="Name it (optional)"
            hint="Upstairs meter, Mum's line — whatever your household calls it."
            value={nickname}
            onChangeText={setNickname}
            maxLength={40}
          />
          <Button label="Save" busy={busy} busyLabel="Saving…" onPress={() => void save()} />
          <Button
            label="Cancel"
            variant="quiet"
            disabled={busy}
            onPress={() => {
              setAdding(false);
              setFieldError("");
              setValue("");
              setNickname("");
            }}
          />
        </Surface>
      ) : (
        <Button
          label={details.length ? `Add another ${spec.label.toLowerCase()}` : `Add a ${spec.label.toLowerCase()}`}
          variant="secondary"
          onPress={() => {
            setJustSaved(null);
            setAdding(true);
          }}
        />
      )}
    </View>
  );
}

/** What has been bought here. Server-backed; empty until a biller lands. */
function ServiceHistory({ purchases }: { purchases: RecentPurchase[] }) {
  return (
    <View style={{ gap: space[3] }}>
      <Type variant="title2">History</Type>
      <Surface style={{ paddingVertical: space[1] }}>
        {purchases.map((purchase, index) => (
          <View key={purchase.id} style={[styles.row, index === 0 ? null : styles.ruled]}>
            <View style={{ flex: 1, gap: space[1] / 2 }}>
              <Type variant="bodyStrong">{purchase.maskedValue}</Type>
              <Type variant="caption">{purchase.at}</Type>
            </View>
            <Type variant="caption">{purchase.status}</Type>
          </View>
        ))}
      </Surface>
    </View>
  );
}

/**
 * How the money will move, said before it moves.
 *
 * Here because the alternative is each new service quietly growing its own
 * checkout. Rooomly already has server-priced intents, one open intent per
 * obligation, immutable provider transactions, allocation, a balanced ledger,
 * receipts and reconciliation. A second payment path beside that would have
 * none of it and would look, from a tenant's side, exactly the same.
 */
function HowItWillWork({ service }: { service: Service }) {
  return (
    <View style={styles.footnote}>
      <Type variant="label">WHEN THIS OPENS</Type>
      <Type variant="caption">
        {isPurchase(service)
          ? "You will see the price before you pay, pay through the same checkout and receipts your rent uses, and keep a record you can show later."
          : "You will book through Rooomly and follow what happens next in one place."}
      </Type>
    </View>
  );
}

const styles = {
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: theme.targetMin,
    paddingVertical: space[3],
    paddingHorizontal: space[1],
  },
  ruled: {
    borderTopWidth: 1,
    borderTopColor: theme.color.field["200"],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    padding: space[3],
    borderRadius: radius.md,
  },
  bone: {
    borderRadius: radius.md,
    backgroundColor: theme.color.field["100"],
  },
  footnote: {
    gap: space[2],
    paddingTop: space[5],
    borderTopWidth: 1,
    borderTopColor: theme.color.field["200"],
  },
} as const;
