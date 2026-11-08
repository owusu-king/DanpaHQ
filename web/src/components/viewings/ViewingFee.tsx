"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { idempotentMutation } from "@/lib/api";
import { authedFetch } from "@/lib/auth";
import { type Viewing } from "@/lib/console";
import { createViewingFeeIntent, paystackAccessCode, safeCheckoutUrl, type DigitalPaymentMethod } from "@/lib/payments";
import { openPaystackPopup } from "@/lib/paystackPopup";
import { formatMoney } from "@/lib/money";

export function ViewingFee({ viewing, tenant, onChanged }: { viewing: Viewing; tenant: boolean; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [method, setMethod] = useState<DigitalPaymentMethod>("mobile_money");
  const fee = viewing.fee;
  if (!fee || viewing.fee_policy?.mode === "disabled" || viewing.status === "requested") return null;
  const amount = formatMoney({ minor: fee.amount_minor, currency: fee.currency });
  const role = tenant ? "tenant" : "host";
  const payable = Boolean(viewing.confirmed_starts_at) && !["cancelled", "declined", "withdrawn"].includes(viewing.status);

  async function act(action: "pay" | "record-fee" | "confirm-fee") {
    setBusy(true);
    setError("");
    try {
      if (action !== "pay") {
        await authedFetch(`/viewings/${viewing.id}/${action}/`, { method: "POST", body: "{}", ...idempotentMutation() });
        await onChanged();
      } else {
        const intent = await createViewingFeeIntent(viewing.id, method);
        const returnTo = () => router.push(`/record/payment-return?intent=${encodeURIComponent(intent.id)}` as never);
        if (paystackAccessCode(intent)) {
          await openPaystackPopup(intent, { onSuccess: returnTo, onCancel: returnTo, onError: setError });
        } else {
          const url = safeCheckoutUrl(intent);
          if (url) window.location.assign(url);
          else returnTo();
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The payment action could not be completed.");
    } finally { setBusy(false); }
  }

  return <section className="vr-panel" aria-label="Viewing fee">
    <h3 className="vr-panel-title">Viewing fee: {fee.amount_minor ? amount : "Free"}</h3>
    {fee.amount_minor ? <p className="vr-panel-body">{fee.status === "paid" ? "Payment confirmed." : fee.collection === "platform" ? "Pay through Danpa HQ after confirming your time." : "Pay the provider directly. Both parties confirm the payment record."} This fee is separate from rent.</p> : null}
    {viewing.status === "offered" && fee.amount_minor ? <p>Confirming a time also accepts this viewing fee.</p> : null}
    {error ? <Notice tone="error" title={error} /> : null}
    {payable && fee.status === "unpaid" && tenant && fee.collection === "platform" ? <>
      <label>Payment method <select value={method} onChange={(event) => setMethod(event.target.value as DigitalPaymentMethod)}>
        <option value="mobile_money">Mobile money</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option>
      </select></label>
      <Button busy={busy} onClick={() => void act("pay")}>Pay viewing fee</Button>
    </> : null}
    {payable && fee.collection === "direct" && fee.status === "unpaid" ? <Button busy={busy} onClick={() => void act("record-fee")}>Record full fee paid</Button> : null}
    {fee.status === "claimed" ? <p>Payment recorded; awaiting the other party’s confirmation.</p> : null}
    {fee.collection === "direct" && fee.status === "claimed" && fee.claimed_by !== role ? <Button busy={busy} onClick={() => void act("confirm-fee")}>Confirm fee received or paid</Button> : null}
  </section>;
}
