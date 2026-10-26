import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView } from "react-native";
import { ApiFailure } from "@/api";
import { useAuth } from "@/auth";
import { AuthPrompt } from "@/components/AuthPrompt";
import { IndexGround } from "@/components/account/IndexRows";
import { LinkRow, RecordPanel } from "@/components/record/RecordSurfaces";
import { Notice, Type, space } from "@/components/ui";
import { useSafeBottom } from "@/platform";
import { listEnquiries, type Enquiry } from "@/sales";
export default function SaleInterestsScreen() {
  const { state } = useAuth();
  const router = useRouter();
  const bottom = useSafeBottom(space[12]);
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [error, setError] = useState("");
  const signedIn = state.status === "signed_in";
  const canSell = signedIn && state.me.capabilities.provider.workspace_access;
  useFocusEffect(useCallback(() => {
    let live = true;
    if (signedIn) void listEnquiries(canSell ? "all" : "buyer").then((data) => { if (live) { setRows(data); setError(""); } })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not load property interests."); });
    return () => { live = false; };
  }, [signedIn, canSell]));
  if (!signedIn) return <AuthPrompt title="Property interests" body="Sign in to view your property interests." next="/(app)/sale-interests" />;
  return <IndexGround><ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: bottom, gap: space[4] }}>
    <Type variant="title1">Property interests</Type>
    {error ? <Notice tone="error" title={error} /> : null}
    {rows ? rows.length ? <RecordPanel>{rows.map((row, index) => <LinkRow key={row.id} first={index === 0} icon="heart-outline" label={row.sale.headline || "Property for sale"} detail={`${row.role === "seller" ? row.buyer_name : "Your interest"}${row.unread ? " · New" : ""}`} onPress={() => router.push({ pathname: "/(app)/enquiry/[id]", params: { id: row.id } })} />)}</RecordPanel> : <Type variant="body">No property interests yet.</Type> : !error ? <Type variant="body" accessibilityRole="progressbar">Loading property interests…</Type> : null}
  </ScrollView></IndexGround>;
}
