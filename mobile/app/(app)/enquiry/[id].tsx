import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexGround } from "@/components/account/IndexRows";
import { Fact, LinkRow, RecordPanel } from "@/components/record/RecordSurfaces";
import { Button, Field, Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { getEnquiry, proposeEnquiryCall, type EnquiryDetail } from "@/sales";
/** Notification targets and historical IDs continue to resolve to an authorized record. */
export default function EnquiryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useAuth();
  if (state.status !== "signed_in") return <AuthPrompt title="Property interest" body="Sign in to view this interest." next={`/(app)/enquiry/${id}`} />;
  return <InterestRecord key={`${state.me.id}:${id}`} id={id} />;
}
function InterestRecord({ id }: { id: string }) {
  const router = useRouter();
  const bottom = useSafeBottom(space[12]);
  const [record, setRecord] = useState<EnquiryDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (id) void getEnquiry(id).then((data) => { if (live) setRecord(data); })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not open this interest."); });
    return () => { live = false; };
  }, [id]);

  return <IndexGround><Stack.Screen options={{ title: "Property interest" }} /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space[5], paddingBottom: bottom, gap: space[5] }}>
    {error ? <Notice tone="error" title={error} /> : null}
    {record ? <><Type variant="title1">{record.sale.headline || "Property for sale"}</Type><RecordPanel>
      <Fact first label="Buyer" value={record.buyer_name} />
      <Fact label="Interest recorded" value={new Date(record.created_at).toLocaleDateString("en-GH")} />
      <Fact label="Status" value={record.sale.status === "sold" ? "Property sold" : record.status === "closed" ? "Closed" : record.proposed_call_at ? "Accepted" : "Awaiting provider response"} />
      <LinkRow icon="business-outline" label="View property" onPress={() => record.role === "seller" ? router.push({ pathname: "/(app)/provider-property", params: { propertyId: record.sale.property_id } }) : router.push({ pathname: "/(app)/sale/[id]", params: { id: record.sale.id } })} />
    </RecordPanel>
    <InterestCall record={record} onUpdated={setRecord} />
    {record.contact_phone && record.contact_email ? <>
      <Type variant="bodyStrong">{record.role === "seller" ? "Buyer contact details" : "Contact details you shared"}</Type>
      <RecordPanel>
        <Fact first label="Phone" value={record.contact_phone} />
        <Fact label="Email" value={record.contact_email} />
        {record.role === "seller" ? <>
          <LinkRow icon="call-outline" label="Call buyer" onPress={() => void Linking.openURL(`tel:${record.contact_phone}`).catch(() => setError("Could not open the phone app."))} />
          <LinkRow icon="mail-outline" label="Email buyer" onPress={() => void Linking.openURL(`mailto:${encodeURIComponent(record.contact_email!).replace(/%40/g, "@")}`).catch(() => setError("Could not open your email app."))} />
        </> : null}
      </RecordPanel>
    </> : null}
    {record.messages[0] ? <><Type variant="bodyStrong">Original enquiry note</Type><Type variant="body">{record.messages[0].body}</Type></> : null}
    </> : !error ? <Type variant="body" accessibilityRole="progressbar">Loading interest…</Type> : null}
  </ScrollView></IndexGround>;
}

function InterestCall({ record, onUpdated }: { record: EnquiryDetail; onUpdated: (record: EnquiryDetail) => void }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canPropose = record.role === "seller" && record.status === "open" && record.sale.status === "active";
  const proposed = record.proposed_call_at ? new Date(record.proposed_call_at) : null;
  if (!proposed && !canPropose) return null;

  async function submit() {
    if (busy) return;
    const input = `${date}T${time}:00Z`;
    const instant = new Date(input);
    if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 16) !== `${date}T${time}` || instant.getTime() <= Date.now()) {
      setError("Enter a valid future date and time in Ghana time.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      onUpdated(await proposeEnquiryCall(record.id, input));
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the call time. Try again.");
    } finally { setBusy(false); }
  }

  return <RecordPanel style={{ padding: space[4], gap: space[3] }}>
    {proposed ? <View accessibilityLiveRegion="polite">
      <Type variant="bodyStrong">Proposed call time</Type>
      <Type variant="body">{proposed.toLocaleString("en-GH", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} · Ghana time</Type>
    </View> : null}
    {canPropose && (editing ? <>
      <Type variant="bodyStrong">Choose a call time</Type>
      <Type variant="caption">Enter the date and time in Ghana time (GMT).</Type>
      <Field label="Call date" placeholder="YYYY-MM-DD" value={date} keyboardType="number-pad" maxLength={10} editable={!busy} onChangeText={(value) => {
        const digits = value.replace(/\D/g, "").slice(0, 8);
        setDate([digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)].filter(Boolean).join("-"));
      }} />
      <Field label="Call time" hint="24-hour time, for example 14:30" placeholder="HH:MM" value={time} keyboardType="number-pad" maxLength={5} editable={!busy} onChangeText={(value) => {
        const digits = value.replace(/\D/g, "").slice(0, 4);
        setTime([digits.slice(0, 2), digits.slice(2)].filter(Boolean).join(":"));
      }} />
      {error ? <Notice tone="error" title={error} /> : null}
      <Button label={proposed ? "Send new time" : "Accept and send time"} busy={busy} busyLabel="Sending…" onPress={() => void submit()} />
      <Button label="Cancel" variant="quiet" disabled={busy} onPress={() => setEditing(false)} />
    </> : <Button label={proposed ? "Offer a different time" : "Accept interest and offer a call time"} variant="secondary" onPress={() => {
      const existing = proposed && proposed.getTime() > Date.now() ? proposed.toISOString() : "";
      setDate(existing.slice(0, 10));
      setTime(existing.slice(11, 16));
      setError("");
      setEditing(true);
    }} />)}
  </RecordPanel>;
}
