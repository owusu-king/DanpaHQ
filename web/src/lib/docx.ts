/**
 * The words of a Word document, for a terms template.
 *
 * A `.docx` is a zip holding `word/document.xml`. Terms templates are plain
 * wording, so the text is all that is wanted: paragraphs become lines, and
 * tabs and line breaks survive. Formatting, images and tracked changes do not,
 * and the import says so rather than pretending otherwise.
 *
 * No library: the zip directory is read directly and the one entry inflated
 * with the browser's `DecompressionStream`. Placeholders written the way other
 * tools write them — `{{tenant_name}}` or a Word merge field's `«tenant_name»` —
 * become Rooomly's `${tenant_name}` when the name is one Rooomly can fill.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export class DocxError extends Error {}

export async function readDocxText(file: Blob, knownPlaceholders: Iterable<string> = []): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const xml = await readEntry(bytes, "word/document.xml");
  const text = paragraphs(xml);
  return normalisePlaceholders(text, new Set(knownPlaceholders));
}

async function readEntry(bytes: Uint8Array, name: string): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (view.getUint32(at, true) === EOCD) { end = at; break; }
  }
  if (end < 0) throw new DocxError("That file isn’t a Word document (.docx).");

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== CENTRAL) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const entryName = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;

    if (view.getUint32(localAt, true) !== LOCAL) break;
    const dataAt = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const data = bytes.subarray(dataAt, dataAt + compressedSize);
    if (method === 0) return decoder.decode(data);
    if (method !== 8) break;
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  }
  throw new DocxError("That file isn’t a Word document (.docx), or it could not be read.");
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function paragraphs(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new DocxError("That Word document could not be read.");
  const lines: string[] = [];
  for (const paragraph of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
    let line = "";
    const walk = (node: Element) => {
      for (const child of Array.from(node.children)) {
        if (child.namespaceURI !== W) continue;
        // Deleted text in tracked changes is not the document's wording.
        if (child.localName === "del" || child.localName === "instrText") continue;
        if (child.localName === "t") line += child.textContent ?? "";
        else if (child.localName === "tab") line += "\t";
        else if (child.localName === "br" || child.localName === "cr") line += "\n";
        else if (child.localName !== "p") walk(child);
      }
    };
    walk(paragraph);
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalisePlaceholders(text: string, known: Set<string>): string {
  const swap = (match: string, raw: string) => {
    const name = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    return known.has(name) ? `\${${name}}` : match;
  };
  return text.replace(/\{\{\s*([A-Za-z_][\w -]*?)\s*\}\}/g, swap).replace(/«\s*([A-Za-z_][\w -]*?)\s*»/g, swap);
}
