import { paystackAccessCode, type PaymentIntent } from "@/lib/payments";

export type PaystackPopupCallbacks = {
  onSuccess: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
};

/** Resume a transaction initialized by Rooomly's backend inside Paystack's
 * official in-page checkout. The callback is navigation/status UX only; the
 * backend webhook/verification endpoint remains the payment authority. */
export async function openPaystackPopup(
  intent: PaymentIntent,
  callbacks: PaystackPopupCallbacks,
): Promise<boolean> {
  const accessCode = paystackAccessCode(intent);
  if (!accessCode) return false;

  const { default: PaystackPop } = await import("@paystack/inline-js");
  const popup = new PaystackPop();
  popup.resumeTransaction(accessCode, {
    onSuccess: callbacks.onSuccess,
    onCancel: callbacks.onCancel,
    onError: (error) => callbacks.onError(error.message || "Secure checkout could not load."),
  });
  return true;
}
