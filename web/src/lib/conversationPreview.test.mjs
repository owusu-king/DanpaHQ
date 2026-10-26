import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./conversationPreview.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { messagePreview, recentConversations } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("conversation previews show plain message text and keep pasted line breaks compact", () => {
  assert.equal(messagePreview("  I can visit\n\nSaturday.  "), "I can visit Saturday.");
  assert.equal(messagePreview("Yes, Saturday works."), "Yes, Saturday works.");
  assert.equal(messagePreview(" \n "), "No messages yet");
});

test("a new reply moves a conversation first without mutating the existing inbox", () => {
  const rows = [
    { id: "older", last_message_at: "2026-10-21T10:00:00Z", created_at: "2026-10-20T10:00:00Z" },
    { id: "new", last_message_at: null, created_at: "2026-10-22T10:00:00Z" },
  ];
  assert.deepEqual(recentConversations(rows).map((row) => row.id), ["new", "older"]);
  const updated = rows.map((row) => row.id === "older" ? { ...row, last_message_at: "2026-10-23T10:00:00Z" } : row);
  assert.deepEqual(recentConversations(updated).map((row) => row.id), ["older", "new"]);
  assert.deepEqual(rows.map((row) => row.id), ["older", "new"]);
});
