"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Popover } from "radix-ui";
import { ArrowUp, X } from "lucide-react";

import { IntelMark } from "@/components/IntelMark";


const POSITION_KEY = "danpa-intel-corner";
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
type Corner = typeof CORNERS[number];

const GREETING = "Hey, I am DanpaHQ Intel. How may I assist you? Once you have an account, I will meet you in your workspace to unleash my full capabilities.";
const WORKSPACE_NOTE = "I'll meet you at your workspace.";

/** A local greeting exchange; the workspace assistant is integrated separately. */
export function DanpaIntel() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const messageArea = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [mounted, setMounted] = useState(false);
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const gesture = useRef<{ pointer: number; x: number; y: number; left: number; top: number; width: number; height: number; position: { x: number; y: number }; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setMounted(true);
      try {
        const saved = localStorage.getItem(POSITION_KEY);
        if (CORNERS.includes(saved as Corner)) setCorner(saved as Corner);
      } catch { /* Positioning still works when browser storage is unavailable. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const area = messageArea.current;
    if (open && area) area.scrollTop = area.scrollHeight;
  }, [messages, open]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { role: "user", text },
      { role: "assistant", text: current.length ? WORKSPACE_NOTE : GREETING },
    ]);
    setDraft("");
    input.current?.focus();
  }

  function remember(next: Corner) {
    setCorner(next);
    try { localStorage.setItem(POSITION_KEY, next); } catch { /* Optional preference. */ }
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top, width: box.width, height: box.height, position: { x: box.left, y: box.top }, moved: false };
    suppressClick.current = false;
    if (event.pointerType === "mouse") event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const start = gesture.current;
    if (!start || start.pointer !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 6) return;
    if (!start.moved) event.currentTarget.setPointerCapture(event.pointerId);
    start.moved = true;
    const width = document.documentElement.getBoundingClientRect().width;
    start.position = { x: Math.max(16, Math.min(start.left + dx, width - start.width - 16)), y: Math.max(16, Math.min(start.top + dy, window.innerHeight - start.height - 16)) };
    setDragPosition(start.position);
  }
  function finishDrag(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const start = gesture.current;
    if (!start || start.pointer !== event.pointerId) return;
    gesture.current = null;
    suppressClick.current = start.moved;
    if (start.moved && !cancelled) {
      const vertical = start.position.y + start.height / 2 < window.innerHeight / 2 ? "top" : "bottom";
      const horizontal = start.position.x + start.width / 2 < document.documentElement.clientWidth / 2 ? "left" : "right";
      remember(`${vertical}-${horizontal}`);
    }
    if (!start.moved && !cancelled && event.pointerType === "touch") {
      // Touch browsers may omit the compatibility click after a drag.
      suppressClick.current = true;
      setOpen(true);
    }
    setDragPosition(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <Popover.Root modal open={open} onOpenChange={setOpen}>
    {mounted ? createPortal(<Popover.Trigger asChild>
      <button type="button" className={`lp-intel-entry${dragPosition ? " is-dragging" : ""}`} data-corner={corner}
        style={dragPosition ? { left: dragPosition.x, top: dragPosition.y, right: "auto", bottom: "auto" } : undefined}
        aria-label="Open Danpa Intel" aria-describedby={id + "-entry"} title="Danpa Intel · Drag to move"
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={event => finishDrag(event)} onPointerCancel={event => finishDrag(event, true)} onLostPointerCapture={event => { if (event.target === event.currentTarget) finishDrag(event, true); }}
        onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } suppressClick.current = false; }}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") suppressClick.current = false;
          if (!event.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          const vertical = event.key === "ArrowUp" ? "top" : event.key === "ArrowDown" ? "bottom" : corner.startsWith("top") ? "top" : "bottom";
          const horizontal = event.key === "ArrowLeft" ? "left" : event.key === "ArrowRight" ? "right" : corner.endsWith("left") ? "left" : "right";
          remember(`${vertical}-${horizontal}`);
        }}>
        <IntelMark />
        <span id={id + "-entry"} className="sr-only">Your AI guide to housing information and services. Drag to move, or use Alt and arrow keys to choose a corner.</span>
      </button>
    </Popover.Trigger>, document.body) : null}
    <Popover.Portal>
    <Popover.Content side="top" align="end" sideOffset={12} collisionPadding={16} className="danpa-intel-panel" onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }} aria-labelledby={id + "-title"} aria-describedby={id + "-description"}>
      <header className="intel-header">
        <span className="intel-identity" aria-hidden="true"><IntelMark /></span>
        <div className="intel-header-copy">
          <div className="intel-title-row"><h2 id={id + "-title"}>Danpa Intel</h2></div>
          <p id={id + "-description"} className="sr-only">Your AI housing assistant.</p>
        </div>
        <Popover.Close className="intel-close" aria-label="Close Danpa Intel"><X aria-hidden="true" /></Popover.Close>
      </header>
      <section ref={messageArea} className="intel-messages" aria-label="Message area">
        {!messages.length ? (
          <div className="intel-welcome">
            <h3>Hello.</h3>
            <p>Say hello to DanpaHQ Intel.</p>
          </div>
        ) : null}
        <div className="intel-transcript" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
          {messages.map((message, index) => (
            <p key={index} className={`intel-message is-${message.role}`}>
              <span className="sr-only">{message.role === "user" ? "You: " : "DanpaHQ Intel: "}</span>
              {message.text}
            </p>
          ))}
        </div>
      </section>
      <form className="intel-composer" onSubmit={event => { event.preventDefault(); send(); }}>
        <div className="intel-input-wrap">
          <textarea ref={input} rows={1} value={draft} maxLength={500} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            aria-label="Message Danpa Intel" aria-describedby={id + "-input-hint"} placeholder="Say hello…" />
          <button type="submit" disabled={!draft.trim()} aria-label="Send message"><ArrowUp aria-hidden="true" /></button>
        </div>
        <p id={id + "-input-hint"}>{WORKSPACE_NOTE}</p>
      </form>
    </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
