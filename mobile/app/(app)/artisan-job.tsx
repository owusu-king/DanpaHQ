import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useLayoutEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ApiFailure } from "@/api";
import {
  INVITATION_STATE_LABEL,
  declineInvitation,
  getMyInvitation,
  submitQuote,
  submitRevision,
  toMinor,
  withdrawQuote,
  type ArtisanInvitation,
  type Material,
} from "@/artisan";
import { shortDate } from "@/components/artisan/ArtisanChips";
import { GroupLabel, Pill, Quote, RecordPanel } from "@/components/record/RecordSurfaces";
import { Field, Notice, Type, space } from "@/components/ui";
import { pressableFeedback, useSafeBottom } from "@/platform";
import { alpha } from "@/shell";
import { theme } from "@/theme";

/**
 * An artisan's own invitation or job. Mirrors web's invitation sheet, as a page.
 *
 * One record at two moments. Invited, it shows the problem, its photograph and
 * the area — and the quote form. Assigned, it also shows what the payer's
 * approval unlocked: the address, the contact on site with a call button, who
 * approved, the price on record and the request's history, with a way to ask
 * for a revised price. Nothing here is fetched before the backend allows it.
 */

const AMBER = theme.color.harmattan["600"];
const KOLA = theme.color.kola["600"];
const MUTED = theme.color.ink["500"];
const WHITE = theme.color.field["0"];
const DEEP = theme.color.kola["900"];

