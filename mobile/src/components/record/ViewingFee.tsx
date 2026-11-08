import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { apiFetch, idempotentMutation } from "@/api";
import { Button, Notice, Type, space } from "@/components/ui";
import { PaystackCheckoutModal } from "@/components/payments/PaystackCheckoutModal";
import { createViewingFeeIntent, type DigitalPaymentMethod, type PaymentIntent } from "@/payments";
import { type Viewing } from "@/viewings";

export function ViewingFee({ viewing, tenant, onChanged }: { viewing: Viewing; tenant: boolean; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [method, setMethod] = useState<DigitalPaymentMethod>("mobile_money");
  const fee = viewing.fee;
  if (!fee || viewing.fee_policy?.mode === "disabled" || viewing.status === "requested") return null;
  const payable = Boolean(viewing.confirmed_starts_at) && !["cancelled", "declined", "withdrawn"].includes(viewing.status);
  const role = tenant ? "tenant" : "host";
  async function act(action: "pay" | "record-fee" | "confirm-fee") {
    setBusy(true); setError("");
    try {
      if (action === "pay") setIntent(await createViewingFeeIntent(viewing.id, method));
      else {
        await apiFetch(`/viewings/${viewing.id}/${action}/`, { method: "POST", body: {}, ...idempotentMutation() });
        await onChanged();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The payment action could not be completed."); }
    finally { setBusy(false); }
  }
  function returned() {
    const current = intent;
    setIntent(null);
    if (current) router.push({ pathname: "/(app)/payment-status", params: { intentId: current.id } } as never);
  }
  return <View style={{ gap: space[3] }}>
    <Type variant="title2">Viewing fee: {fee.amount_minor ? `GH₵${(fee.amount_minor / 100).toFixed(2)}` : "Free"}</Type>
    {fee.amount_minor ? <Type variant="body">{fee.status === "paid" ? "Payment confirmed." : fee.collection === "platform" ? "Pay through Danpa HQ after confirming a time." : "Pay the provider directly. Both parties confirm the payment record."} This fee is separate from rent.</Type> : null}
    {viewing.status === "offered" && fee.amount_minor ? <Type variant="caption">Confirming a time also accepts this viewing fee.</Type> : null}
    {error ? <Notice tone="error" title={error} /> : null}
    {payable && tenant && fee.collection === "platform" && fee.status === "unpaid" ? <>
      {(["mobile_money", "card", "bank_transfer"] as const).map((value) => <Button key={value} label={{ mobile_money: "Mobile money", card: "Card", bank_transfer: "Bank transfer" }[value]} variant="secondary" selected={method === value} onPress={() => setMethod(value)} />)}
      <Button label="Pay viewing fee" busy={busy} onPress={() => void act("pay")} />
    </> : null}
    {payable && fee.collection === "direct" && fee.status === "unpaid" ? <Button label="Record full fee paid" busy={busy} onPress={() => void act("record-fee")} /> : null}
    {fee.status === "claimed" ? <Type variant="caption">Awaiting the other party’s confirmation.</Type> : null}
    {fee.collection === "direct" && fee.status === "claimed" && fee.claimed_by !== role ? <Button label="Confirm fee received or paid" busy={busy} onPress={() => void act("confirm-fee")} /> : null}
    <PaystackCheckoutModal intent={intent} onClose={returned} onCheckoutReturn={returned} settles="Viewing fee" />
  </View>;
}
