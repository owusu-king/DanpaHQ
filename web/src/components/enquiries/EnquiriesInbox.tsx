"use client";

/**
 * Enquiries, as an inbox that opens over whatever page somebody is on.
 *
 * Conversations about properties for sale are something you answer, not a
 * place you go, so they left the rail and then the page: the list sits on one
 * side, the chosen conversation on the other, and switching between them is a
 * click. A buyer never sees a seller's phone number (owner, 2026-09-28); the
 * conversation is the only channel. A provider can be on both sides — selling
 * one plot while asking about another — so theirs has both, opening on the side
 * their workspace suggests. A tenant owns no property and has only what they
 * asked about (owner, 2026-09-29).
 *
 * Opening a conversation marks it read on the server (the GET does that), so
 * the unread mark clears without a second call. Once a property is sold the
 * conversation stays readable and stops taking replies.
 *
 * Opened with `openEnquiries()` from anywhere; the portal shell hosts it.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/portal/icons";
import { ApiFailure } from "@/lib/api";
import { aimModalFrom, holdModalInWorkspace, isBackdropClick } from "@/lib/modalOrigin";
import {
  getEnquiry,
  listEnquiries,
  replyToEnquiry,
  type Enquiry,
  type EnquiryDetail,
  type EnquiryMessage,
} from "@/lib/sales";
import {
  createSupportCase,
  getSupportCase,
  listSupportCases,
  replyToSupportCase,
  type SupportCase,
  type SupportCaseDetail,
  type SupportCategory,
  type SupportMessage,
} from "@/lib/support";

export type EnquirySide = "buyer" | "seller";
export type EnquiriesRequest = { id?: string; side?: EnquirySide };

export const OPEN_ENQUIRIES = "danpahq:open-enquiries";

/** Open the inbox over the current page, optionally at one conversation. */
export function openEnquiries(request: EnquiriesRequest = {}) {
  window.dispatchEvent(new CustomEvent<EnquiriesRequest>(OPEN_ENQUIRIES, { detail: request }));
}

const REFRESH_MS = 20_000;
const CLOSE_MS = 240;

type Pending = { key: string; body: string; failed: boolean };

