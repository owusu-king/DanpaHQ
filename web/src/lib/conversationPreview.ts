/** A compact preview, without letting line breaks distort the conversation row. */
export function messagePreview(body: string, fallback = "No messages yet") {
  const text = body.replace(/\s+/g, " ").trim();
  return text || fallback;
}

/** Replies move a conversation to the top immediately, including local sends. */
export function recentConversations<T extends { last_message_at: string | null; created_at: string }>(rows: T[]) {
  const time = (row: T) => Date.parse(row.last_message_at || row.created_at) || 0;
  return [...rows].sort((a, b) => time(b) - time(a));
}
