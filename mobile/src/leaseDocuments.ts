import type { File } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { apiFetchBytes } from "@/api";
import type { Lease } from "@/leases";
import { cachePrivateDocument } from "@/privateDocuments";

async function localAgreement(lease: Lease): Promise<File> {
  const reference = (lease.agreement?.reference_number || lease.id).replace(/[^a-zA-Z0-9-]/g, "-");
  return cachePrivateDocument(`rooomly-agreement-${reference}.pdf`, () =>
    apiFetchBytes(`/leases/${lease.id}/document.pdf?disposition=inline`));
}

/** Opens the native document sheet, where the PDF can be viewed or saved. */
export async function shareLeaseDocument(lease: Lease) {
  const file = await localAgreement(lease);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Document sharing is not available.");
  await Sharing.shareAsync(file.uri, {
    dialogTitle: "Open or save Rooomly agreement",
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
  });
}

export async function printLeaseDocument(lease: Lease) {
  const file = await localAgreement(lease);
  await Print.printAsync({ uri: file.uri });
}
