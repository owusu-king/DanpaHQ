import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { apiFetchBytes } from "@/api";
import type { PaymentReceipt } from "@/payments";

async function localReceipt(receipt: PaymentReceipt): Promise<File> {
  const reference = receipt.receipt_number.replace(/[^a-zA-Z0-9-]/g, "-");
  const file = new File(Paths.cache, `rooomly-receipt-${reference}.pdf`);
  if (file.exists) file.delete();
  file.create();
  file.write(
    await apiFetchBytes(
      `/payments/receipts/${receipt.id}/document.pdf?disposition=inline`,
    ),
  );
  return file;
}

/** Opens the native document sheet, where the receipt can be viewed or saved. */
export async function sharePaymentReceipt(receipt: PaymentReceipt) {
  const file = await localReceipt(receipt);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Document sharing is not available.");
  }
  await Sharing.shareAsync(file.uri, {
    dialogTitle: "Open or save Rooomly receipt",
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
  });
}

export async function printPaymentReceipt(receipt: PaymentReceipt) {
  const file = await localReceipt(receipt);
  await Print.printAsync({ uri: file.uri });
}
