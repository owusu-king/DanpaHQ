import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexGround } from "@/components/account/IndexRows";
import { Fact, LinkRow, RecordPanel } from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { getEnquiry, type EnquiryDetail } from "@/sales";
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

  return <IndexGround><Stack.Screen options={{ title: "Property interest" }} /><ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: bottom, gap: space[5] }}>
    {error ? <Notice tone="error" title={error} /> : null}
    {record ? <><Type variant="title1">{record.sale.headline || "Property for sale"}</Type><RecordPanel>
      <Fact first label="Buyer" value={record.buyer_name} />
      <Fact label="Interest recorded" value={new Date(record.created_at).toLocaleDateString("en-GH")} />
      <Fact label="Status" value={record.sale.status === "sold" ? "Property sold" : record.status} />
      <LinkRow icon="business-outline" label="View property" onPress={() => record.role === "seller" ? router.push({ pathname: "/(app)/provider-property", params: { propertyId: record.sale.property_id } }) : router.push({ pathname: "/(app)/sale/[id]", params: { id: record.sale.id } })} />
    </RecordPanel><Type variant="body">{record.role === "buyer" ? "Your interest has been recorded for the seller." : "This buyer has expressed interest in your property."}</Type>
    {record.messages[0] ? <><Type variant="bodyStrong">Original enquiry note</Type><Type variant="body">{record.messages[0].body}</Type></> : null}
    </> : !error ? <Type variant="body" accessibilityRole="progressbar">Loading interest…</Type> : null}
  </ScrollView></IndexGround>;
}
