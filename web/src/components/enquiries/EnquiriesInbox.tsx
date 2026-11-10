"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { Icon } from "@/components/portal/icons";
import { ApiFailure } from "@/lib/api";
import { messagePreview, recentConversations } from "@/lib/conversationPreview";
import { aimModalFrom, holdModalInWorkspace, isBackdropClick } from "@/lib/modalOrigin";
import { getEnquiry, listEnquiries, proposeEnquiryCall, type Enquiry, type EnquiryDetail } from "@/lib/sales";
import { createSupportCase, getSupportCase, listSupportCases, replyToSupportCase,
  type SupportCase, type SupportCaseDetail, type SupportCategory, type SupportMessage } from "@/lib/support";
import type { EnquiriesRequest } from "./enquiryEvents";
import "./askDanpa.css";

const REFRESH_MS = 20_000;
const CLOSE_MS = 140;

/** Existing notification addresses open a record; the general entry opens Danpa Intel. */
export function EnquiriesInbox({ open, request, canSell, onClose }: {
  open: boolean; request: EnquiriesRequest; canSell: boolean; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [mode, setMode] = useState<"ask" | "support" | "interest">("ask");
  useLayoutEffect(() => {
    if (open) { setClosing(false); setMode(request.id || request.side ? "interest" : request.view ?? "ask"); }
  }, [open, request]);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) { if (dialog.open) dialog.close(); return; }
    const release = holdModalInWorkspace(dialog);
    if (!dialog.open) { dialog.showModal(); aimModalFrom(dialog, document.activeElement); }
    return () => { release(); if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); closeTimer.current = null; };
  }, [open]);
  useEffect(() => {
    if (open) dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [open, mode]);
  const requestClose = useCallback(() => {
    if (closeTimer.current !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { onClose(); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; onClose(); }, CLOSE_MS);
  }, [onClose]);
  return <dialog ref={dialogRef} className={`inbox${mode !== "interest" ? " is-danpa-intel" : ""}${closing ? " is-closing" : ""}`} aria-labelledby="inbox-title"
    onCancel={(event) => { event.preventDefault(); requestClose(); }}
    onClick={(event) => { if (isBackdropClick(dialogRef.current, event)) requestClose(); }}>
    {open ? mode === "support" ? <SupportInboxFrame requestClose={requestClose} onAsk={() => setMode("ask")} />
      : mode === "interest" ? <InterestRecords key={request.id ?? request.side ?? "all"} request={request} canSell={canSell} onClose={requestClose} />
      : <section className="ask-danpa-surface" tabIndex={-1}>
        <header className="ask-danpa-identity"><h2 id="inbox-title"><DanpaMark />Danpa Intel</h2><button type="button" className="inbox-icon-button" aria-label="Close Danpa Intel" onClick={requestClose}><Icon name="close" /></button></header>
        <span className="ask-danpa-status">Coming soon</span>



        <button type="button" className="ask-danpa-support" aria-label="Support Tickets" onClick={() => setMode("support")}><Icon name="headset" /><span><strong>Support Tickets</strong></span><span aria-hidden="true">→</span></button>
      </section> : null}
  </dialog>;
}
function DanpaMark() {
  return <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 27V14a10 10 0 0 1 20 0v13M12 27V14a4 4 0 0 1 8 0v13" stroke="currentColor" strokeWidth="1.5" /><path d="M3 27h26" stroke="#9b763a" strokeWidth="1.5" /></svg>;
}
function InterestRecords({ request, canSell, onClose }: { request: EnquiriesRequest; canSell: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [selected, setSelected] = useState(request.id ?? null);
  const [record, setRecord] = useState<EnquiryDetail | null>(request.record ?? null);
  const initialRecordId = useRef(request.record?.id);
  const [error, setError] = useState("");
  const needsList = !selected && rows === null;
  useEffect(() => {
    if (!needsList) return;
    let live = true;
    void listEnquiries(request.side ?? (canSell ? "all" : "buyer")).then((data) => { if (live) setRows(data); })
      .catch(() => { if (live) setError("Could not load property interests."); });
    return () => { live = false; };
  }, [canSell, needsList, request.side]);
  useEffect(() => {
    if (!selected) return;
    if (selected === initialRecordId.current) return;
    let live = true;
    setRecord(null); setError("");
    void getEnquiry(selected).then((data) => { if (live) { setRecord(data); setRows((current) => current?.map((row) => row.id === data.id ? { ...row, unread: false } : row) ?? null); } })
      .catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not open this interest."); });
    return () => { live = false; };
  }, [selected]);
  return <section className="ask-danpa-surface interest-records">
    <header className="ask-danpa-identity"><h2 id="inbox-title">Property interests</h2><button type="button" className="inbox-icon-button" aria-label="Close property interests" onClick={onClose}><Icon name="close" /></button></header>
    {error ? <p role="alert">{error}</p> : null}
    {selected ? <><button type="button" className="quiet-link" onClick={() => {
      initialRecordId.current = undefined;
      setError("");
      setSelected(null);
    }}>All property interests</button>
      {record?.id === selected ? <><h3>{record.sale.headline || "Property for sale"}</h3><dl className="interest-facts"><div><dt>Buyer</dt><dd>{record.buyer_name}</dd></div><div><dt>Interest recorded</dt><dd>{new Date(record.created_at).toLocaleDateString("en-GH")}</dd></div><div><dt>Status</dt><dd>{record.sale.status === "sold" ? "Property sold" : record.status === "closed" ? "Closed" : record.proposed_call_at ? "Accepted" : "Awaiting provider response"}</dd></div></dl>
        <InterestCall key={record.id} record={record} onUpdated={(updated) => {
          setRecord((current) => current?.id === updated.id ? updated : current);
          setRows(null);
        }} />
        {record.contact_phone && record.contact_email ? <div className="ask-danpa-direction">
          <strong>{record.role === "seller" ? "Buyer contact details" : "Contact details you shared"}</strong>
          <dl className="interest-contact">
            <div><dt>Phone</dt><dd>{record.role === "seller" ? <a href={`tel:${record.contact_phone}`}>{record.contact_phone}</a> : record.contact_phone}</dd></div>
            <div><dt>Email</dt><dd>{record.role === "seller" ? <a href={`mailto:${encodeURIComponent(record.contact_email).replace(/%40/g, "@")}`}>{record.contact_email}</a> : record.contact_email}</dd></div>
          </dl>
        </div> : null}
        {record.messages[0] ? <div className="ask-danpa-direction"><strong>Original enquiry note</strong><p className="interest-note">{record.messages[0].body}</p></div> : null}
        <Link href={(record.role === "seller" ? `/record/property?id=${record.sale.property_id}` : `/record/sale?id=${record.sale.id}`) as never} onClick={onClose} className="quiet-link">View property →</Link></> : !error ? <p role="status">Loading interest…</p> : null}</>
      : rows ? rows.length ? <ul className="interest-list">{rows.map((row) => <li key={row.id}><button type="button" onClick={() => setSelected(row.id)}><strong>{row.sale.headline || "Property for sale"}</strong><span>{row.role === "seller" ? row.buyer_name : "Your interest"} · {shortWhen(row.created_at)}{row.unread ? " · New" : ""}</span></button></li>)}</ul> : <p>No property interests yet.</p> : !error ? <p role="status">Loading property interests…</p> : null}
  </section>;
}

function InterestCall({ record, onUpdated }: { record: EnquiryDetail; onUpdated: (record: EnquiryDetail) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canPropose = record.role === "seller" && record.status === "open" && record.sale.status === "active";
  const proposed = record.proposed_call_at ? new Date(record.proposed_call_at) : null;
  if (!proposed && !canPropose) return null;

  return <section className="ask-danpa-direction interest-call" aria-label="Property call">
    {proposed ? <div role="status">
      <strong>Proposed call time</strong>
      <p><time dateTime={record.proposed_call_at ?? undefined}>{proposed.toLocaleString("en-GH", {
        dateStyle: "long", timeStyle: "short", timeZone: "UTC",
      })}</time> · Ghana time</p>
    </div> : null}
    {canPropose && (editing ? <form onSubmit={async (event) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError("");
      try {
        onUpdated(await proposeEnquiryCall(record.id, `${value}:00Z`));
        setEditing(false);
      } catch (cause) {
        setError(cause instanceof ApiFailure ? cause.error.message : "Could not send the call time. Try again.");
      } finally { setBusy(false); }
    }}>
      <Field label="Call date and time" hint="Ghana time (GMT)" type="datetime-local" required value={value}
        min={new Date().toISOString().slice(0, 16)} onChange={(event) => setValue(event.target.value)} disabled={busy} />
      {error ? <p role="alert">{error}</p> : null}
      <div className="interest-call-actions">
        <Button type="submit" busy={busy} busyLabel="Sending…">{proposed ? "Send new time" : "Accept and send time"}</Button>
        <Button type="button" variant="quiet" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </form> : <Button type="button" variant="secondary" onClick={() => {
      setValue(proposed && proposed.getTime() > Date.now() ? proposed.toISOString().slice(0, 16) : "");
      setError("");
      setEditing(true);
    }}>{proposed ? "Offer a different time" : "Accept interest and offer a call time"}</Button>)}
  </section>;
}

function SupportInboxFrame({ requestClose, onAsk }: { requestClose: () => void; onAsk: () => void }) {
  const [rows, setRows] = useState<SupportCase[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<SupportCaseDetail | null>(null);
  const [pane, setPane] = useState<"list" | "thread">("list");
  const [creating, setCreating] = useState(false);
  const [category, setCategory] = useState<SupportCategory>("other");
  const [summary, setSummary] = useState("");
  const [openingMessage, setOpeningMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { const result = await listSupportCases(); setRows(result); setError(""); return result; }
    catch (cause) { setRows((current) => current ?? []); setError(cause instanceof ApiFailure ? cause.error.message : "Could not load support tickets."); return null; }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!selectedId || creating) return;
    let live = true;
    void getSupportCase(selectedId).then((detail) => {
      if (!live) return;
      setThread(detail);
      setRows((current) => current?.map((row) => row.id === detail.id ? { ...row, unread: false } : row) ?? current);
      setError("");
    }).catch((cause) => { if (live) setError(cause instanceof ApiFailure ? cause.error.message : "Could not open this ticket."); });
    return () => { live = false; };
  }, [creating, selectedId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [thread?.messages.length]);

  function choose(id: string) { setCreating(false); setSelectedId(id); setThread(null); setPane("thread"); }

  async function createTicket() {
    if (!summary.trim() || !openingMessage.trim()) return;
    setBusy(true);
    try {
      const detail = await createSupportCase({ category, summary: summary.trim(), message: openingMessage.trim() });
      setSummary(""); setOpeningMessage(""); setCreating(false); setThread(detail); setSelectedId(detail.id); setPane("thread");
      await load();
    } catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "Could not create the ticket."); }
    finally { setBusy(false); }
  }

  async function send() {
    if (!selectedId || !draft.trim()) return;
    setBusy(true);
    try { const detail = await replyToSupportCase(selectedId, draft.trim()); setThread(detail); setDraft(""); setError(""); await load(); }
    catch (cause) { setError(cause instanceof ApiFailure ? cause.error.message : "That did not send."); }
    finally { setBusy(false); }
  }

  const visibleRows = useMemo(() => recentConversations(rows ?? []), [rows]);
  const selected = rows?.find((row) => row.id === selectedId);
  const unread = rows?.filter((row) => row.unread).length ?? 0;
  return <div className="inbox-frame" data-pane={pane}>
    <section className="inbox-list" aria-label="Support tickets">
      <header className="inbox-head"><div className="inbox-title"><span className="inbox-title-mark" aria-hidden="true"><Icon name="headset" /></span><h2 id="inbox-title">Support tickets</h2>{unread ? <span className="inbox-unread-count">{unread}</span> : null}</div><button type="button" className="inbox-icon-button inbox-close-list" aria-label="Close support tickets" onClick={requestClose}><Icon name="close" /></button></header>
      <button type="button" className="inbox-side" onClick={onAsk}>Back to Danpa Intel</button>
      <button type="button" className="inbox-new-ticket" onClick={() => { setCreating(true); setSelectedId(null); setThread(null); setPane("thread"); }}>New support ticket</button>
      <div className="inbox-rows-wrap">
        {rows === null ? <InboxRowsSkeleton /> : null}
        {rows !== null && !rows.length ? <div className="inbox-empty"><span className="inbox-empty-mark" aria-hidden="true"><Icon name="support" /></span><strong>No support tickets</strong></div> : null}
        {rows?.length ? <ul className="inbox-rows" role="listbox" aria-label="Support tickets">{visibleRows.map((row, index) => <li key={row.id} style={{ "--inbox-order": Math.min(index, 10) } as React.CSSProperties}><button type="button" role="option" aria-selected={row.id === selectedId} className={`inbox-row${row.unread ? " is-unread" : ""}`} onClick={() => choose(row.id)}><span className="inbox-avatar" aria-hidden="true">DH</span><span className="inbox-row-main"><span className="inbox-row-top"><strong>{row.summary}</strong><time dateTime={row.last_message_at}>{shortWhen(row.last_message_at || row.created_at)}</time></span><span className="inbox-row-preview"><span className="inbox-preview-text">{messagePreview(row.last_message || row.details)}</span>{row.unread ? <i className="inbox-row-dot" aria-label="Unread" /> : null}</span><span className="inbox-row-property"><span>Management support · {row.status.replace("_", " ")}</span></span></span></button></li>)}</ul> : null}
      </div>
    </section>
    <section className="inbox-thread" aria-label="Support conversation">
      {creating ? <><header className="inbox-thread-head"><button type="button" className="inbox-icon-button inbox-back" aria-label="Back to tickets" onClick={() => { setCreating(false); setPane("list"); }}><Icon name="close" /></button><div className="inbox-thread-who"><strong>New support ticket</strong><span>Management will reply here</span></div><button type="button" className="inbox-icon-button inbox-close-thread" aria-label="Close support tickets" onClick={requestClose}><Icon name="close" /></button></header><div className="inbox-ticket-form"><label>What do you need help with?<select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)}><option value="account">Account access</option><option value="verification">Verification</option><option value="application">Application</option><option value="lease">Lease</option><option value="payment">Payment</option><option value="property">Property or listing</option><option value="other">Something else</option></select></label><label>Summary<input value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={180} /></label><label>Message<textarea value={openingMessage} onChange={(event) => setOpeningMessage(event.target.value)} maxLength={2000} /></label>{error ? <p role="alert">{error}</p> : null}<button type="button" className="inbox-new-ticket" disabled={busy || !summary.trim() || !openingMessage.trim()} onClick={() => void createTicket()}>{busy ? "Sending…" : "Create ticket"}</button></div></> : selectedId ? <><header className="inbox-thread-head"><button type="button" className="inbox-icon-button inbox-back" aria-label="Back to tickets" onClick={() => setPane("list")}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></button><span className="inbox-avatar is-large" aria-hidden="true">DH</span><div className="inbox-thread-who"><strong>{selected?.summary ?? thread?.summary ?? "Support"}</strong><span>Management support · {(thread?.status ?? selected?.status ?? "open").replace("_", " ")}</span></div><button type="button" className="inbox-icon-button inbox-close-thread" aria-label="Close support tickets" onClick={requestClose}><Icon name="close" /></button></header><div className="inbox-messages">{thread ? <div className="inbox-messages-inner">{groupByDay(thread.messages).map((day) => <div key={day.key} className="inbox-day"><p className="inbox-day-label"><span>{day.label}</span></p><ol className="inbox-bubbles">{day.messages.map((message) => <li key={message.id} className={message.mine ? "is-mine" : undefined}><span className="inbox-bubble">{message.body}</span><span className="inbox-bubble-meta"><time dateTime={message.created_at}>{timeOf(message.created_at)}</time></span></li>)}</ol></div>)}<div ref={endRef} /></div> : <ThreadSkeleton />}{error ? <p className="inbox-closed" role="alert">{error}</p> : null}</div>{thread ? <form className="inbox-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="support-reply">Your reply</label><textarea id="support-reply" rows={1} maxLength={2000} value={draft} placeholder="Write to Management…" onChange={(event) => { setDraft(event.target.value); autosize(event.currentTarget); }} /><button type="submit" className="inbox-send" aria-label="Send" disabled={busy || !draft.trim()}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M16.5 3.5 3.5 9l5.25 2.25L11 16.5l5.5-13Z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></button></form> : null}</> : <div className="inbox-placeholder"><button type="button" className="inbox-icon-button inbox-close-thread" aria-label="Close support tickets" onClick={requestClose}><Icon name="close" /></button><span className="inbox-empty-mark" aria-hidden="true"><Icon name="support" /></span><strong>{rows?.length ? "Choose a support ticket" : "How can Management help?"}</strong></div>}
    </section>
  </div>;
}

