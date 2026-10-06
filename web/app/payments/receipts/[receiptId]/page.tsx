import { redirect } from "next/navigation";

/**
 * The receipt no longer has a page of its own: everything it showed is in the
 * receipt sheet (ReceiptModal), with Print and Download. A link to the old
 * address — a saved one, or one from an email — opens that sheet on Payments.
 */
export default async function PaymentReceiptRedirect({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  redirect(`/payments?receipt=${encodeURIComponent(receiptId)}` as never);
}