export function EnquiriesInbox({
  open,
  request,
  canSell,
  defaultSide,
  onClose,
}: {
  open: boolean;
  request: EnquiriesRequest;
  /** Selling needs property, and only a provider account holds any. */
  canSell: boolean;
  defaultSide: EnquirySide;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const [mode, setMode] = useState<"support" | "property">("support");
  const [side, setSide] = useState<EnquirySide>(defaultSide);
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<EnquiryDetail | null>(null);
  const [threadError, setThreadError] = useState("");
  const [pane, setPane] = useState<"list" | "thread">("list");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [attempt, setAttempt] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const effectiveSide: EnquirySide = canSell ? side : "buyer";

  // Each opening starts from what was asked for: a conversation, a side, or
  // the side the workspace suggests.
  useEffect(() => {
    if (!open) return;
    setClosing(false);
    setMode(request.id || request.side ? "property" : "support");
    setSide(request.side ?? defaultSide);
    setSelectedId(request.id ?? null);
    setPane(request.id ? "thread" : "list");
    setThread(null);
    setDraft("");
    setPending(null);
  }, [open, request, defaultSide]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      // Cleared as it closes, so the next opening starts clean.
      setClosing(false);
      return;
    }
    // Over the page, not the app: the rail and top bar stay undimmed. Set up on
    // every run, so a second development run does not leave it torn down.
    const release = holdModalInWorkspace(dialog);
    if (!dialog.open) {
      // Grow out of whatever opened it; the top bar's Enquiries when that was a link.
      const invoker = document.activeElement !== document.body ? document.activeElement : document.querySelector(".portal-header-support");
      dialog.classList.remove("is-closing");
      dialog.showModal();
      aimModalFrom(dialog, invoker);
    }
    return release;
  }, [open]);

  const requestClose = useCallback(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { onClose(); return; }
    setClosing(true);
    window.setTimeout(onClose, CLOSE_MS);
  }, [onClose]);

  // The list for the side on show, read on opening and quietly kept current.
  const loadList = useCallback(async (quiet = false) => {
    try {
      const result = await listEnquiries(effectiveSide);
      setRows(result);
      setListError("");
      return result;
    } catch (cause) {
      if (!quiet) {
        setRows((current) => current ?? []);
        setListError(cause instanceof ApiFailure ? cause.error.message : "Could not load enquiries.");
      }
      return null;
    }
  }, [effectiveSide]);

  useEffect(() => {
    if (!open || mode === "support") return;
    let live = true;
    setRows(null);
    void loadList().then((result) => {
      if (!live || !result) return;
      // Nothing asked for: on a wide screen, open the first conversation that
      // is waiting, else the most recent, so the right side is never blank.
      setSelectedId((current) => {
        if (current) return current;
        if (window.matchMedia("(max-width: 47.99rem)").matches) return null;
        return (result.find((row) => row.unread) ?? result[0])?.id ?? null;
      });
    });
    const timer = window.setInterval(() => { void loadList(true); }, REFRESH_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [open, mode, loadList, attempt]);

  // The chosen conversation. Reading it marks it read, so the row's mark goes.
  useEffect(() => {
    if (!open || mode === "support" || !selectedId) return;
    let live = true;
    const read = async (quiet: boolean) => {
      try {
        const detail = await getEnquiry(selectedId);
        if (!live) return;
        setThread(detail);
        setThreadError("");
        setRows((current) => current?.map((row) => row.id === detail.id ? { ...row, unread: false } : row) ?? current);
      } catch (cause) {
        if (live && !quiet) setThreadError(cause instanceof ApiFailure ? cause.error.message : "Could not open this conversation.");
      }
    };
    setThreadError("");
    void read(false);
    const timer = window.setInterval(() => { void read(true); }, REFRESH_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [open, mode, selectedId]);

  // The newest message stays in view as the conversation grows.
  const messageCount = (thread?.messages.length ?? 0) + (pending ? 1 : 0);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messageCount, thread?.id]);

  function choose(id: string) {
    if (id !== selectedId) {
      setThread(null);
      setDraft("");
      setPending(null);
      setSelectedId(id);
    }
    setPane("thread");
    window.setTimeout(() => composerRef.current?.focus({ preventScroll: true }), 220);
  }

  async function send() {
    const body = draft.trim();
    if (!body || !selectedId || (pending && !pending.failed)) return;
    const key = `pending-${Date.now()}`;
    setPending({ key, body, failed: false });
    setDraft("");
    try {
      const detail = await replyToEnquiry(selectedId, body);
      setThread(detail);
      setPending(null);
      const last = detail.messages[detail.messages.length - 1];
      setRows((current) => current?.map((row) => row.id === detail.id
        ? { ...row, last_message: last?.body ?? body, last_message_at: last?.created_at ?? new Date().toISOString(), unread: false }
        : row) ?? current);
    } catch (cause) {
      setPending({ key, body, failed: true });
      setThreadError(cause instanceof ApiFailure ? cause.error.message : "That did not send.");
    }
  }

  function retrySend() {
    if (!pending) return;
    setDraft(pending.body);
    setPending(null);
    setThreadError("");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  const selected = rows?.find((row) => row.id === selectedId) ?? null;
  const unreadCount = rows?.filter((row) => row.unread).length ?? 0;
  const days = useMemo(() => groupByDay(thread?.messages ?? []), [thread]);
  const closed = thread ? thread.status === "closed" || thread.sale.status === "sold" : false;

  return (
    <dialog
      ref={dialogRef}
      className={`inbox${closing ? " is-closing" : ""}`}
      aria-labelledby="inbox-title"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onClick={(event) => { if (isBackdropClick(dialogRef.current, event)) requestClose(); }}
    >
      {open ? mode === "support" ? (
        <SupportInboxFrame requestClose={requestClose} onProperty={() => setMode("property")} />
      ) : <div className="inbox-frame" data-pane={pane}>
        <section className="inbox-list" aria-label="Enquiries">
          <header className="inbox-head">
            <div className="inbox-title">
              <span className="inbox-title-mark" aria-hidden="true"><Icon name="headset" /></span>
              <h2 id="inbox-title">Enquiries</h2>
              {unreadCount ? <span className="inbox-unread-count" aria-label={`${unreadCount} unread`}>{unreadCount}</span> : null}
            </div>
            <button type="button" className="inbox-icon-button inbox-close-list" aria-label="Close enquiries" onClick={requestClose}><Icon name="close" /></button>
          </header>

          <div className="inbox-sides" role="tablist" aria-label="Inbox">
            <button type="button" role="tab" aria-selected="false" className="inbox-side" onClick={() => setMode("support")}>Support</button>
            <button type="button" role="tab" aria-selected="true" className="inbox-side">Properties</button>
          </div>

          {canSell ? (
            <div className="inbox-sides" role="tablist" aria-label="Which side">
              {(["seller", "buyer"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={effectiveSide === key}
                  className="inbox-side"
                  onClick={() => {
                    if (key === effectiveSide) return;
                    setSide(key);
                    setSelectedId(null);
                    setThread(null);
                    setPane("list");
                  }}
                >
                  {key === "seller" ? "Selling" : "Buying"}
                </button>
              ))}
            </div>
          ) : null}

          <div className="inbox-rows-wrap">
            {rows === null ? <InboxRowsSkeleton /> : null}
            {rows !== null && listError && !rows.length ? (
              <div className="inbox-empty" role="alert">
                <strong>Enquiries didn’t load</strong>
                <span>{listError}</span>
                <button type="button" className="inbox-text-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
              </div>
            ) : null}
            {rows !== null && !listError && !rows.length ? (
              effectiveSide === "seller" ? (
                <div className="inbox-empty">
                  <span className="inbox-empty-mark" aria-hidden="true"><Icon name="chat" /></span>
                  <strong>No enquiries yet</strong>
                  <span>When a buyer asks about a property you are selling, it arrives here.</span>
                </div>
              ) : (
                <div className="inbox-empty">
                  <span className="inbox-empty-mark" aria-hidden="true"><Icon name="chat" /></span>
                  <strong>You have not asked about anything yet</strong>
                  <span>Find a property under Buy on Explore and send the seller a message.</span>
                  <Link href={"/rentals?mode=buy" as never} className="inbox-text-button" onClick={requestClose}>Browse properties for sale</Link>
                </div>
              )
            ) : null}
            {rows?.length ? (
              <ul className="inbox-rows" role="listbox" aria-label="Conversations">
                {rows.map((row, index) => (
                  <li key={row.id} style={{ "--inbox-order": Math.min(index, 10) } as React.CSSProperties}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={row.id === selectedId}
                      className={`inbox-row${row.unread ? " is-unread" : ""}`}
                      onClick={() => choose(row.id)}
                      onKeyDown={(event) => moveInList(event)}
                    >
                      <span className="inbox-avatar" aria-hidden="true">{initials(counterpart(row))}</span>
                      <span className="inbox-row-main">
                        <span className="inbox-row-top">
                          <strong>{counterpart(row)}</strong>
                          {row.last_message_at ? <time dateTime={row.last_message_at}>{shortWhen(row.last_message_at)}</time> : null}
                        </span>
                        <span className="inbox-row-property">{row.sale.headline || "Property for sale"}</span>
                        <span className="inbox-row-preview">
                          {row.last_message || "No messages yet"}
                          {row.unread ? <i className="inbox-row-dot" aria-label="Unread" /> : null}
                          {row.status === "closed" || row.sale.status === "sold" ? <em>{row.sale.status === "sold" ? "Sold" : "Closed"}</em> : null}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        <section className="inbox-thread" aria-label={selected ? `Conversation with ${counterpart(selected)}` : "Conversation"}>
          {selectedId ? (
            <>
              <header className="inbox-thread-head">
                <button type="button" className="inbox-icon-button inbox-back" aria-label="Back to enquiries" onClick={() => setPane("list")}>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <span className="inbox-avatar is-large" aria-hidden="true">{initials(selected ? counterpart(selected) : thread ? counterpart(thread) : "")}</span>
                <div className="inbox-thread-who">
                  <strong>{selected ? counterpart(selected) : thread ? counterpart(thread) : " "}</strong>
                  <span>{[
                    (selected ?? thread)?.sale.headline || null,
                    (selected ?? thread)?.sale.price_formatted,
                    (selected ?? thread)?.sale.locality_name,
                  ].filter(Boolean).join(" · ")}</span>
                </div>
                {thread ? (
                  <Link
                    href={(thread.role === "seller" ? `/record/property?id=${thread.sale.property_id}` : `/record/sale?id=${thread.sale.id}`) as never}
                    className="inbox-property-link"
                    onClick={requestClose}
                  >
                    <Icon name="properties" /><span>{thread.role === "seller" ? "Open property" : "View property"}</span>
                  </Link>
                ) : null}
                <button type="button" className="inbox-icon-button inbox-close-thread" aria-label="Close enquiries" onClick={requestClose}><Icon name="close" /></button>
              </header>

              <div className="inbox-messages" aria-live="polite" aria-busy={!thread || undefined}>
                {!thread && !threadError ? <ThreadSkeleton /> : null}
                {thread ? (
                  <div className="inbox-messages-inner" key={thread.id}>
                    {days.map((day) => (
                      <div key={day.key} className="inbox-day">
                        <p className="inbox-day-label"><span>{day.label}</span></p>
                        <ol className="inbox-bubbles">
                          {day.messages.map((message) => (
                            <li key={message.id} className={message.mine ? "is-mine" : undefined}>
                              <span className="inbox-bubble">{message.body}</span>
                              <span className="inbox-bubble-meta">{message.mine ? "You" : message.author_name} · {timeOf(message.created_at)}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                    {pending ? (
                      <ol className="inbox-bubbles">
                        <li className={`is-mine is-pending${pending.failed ? " is-failed" : ""}`}>
                          <span className="inbox-bubble">{pending.body}</span>
                          <span className="inbox-bubble-meta">
                            {pending.failed ? <>Not sent · <button type="button" className="inbox-text-button" onClick={retrySend}>Edit and resend</button></> : "Sending…"}
                          </span>
                        </li>
                      </ol>
                    ) : null}
                    <div ref={endRef} />
                  </div>
                ) : null}
                {threadError && !thread ? (
                  <div className="inbox-empty" role="alert">
                    <strong>This conversation didn’t open</strong>
                    <span>{threadError}</span>
                    <button type="button" className="inbox-text-button" onClick={() => { const id = selectedId; setSelectedId(null); window.setTimeout(() => setSelectedId(id), 0); }}>Try again</button>
                  </div>
                ) : null}
              </div>

              {thread ? (
                closed ? (
                  <p className="inbox-closed">
                    <Icon name="info" />
                    <span>{thread.sale.status === "sold" ? "This property has been sold." : "This enquiry is closed."} You can still read it, but no more messages can be sent.</span>
                  </p>
                ) : (
                  <form className="inbox-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
                    {threadError && pending?.failed ? <p className="inbox-composer-error" role="alert">{threadError}</p> : null}
                    <label className="sr-only" htmlFor="inbox-reply">Your reply</label>
                    <textarea
                      ref={composerRef}
                      id="inbox-reply"
                      rows={1}
                      maxLength={2000}
                      value={draft}
                      placeholder={thread.role === "seller" ? "Reply to the buyer…" : "Write to the seller…"}
                      onChange={(event) => { setDraft(event.target.value); autosize(event.currentTarget); }}
                      onKeyDown={(event) => {
                        // Enter sends, as it does in every chat; Shift+Enter is a new line.
                        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <button
                      type="submit"
                      className="inbox-send"
                      aria-label="Send"
                      disabled={!draft.trim() || Boolean(pending && !pending.failed)}
                    >
                      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M16.5 3.5 3.5 9l5.25 2.25L11 16.5l5.5-13Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="m8.75 11.25 7.75-7.75" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                    </button>
                    <span className="inbox-composer-hint" aria-hidden="true">Enter to send · Shift + Enter for a new line</span>
                  </form>
                )
              ) : null}
            </>
          ) : (
            <div className="inbox-placeholder">
              <button type="button" className="inbox-icon-button inbox-close-thread" aria-label="Close enquiries" onClick={requestClose}><Icon name="close" /></button>
              <span className="inbox-empty-mark" aria-hidden="true"><Icon name="chat" /></span>
              <strong>{rows?.length ? "Choose a conversation" : "Nothing to answer yet"}</strong>
              <span>{rows?.length ? "Pick an enquiry on the left to read it and reply." : "New enquiries appear on the left as they arrive."}</span>
            </div>
          )}
        </section>
      </div> : null}
    </dialog>
  );
}

function SupportInboxFrame({ requestClose, onProperty }: { requestClose: () => void; onProperty: () => void }) {
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
    let live = true;
    void load().then((result) => {
      if (!live || !result || window.matchMedia("(max-width: 47.99rem)").matches) return;
      setSelectedId((current) => current ?? (result.find((row) => row.unread) ?? result[0])?.id ?? null);
    });
    const timer = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => { live = false; window.clearInterval(timer); };
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

  const selected = rows?.find((row) => row.id === selectedId);
  const unread = rows?.filter((row) => row.unread).length ?? 0;
  return <div className="inbox-frame" data-pane={pane}>
    <section className="inbox-list" aria-label="Support tickets">
      <header className="inbox-head"><div className="inbox-title"><span className="inbox-title-mark" aria-hidden="true"><Icon name="headset" /></span><h2 id="inbox-title">Enquiries</h2>{unread ? <span className="inbox-unread-count">{unread}</span> : null}</div><button type="button" className="inbox-icon-button inbox-close-list" aria-label="Close enquiries" onClick={requestClose}><Icon name="close" /></button></header>
      <div className="inbox-sides" role="tablist" aria-label="Inbox"><button type="button" role="tab" aria-selected="true" className="inbox-side">Support</button><button type="button" role="tab" aria-selected="false" className="inbox-side" onClick={onProperty}>Properties</button></div>
      <button type="button" className="inbox-new-ticket" onClick={() => { setCreating(true); setSelectedId(null); setThread(null); setPane("thread"); }}>New support ticket</button>
      <div className="inbox-rows-wrap">
        {rows === null ? <InboxRowsSkeleton /> : null}
        {rows !== null && !rows.length ? <div className="inbox-empty"><span className="inbox-empty-mark" aria-hidden="true"><Icon name="support" /></span><strong>No support tickets</strong><span>Start a ticket when you need help from Management.</span></div> : null}
        {rows?.length ? <ul className="inbox-rows" role="listbox" aria-label="Support tickets">{rows.map((row, index) => <li key={row.id} style={{ "--inbox-order": Math.min(index, 10) } as React.CSSProperties}><button type="button" role="option" aria-selected={row.id === selectedId} className={`inbox-row${row.unread ? " is-unread" : ""}`} onClick={() => choose(row.id)}><span className="inbox-avatar" aria-hidden="true">DH</span><span className="inbox-row-main"><span className="inbox-row-top"><strong>{row.summary}</strong><time dateTime={row.last_message_at}>{shortWhen(row.last_message_at || row.created_at)}</time></span><span className="inbox-row-property">Management support · {row.status.replace("_", " ")}</span><span className="inbox-row-preview">{row.last_message || row.details}{row.unread ? <i className="inbox-row-dot" aria-label="Unread" /> : null}</span></span></button></li>)}</ul> : null}
      </div>
    </section>
    <section className="inbox-thread" aria-label="Support conversation">
      {creating ? <><header className="inbox-thread-head"><button type="button" className="inbox-icon-button inbox-back" aria-label="Back to tickets" onClick={() => { setCreating(false); setPane("list"); }}><Icon name="close" /></button><div className="inbox-thread-who"><strong>New support ticket</strong><span>Management will reply here</span></div><button type="button" className="inbox-icon-button inbox-close-thread" aria-label="Close enquiries" onClick={requestClose}><Icon name="close" /></button></header><div className="inbox-ticket-form"><label>What do you need help with?<select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)}><option value="account">Account access</option><option value="verification">Verification</option><option value="application">Application</option><option value="lease">Lease</option><option value="payment">Payment</option><option value="property">Property or listing</option><option value="other">Something else</option></select></label><label>Summary<input value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={180} /></label><label>Message<textarea value={openingMessage} onChange={(event) => setOpeningMessage(event.target.value)} maxLength={2000} /></label>{error ? <p role="alert">{error}</p> : null}<button type="button" className="inbox-new-ticket" disabled={busy || !summary.trim() || !openingMessage.trim()} onClick={() => void createTicket()}>{busy ? "Sending…" : "Create ticket"}</button></div></> : selectedId ? <><header className="inbox-thread-head"><button type="button" className="inbox-icon-button inbox-back" aria-label="Back to tickets" onClick={() => setPane("list")}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></button><span className="inbox-avatar is-large" aria-hidden="true">DH</span><div className="inbox-thread-who"><strong>{selected?.summary ?? thread?.summary ?? "Support"}</strong><span>Management support · {(thread?.status ?? selected?.status ?? "open").replace("_", " ")}</span></div><button type="button" className="inbox-icon-button inbox-close-thread" aria-label="Close enquiries" onClick={requestClose}><Icon name="close" /></button></header><div className="inbox-messages">{thread ? <div className="inbox-messages-inner">{groupByDay(thread.messages).map((day) => <div key={day.key} className="inbox-day"><p className="inbox-day-label"><span>{day.label}</span></p><ol className="inbox-bubbles">{day.messages.map((message) => <li key={message.id} className={message.mine ? "is-mine" : undefined}><span className="inbox-bubble">{message.body}</span><span className="inbox-bubble-meta">{message.mine ? "You" : "Management"} · {timeOf(message.created_at)}</span></li>)}</ol></div>)}<div ref={endRef} /></div> : <ThreadSkeleton />}{error ? <p className="inbox-closed" role="alert">{error}</p> : null}</div>{thread ? <form className="inbox-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="support-reply">Your reply</label><textarea id="support-reply" rows={1} maxLength={2000} value={draft} placeholder="Write to Management…" onChange={(event) => { setDraft(event.target.value); autosize(event.currentTarget); }} /><button type="submit" className="inbox-send" aria-label="Send" disabled={busy || !draft.trim()}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M16.5 3.5 3.5 9l5.25 2.25L11 16.5l5.5-13Z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></button></form> : null}</> : <div className="inbox-placeholder"><button type="button" className="inbox-icon-button inbox-close-thread" aria-label="Close enquiries" onClick={requestClose}><Icon name="close" /></button><span className="inbox-empty-mark" aria-hidden="true"><Icon name="support" /></span><strong>{rows?.length ? "Choose a support ticket" : "How can Management help?"}</strong><span>Your support conversations live here. Property conversations remain under Properties.</span></div>}
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

/** Up and down move through the conversations, as they would in any inbox. */
function moveInList(event: React.KeyboardEvent<HTMLButtonElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const list = event.currentTarget.closest("ul");
  const rows = Array.from(list?.querySelectorAll<HTMLButtonElement>(".inbox-row") ?? []);
  const index = rows.indexOf(event.currentTarget);
  const next = rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
  event.preventDefault();
  next?.focus();
}

/** Who the conversation is with, from the reader's side of it. */
function counterpart(row: Pick<Enquiry, "role" | "buyer_name" | "sale">) {
  return row.role === "seller" ? row.buyer_name : row.sale.headline || "Seller";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
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
function groupByDay(messages: (EnquiryMessage | SupportMessage)[]) {
  const days: { key: string; label: string; messages: (EnquiryMessage | SupportMessage)[] }[] = [];
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
