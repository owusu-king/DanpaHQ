"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { DanpaIntel } from "@/components/landing/DanpaIntel";
import { propertyChatKey, type IntelProperty } from "@/lib/propertyIntel";
import { useSession } from "@/lib/session";

export function PropertyAsk({ property }: { property: IntelProperty }) {
  const { state } = useSession();
  if (state.status === "loading") return null;
  const actor = state.status === "signed_in" ? state.me.id : "guest";
  const key = propertyChatKey(actor, property);
  return <PropertyConversation key={key} property={property} storageKey={key} />;
}

function PropertyConversation({ property, storageKey }: { property: IntelProperty; storageKey: string }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [hasMessages, setHasMessages] = useState(false);
  const [request, setRequest] = useState<{ token: number; text: string } | null>(null);
  return <>
    <form className="listing-ask" aria-label="Ask about this property" onSubmit={event => {
      event.preventDefault();
      const text = draft.trim();
      if (!text) return;
      setRequest(current => ({ token: (current?.token ?? 0) + 1, text }));
      setDraft("");
      setOpen(true);
    }}>
      <input aria-label={`Ask about ${property.title}`} placeholder={`Ask about ${property.title}…`} value={draft} onChange={event => setDraft(event.target.value)} maxLength={500} />
      {!draft.trim() && hasMessages ? <button type="button" className="listing-ask-continue" onClick={() => setOpen(true)}>Continue chat <span aria-hidden="true">↗</span></button> : <button type="submit" className="listing-ask-send" disabled={!draft.trim()} aria-label="Ask Danpa Intel"><ArrowUp aria-hidden="true" /></button>}
    </form>
    <DanpaIntel context={property} storageKey={storageKey} controlledOpen={open} onOpenChange={setOpen} request={request} onConversationChange={setHasMessages} />
  </>;
}