function InboxRowsSkeleton() {
  return (
    <ul className="inbox-rows" aria-busy="true" aria-label="Loading enquiries">
      {Array.from({ length: 5 }).map((_, index) => (
        <li key={index} style={{ "--inbox-order": index } as React.CSSProperties}>
          <div className="inbox-row is-skeleton">
            <span className="inbox-avatar ws-skeleton-block" />
            <span className="inbox-row-main">
              <span className="ws-skeleton-block" style={{ width: "58%", height: ".7rem" }} />
              <span className="ws-skeleton-block is-thin" style={{ width: "82%" }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ThreadSkeleton() {
  return (
    <div className="inbox-messages-inner" aria-hidden="true">
      <ol className="inbox-bubbles is-skeleton">
        <li><span className="inbox-bubble ws-skeleton-block" style={{ width: "58%" }} /></li>
        <li className="is-mine"><span className="inbox-bubble ws-skeleton-block" style={{ width: "44%" }} /></li>
        <li><span className="inbox-bubble ws-skeleton-block" style={{ width: "36%" }} /></li>
      </ol>
    </div>
  );
}

function autosize(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  field.style.height = `${Math.min(field.scrollHeight, 132)}px`;
}

function shortWhen(value: string) {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-GH", { day: "numeric", month: "short" });
}

function timeOf(value: string) {
  return new Date(value).toLocaleTimeString("en-GH", { hour: "numeric", minute: "2-digit" });
}

/** Messages under the day they were sent, the way a chat reads. */
function groupByDay(messages: SupportMessage[]) {
  const days: { key: string; label: string; messages: SupportMessage[] }[] = [];
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  for (const message of messages) {
    const date = new Date(message.created_at);
    const key = date.toDateString();
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      const label = key === today.toDateString()
        ? "Today"
        : key === yesterday.toDateString()
          ? "Yesterday"
          : date.toLocaleDateString("en-GH", { weekday: "long", day: "numeric", month: "long" });
      day = { key, label, messages: [] };
      days.push(day);
    }
    day.messages.push(message);
  }
  return days;
}
