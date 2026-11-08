import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function compile(path, imports = {}, extra = {}) {
  const exports = {};
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require: name => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, Blob, TextEncoder, URLSearchParams, ArrayBuffer, Uint8Array, Headers, ReadableStream,
  setTimeout: callback => { callback(); return 0; }, ...extra });
  return exports;
}
// Run the real encoder and FormData patch shipped by the installed Expo SDK.
const blobUtils = compile("../node_modules/expo/src/utils/blobUtils.ts");
class NativeFormData { constructor() { this._parts = []; } }
const { installFormDataPatch } = compile("../node_modules/expo/src/winter/FormData.ts");
installFormDataPatch(NativeFormData);
const encoder = compile("../node_modules/expo/src/winter/fetch/convertFormData.ts", {
  "../../utils/blobUtils": blobUtils,
});
const { normalizeBodyInitAsync } = compile("../node_modules/expo/src/winter/fetch/RequestUtils.ts", {
  "./convertFormData": encoder, "../../utils/blobUtils": blobUtils,
}, { FormData: NativeFormData });
const bytes = new Uint8Array([255, 216, 255, 224, 1, 2, 255, 217]);

function harness({ method = "POST", status = 204, failNetwork = false, scanning = false, browser = false } = {}) {
  const calls = [], transfers = [];
  const final = { id: "reserved-file", is_usable: !scanning, status_message: "", rejection_reason: "" };
  const prepared = { uri: "file:///cache/proof.jpg", filename: "property proof.jpg", mime: "image/jpeg", blob: new Blob([bytes]) };
  const transfer = compile("./uploadTransfer.ts", {}, { FormData: browser ? FormData : NativeFormData,
    fetch: async (url, options) => {
      if (failNetwork) throw new Error("Network request failed");
      const encoded = browser ? await encoder.convertFormDataAsync(options.body) : await normalizeBodyInitAsync(options.body);
      transfers.push({ url, options, encoded });
      return { ok: status >= 200 && status < 300, status };
    },
  });
  const api = compile("./provider.ts", {
    "@/uploadTransfer": transfer,
    "@/photoUpload": { preparePhotoUpload: async () => prepared },
    "@/api": { apiFetch: async (path, options) => {
      calls.push({ path, options });
      if (path === "/files/uploads/") return { file_id: final.id, url: "https://storage.test/private", method, fields: { key: "private-key", policy: "signed-policy", "Content-Type": "image/jpeg" } };
      if (path.endsWith("/complete/")) return { ...final, is_usable: !scanning };
      return { ...final, is_usable: true };
    } },
  });
  return { api, calls, transfers, prepared };
}

test("Expo's multipart encoder rejects the old native URI-only file object", async () => {
  const form = new NativeFormData();
  form.append("file", { uri: "file:///proof.jpg", name: "proof.jpg", type: "image/jpeg" });
  await assert.rejects(encoder.convertFormDataAsync(form), /Unsupported FormDataPart implementation/);
});

test("Expo-compatible JPEG POST sends signed fields followed by real bytes, filename and reserved MIME", async () => {
  const h = harness();
  const stored = await h.api.uploadImage({ uri: h.prepared.uri }, "property_document");
  assert.equal(stored.is_usable, true);
  const upload = h.transfers[0], body = new TextDecoder().decode(upload.encoded.body);
  assert.ok(body.indexOf('name="policy"') < body.indexOf('name="file"'));
  assert.match(body, /filename="property%20proof.jpg"/);
  assert.match(body, /content-type: image\/jpeg/);
  assert.ok(body.includes("signed-policy"));
  assert.deepEqual(new Uint8Array(await upload.options.body.get("file").arrayBuffer()), bytes);
  assert.equal(h.calls[0].options.body.size_bytes, bytes.length);
  assert.equal(h.calls[1].path, "/files/uploads/reserved-file/complete/");
});

test("signed PUT keeps both the actual bytes and the reserved JPEG MIME", async () => {
  const h = harness({ method: "PUT" });
  await h.api.uploadImage({ uri: h.prepared.uri }, "property_document");
  assert.deepEqual(Array.from(h.transfers[0].encoded.body), Array.from(bytes));
  assert.equal(new Headers(h.transfers[0].encoded.defaultHeaders).get("content-type"), "image/jpeg");
  assert.equal(h.transfers[0].options.headers["Content-Type"], "image/jpeg");
});

test("browser FormData uploads use real file bytes too", async () => {
  const h = harness({ browser: true });
  await h.api.uploadImage({ uri: h.prepared.uri }, "property_document");
  assert.equal(h.transfers[0].options.body.get("file").name, h.prepared.filename);
  assert.deepEqual(new Uint8Array(await h.transfers[0].options.body.get("file").arrayBuffer()), bytes);
});

test("a refused storage upload is never completed or approved", async () => {
  const h = harness({ status: 403 });
  await assert.rejects(h.api.uploadImage({ uri: h.prepared.uri }, "property_document"), /Storage refused/);
  assert.equal(h.calls.length, 1);
});

test("a failed transfer never completes an empty reservation", async () => {
  const h = harness({ failNetwork: true });
  await assert.rejects(h.api.uploadImage({ uri: h.prepared.uri }, "property_document"), /Network request failed/);
  assert.equal(h.calls.length, 1);
});

test("uploaded bytes still wait for the server's scan result", async () => {
  const h = harness({ scanning: true });
  assert.equal((await h.api.uploadImage({ uri: h.prepared.uri }, "property_document")).is_usable, true);
  assert.equal(h.calls[2].path, "/files/reserved-file/");
});


test("native uploads stream the file with its signed fields rather than creating a JS multipart Blob", async () => {
  const calls = [];
  class File {
    constructor(uri) { this.uri = uri; this.size = 1234; }
    async upload(url, options) { calls.push({ uri: this.uri, url, options }); return { status: 204 }; }
  }
  const native = compile("./uploadTransfer.native.ts", { "expo-file-system": { File, UploadType: { MULTIPART: 1, BINARY_CONTENT: 0 } } });
  const source = await native.readUploadSource("file:///cache/proof.jpg");
  assert.equal(source.size, 1234);
  const fields = { key: "private", policy: "signed-policy" };
  const reservation = { url: "https://storage.test/private", method: "POST", fields };
  const result = await native.transferUpload(reservation, { uri: source.uri, mime: "image/jpeg" });
  assert.equal(result.ok, true);
  assert.equal(calls[0].uri, source.uri);
  assert.equal(calls[0].options.parameters, fields);
  assert.equal(calls[0].options.uploadType, 1);
  assert.equal(calls[0].options.mimeType, "image/jpeg");
  assert.equal(calls[0].options.fieldName, "file");
});

test("native PUT uses binary content and preserves signed headers; refused transfers stay refused", async () => {
  let sent;
  class File { async upload(url, options) { sent = { url, options }; return { status: 403 }; } }
  const native = compile("./uploadTransfer.native.ts", { "expo-file-system": { File, UploadType: { MULTIPART: 1, BINARY_CONTENT: 0 } } });
  const result = await native.transferUpload({ url: "https://storage.test/private", method: "PUT", headers: { "x-amz-checksum-sha256": "signed-checksum" } }, { uri: "file:///proof.jpg", mime: "image/jpeg" });
  assert.equal(result.ok, false);
  assert.equal(sent.options.uploadType, 0);
  assert.equal(sent.options.headers["Content-Type"], "image/jpeg");
  assert.equal(sent.options.headers["x-amz-checksum-sha256"], "signed-checksum");
  assert.equal(sent.options.parameters, undefined);
});
