import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

let generation = 0;

/** Only Danpa HQ's temporary private PDFs; user-exported copies are untouched. */
export function clearPrivateDocuments() {
  generation += 1;
  if (Platform.OS === "web") return;
  for (const entry of new Directory(Paths.cache).list()) {
    if (entry instanceof File && /^danpahq-(agreement|receipt)-.*\.pdf$/.test(entry.name)) {
      entry.delete();
    }
  }
}

export async function cachePrivateDocument(name: string, load: () => Promise<Uint8Array>): Promise<File> {
  const started = generation;
  const bytes = await load();
  if (started !== generation) throw new Error("Sign in to open this document.");
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file;
}
