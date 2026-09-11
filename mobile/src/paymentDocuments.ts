import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { apiFetchBytes } from "@/api";
import type { PaymentReceipt } from "@/payments";

/** The frozen PDF issued when the provider confirmed a payment, rent or subscription. */
async function localReceipt(receiptId: string, reference: string): Promise<File> {
  const name = reference.replace(/[^a-zA-Z0-9-]/g, "-");
  const file = new File(Paths.cache, `rooomly-receipt-${name}.pdf`);
  if (file.exists) file.delete();
  file.create();
  file.write(
    await apiFetchBytes(
      `/payments/receipts/${receiptId}/document.pdf?disposition=inline`,
    ),
  );
  return file;
}

async function shareFile(file: File) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Document sharing is not available.");
  }
  await Sharing.shareAsync(file.uri, {
    dialogTitle: "Open or save Rooomly receipt",
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
  });
}

/** Opens the native document sheet, where the receipt can be viewed or saved. */
export async function sharePaymentReceipt(receipt: PaymentReceipt) {
  await shareFile(await localReceipt(receipt.id, receipt.receipt_number));
}

export async function printPaymentReceipt(receipt: PaymentReceipt) {
  const file = await localReceipt(receipt.id, receipt.receipt_number);
  await Print.printAsync({ uri: file.uri });
}

/**
 * A subscription payment's receipt, from the invoice that lists it. The invoice
 * row carries the receipt's id and its own number, which names the file.
 */
export async function shareReceiptDocument(receiptId: string, reference: string) {
  await shareFile(await localReceipt(receiptId, reference));
}