export default function ArtisanJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const pageBottom = useSafeBottom(space[10]);
  const [row, setRow] = useState<ArtisanInvitation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    try {
      setRow(await getMyInvitation(id));
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "This did not open.");
    }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useLayoutEffect(() => {
    navigation.setOptions({ title: row ? row.request.category_display : "Job" });
  }, [navigation, row]);

  async function act(run: () => Promise<ArtisanInvitation>, message: string) {
    setBusy(true);
    setError("");
    try {
      setRow(await run());
      setDone(message);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "That did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!row) {
    return (
      <View style={styles.center}>
        {error ? <Notice tone="error" title={error} /> : <ActivityIndicator color={AMBER} />}
      </View>
    );
  }

  const job = row.unlocked ? row.job : undefined;
  const pending = row.quotes.find((quote) => quote.status === "submitted");

  return (
    <ScrollView style={styles.ground} contentContainerStyle={[styles.page, { paddingBottom: pageBottom }]} keyboardShouldPersistTaps="handled">
      <View style={styles.column}>
        <View style={styles.state}>
          <Type variant="captionStrong" style={{ color: row.state === "assigned" ? theme.color.kola["800"] : AMBER }}>
            {INVITATION_STATE_LABEL[row.state]}
          </Type>
        </View>
        {done ? <Notice tone="success" title={done} /> : null}
        {error ? <Notice tone="error" title={error} /> : null}

        {job ? (
          <RecordPanel style={styles.unlocked}>
            <Line icon="location-outline" title={job.address.line} detail={[job.place.unit_label, job.address.digital_address, job.address.landmark].filter(Boolean).join(" · ")} />
            <View style={styles.contact}>
              <Line icon="person-outline" title={job.contact.name} detail={job.contact.role} />
              {job.contact.phone ? (
                <Pressable
                  onPress={() => void Linking.openURL(`tel:${job.contact.phone.replace(/\s/g, "")}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${job.contact.name}`}
                  {...pressableFeedback(alpha(KOLA, 0.12))}
                  style={styles.call}
                >
                  <Ionicons name="call" size={16} color={WHITE} />
                  <Type variant="captionStrong" style={{ color: WHITE }}>{job.contact.phone}</Type>
                </Pressable>
              ) : null}
            </View>
            <Type variant="caption" style={{ color: theme.color.ink["700"] }}>
              Approved by {job.approved_by}{job.approved_at ? ` on ${shortDate(job.approved_at)}` : ""}
              {job.price_on_record ? ` · price on record ${job.price_on_record.price_display}` : ""}
            </Type>
          </RecordPanel>
        ) : (
          <View style={styles.private}>
            <Ionicons name="lock-closed-outline" size={16} color={AMBER} />
            <Type variant="caption" style={{ flex: 1, color: theme.color.ink["700"] }}>
              The address and a contact open here if your quote is approved.
            </Type>
          </View>
        )}

        {row.request.photo ? (
          <Pressable onPress={() => void Linking.openURL(row.request.photo!.url)} accessibilityRole="imagebutton" accessibilityLabel="Open the photo full size">
            <Image source={{ uri: row.request.photo.url }} style={styles.photo} />
          </Pressable>
        ) : null}
        <View style={{ gap: space[2] }}>
          <GroupLabel>
            {`${[row.request.area.locality, row.request.area.district].filter(Boolean).join(", ")} · reported ${shortDate(row.request.reported_at)}`}
          </GroupLabel>
          <Quote>{row.request.description}</Quote>
        </View>

        {row.quotes.length ? (
          <View style={{ gap: space[2] }}>
            <GroupLabel>Your quotes</GroupLabel>
            {row.quotes.map((quote) => (
              <RecordPanel key={quote.id} style={styles.quote}>
                <Type variant="bodyStrong">{quote.revises ? "Revised: " : ""}{quote.price_display} · {quote.status_display}</Type>
                {quote.reason ? <Type variant="caption" style={{ color: AMBER }}>{quote.reason}</Type> : null}
                <Type variant="caption" style={{ color: theme.color.ink["700"] }}>{quote.scope}</Type>
                {quote.decision_note ? <Type variant="caption" style={{ color: AMBER }}>{quote.decision_note}</Type> : null}
              </RecordPanel>
            ))}
          </View>
        ) : null}

        {row.state === "invited" ? (
          <QuoteForm
            title="Send your quote"
            busy={busy}
            onSubmit={(input) => act(() => submitQuote(row.id, input), "Quote sent. You will hear when it is answered.")}
            secondary={{ label: "Decline", onPress: () => void act(() => declineInvitation(row.id), "Invitation declined.") }}
          />
        ) : pending && !pending.revises ? (
          <Pill tone="quiet" label="Withdraw quote" busy={busy} busyLabel="Withdrawing…" onPress={() => void act(() => withdrawQuote(pending.id), "Quote withdrawn.")} />
        ) : null}

        {row.state === "assigned" && !pending ? (
          <QuoteForm
            title="Found more work? Ask for a revised price"
            withReason
            busy={busy}
            onSubmit={(input) => act(() => submitRevision(row.request.id, input), "Revised price sent. Nothing changes until it is approved.")}
          />
        ) : null}

        {job?.history.length ? (
          <View style={{ gap: space[2] }}>
            <GroupLabel>History</GroupLabel>
            <RecordPanel style={styles.history}>
              {[...job.history].reverse().map((event, index) => (
                <View key={`${event.kind}-${index}`} style={{ gap: 2 }}>
                  <Type variant="captionStrong">{event.kind_display}</Type>
                  {event.note ? <Type variant="caption" style={{ color: theme.color.ink["700"] }}>{event.note}</Type> : null}
                  <Type variant="caption" style={{ color: MUTED, fontSize: 12 }}>{shortDate(event.at)}</Type>
                </View>
              ))}
            </RecordPanel>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Line({ icon, title, detail }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }) {
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={18} color={KOLA} />
      <View style={{ flex: 1, gap: 1 }}>
        <Type variant="bodyStrong">{title}</Type>
        {detail ? <Type variant="caption" style={{ color: MUTED }}>{detail}</Type> : null}
      </View>
    </View>
  );
}

function QuoteForm({
  title,
  busy,
  withReason = false,
  onSubmit,
  secondary,
}: {
  title: string;
  busy: boolean;
  withReason?: boolean;
  onSubmit: (input: { price_minor: number; scope: string; materials: Material[]; reason: string }) => Promise<void>;
  secondary?: { label: string; onPress: () => void };
}) {
  const [price, setPrice] = useState("");
  const [scope, setScope] = useState("");
  const [reason, setReason] = useState("");
  const [materials, setMaterials] = useState<{ item: string; quantity: string; cost: string }[]>([]);
  const [attempted, setAttempted] = useState(false);
  const priceMinor = toMinor(price);
  const ready = priceMinor !== null && scope.trim().length >= 10 && (!withReason || reason.trim().length >= 10);

  function edit(index: number, patch: Partial<{ item: string; quantity: string; cost: string }>) {
    setMaterials((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  return (
    <RecordPanel style={styles.form}>
      <Type variant="title2">{title}</Type>
      {withReason ? (
        <Field label="What did you find?" value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="The tap body is cracked, so a washer will not hold." error={attempted && reason.trim().length < 10 ? "Say what changes the price." : undefined} />
      ) : null}
      <Field label="Price (GH₵)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="450.00" error={attempted && priceMinor === null ? "Enter the price." : undefined} />
      <Field label="What the price covers" value={scope} onChangeText={setScope} multiline maxLength={1000} placeholder="Replace the tap washer and reseal the sink trap." error={attempted && scope.trim().length < 10 ? "Say in a sentence what it covers." : undefined} />
      <Type variant="caption" style={{ color: MUTED }}>Materials (optional)</Type>
      {materials.map((row, index) => (
        <View key={index} style={styles.material}>
          <View style={{ flex: 2 }}><Field label="Item" value={row.item} onChangeText={(value) => edit(index, { item: value })} /></View>
          <View style={{ flex: 1 }}><Field label="Qty" value={row.quantity} onChangeText={(value) => edit(index, { quantity: value })} /></View>
          <View style={{ flex: 1 }}><Field label="GH₵" value={row.cost} onChangeText={(value) => edit(index, { cost: value })} keyboardType="decimal-pad" /></View>
          <Pressable onPress={() => setMaterials((current) => current.filter((_, at) => at !== index))} accessibilityRole="button" accessibilityLabel={`Remove material ${index + 1}`} hitSlop={8} style={styles.remove}>
            <Ionicons name="close-circle" size={22} color={MUTED} />
          </Pressable>
        </View>
      ))}
      {materials.length < 20 ? (
        <Pressable onPress={() => setMaterials((current) => [...current, { item: "", quantity: "", cost: "" }])} accessibilityRole="button" style={styles.addMaterial}>
          <Ionicons name="add" size={18} color={theme.color.lagoon["600"]} />
          <Type variant="captionStrong" style={{ color: theme.color.lagoon["600"] }}>Add a material</Type>
        </Pressable>
      ) : null}
      <View style={styles.acts}>
        <Pill
          label="Send"
          busy={busy}
          busyLabel="Sending…"
          onPress={() => {
            setAttempted(true);
            if (!ready || priceMinor === null) return;
            void onSubmit({
              price_minor: priceMinor,
              scope: scope.trim(),
              reason: reason.trim(),
              materials: materials.filter((row) => row.item.trim()).map((row) => ({ item: row.item.trim(), quantity: row.quantity.trim(), cost_minor: toMinor(row.cost) })),
            });
          }}
        />
        {secondary ? <Pill tone="quiet" label={secondary.label} onPress={secondary.onPress} /> : null}
      </View>
    </RecordPanel>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: theme.color.field["50"] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space[6] },
  page: { paddingTop: space[4], paddingHorizontal: space[4] },
  column: { width: "100%", maxWidth: 560, alignSelf: "center", gap: space[4] },
  state: { alignSelf: "flex-start", paddingVertical: 4, paddingHorizontal: space[3], borderRadius: 999, backgroundColor: theme.color.harmattan["100"] },
  unlocked: { gap: space[3], padding: space[4], borderColor: alpha(KOLA, 0.2), backgroundColor: theme.color.kola["50"] },
  line: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  contact: { flexDirection: "row", alignItems: "center", gap: space[3] },
  call: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: 999, backgroundColor: KOLA },
  private: { flexDirection: "row", alignItems: "center", gap: space[2], padding: space[3], borderRadius: 14, backgroundColor: theme.color.harmattan["100"] },
  photo: { width: "100%", height: 200, borderRadius: 18, backgroundColor: theme.color.field["100"] },
  quote: { gap: 4, padding: space[4] },
  form: { gap: space[3], padding: space[4] },
  material: { flexDirection: "row", alignItems: "flex-end", gap: space[2] },
  remove: { paddingBottom: space[3] },
  addMaterial: { flexDirection: "row", alignItems: "center", gap: space[1], alignSelf: "flex-start", paddingVertical: space[1] },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  history: { gap: space[3], padding: space[4], borderColor: alpha(DEEP, 0.08) },
});
