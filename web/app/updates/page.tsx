"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button } from "@/components/Button";
import { Icon, type IconName } from "@/components/portal/icons";
import { useToast } from "@/components/toast/Toaster";
import { PanelSkeleton, PanelState, WorkspaceHead } from "@/components/workspace/Workspace";
import { ApiFailure } from "@/lib/api";
import { listNotificationHistory, markNotificationsRead, type Notification } from "@/lib/console";
import {
  destination,
  needsYou,
  notificationSource,
  notificationStatus,
  notificationTone,
} from "@/lib/notificationMeaning";

type Group = { key: string; title: string; items: Notification[]; urgent?: boolean; note?: string };

/** Where someone was when they opened an update, so Back lands them there. */
const RETURN_KEY = "updates.return";
const RETURN_WINDOW_MS = 30 * 60 * 1000;
type ReturnPoint = { id: string; y: number; at: number };

/** Keeps the shell's badge honest the moment this page changes the count. */
function announceUnread(count: number) {
  window.dispatchEvent(new CustomEvent("danpahq:unread", { detail: count }));
}

/** Alerts clear when read; activity stays available in full. */
export default function UpdatesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [returnedTo, setReturnedTo] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const pendingReturn = useRef<ReturnPoint | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await listNotificationHistory();
      setItems(page.results);
      setUnread(page.unread_count);
      announceUnread(page.unread_count);
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load updates.");
      setItems((current) => current ?? []);
    }
  }, [router]);

  useEffect(() => {
    // Restored in an effect rather than initial state, so the server render and
    // the first client render agree.
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(RETURN_KEY) ?? "null") as ReturnPoint | null;
      window.sessionStorage.removeItem(RETURN_KEY);
      if (saved && Date.now() - saved.at < RETURN_WINDOW_MS) pendingReturn.current = saved;
    } catch {
      // Storage can be unavailable; the page simply opens at the top.
    }
    void load();
  }, [load]);

  const groups = useMemo<Group[]>(() => {
    const source = [...(items ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const alerts = source.filter((item) => item.record === "informational" && !item.is_read);
    const activity = source.filter((item) => item.record === "activity");
    const result: Group[] = [];
    if (alerts.length) result.push({ key: "attention", title: "Alerts", items: alerts });
    if (activity.length) result.push({ key: "recent", title: "Recent activity", items: activity.slice(0, 5) });
    if (activity.length > 5) result.push({ key: "older", title: "Older", items: activity.slice(5) });
    return result;
  }, [items]);

  const shown = groups.reduce((sum, group) => sum + group.items.length, 0);
  const waitingCount = groups.find((group) => group.key === "attention")?.items.length ?? 0;
  const newCount = items?.filter((item) => !item.is_read).length ?? 0;

  // Coming back from a record: the same place, and a brief mark on the row
  // that was opened so the eye finds its way back — if it is still here.
  useLayoutEffect(() => {
    const saved = pendingReturn.current;
    if (!saved || !items?.length) return;
    pendingReturn.current = null;
    const row = document.querySelector<HTMLButtonElement>(`[data-update-id="${CSS.escape(saved.id)}"]`);
    const older = row?.closest<HTMLDetailsElement>("details");
    if (older) older.open = true;
    window.scrollTo({ top: saved.y, behavior: "instant" });
    if (!row) return;
    setReturnedTo(saved.id);
    row.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setReturnedTo(null), 1600);
    return () => window.clearTimeout(timer);
  }, [items]);

  function open(item: Notification) {
    try {
      const point: ReturnPoint = { id: item.id, y: window.scrollY, at: Date.now() };
      window.sessionStorage.setItem(RETURN_KEY, JSON.stringify(point));
    } catch {
      // Without storage, Back simply opens Updates at the top.
    }
    if (!item.is_read) acknowledge(item);
    setOpening(item.id);
    startTransition(() => router.push(destination(item) as never));
  }

  /** Read: a reminder leaves the page (the server deletes it); activity stays. */
  function acknowledge(item: Notification) {
    setItems((current) => current
      ?.filter((row) => !(row.id === item.id && row.record === "informational"))
      .map((row) => row.id === item.id ? { ...row, is_read: true } : row) ?? null);
    setUnread((current) => {
      const next = Math.max(0, current - 1);
      announceUnread(next);
      return next;
    });
    void markNotificationsRead([item.id]).catch(() => void load());
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await markNotificationsRead();
      setItems((current) => current
        ?.filter((item) => item.record !== "informational")
        .map((item) => ({ ...item, is_read: true })) ?? null);
      setUnread(0);
      announceUnread(0);
      toast({ tone: "success", title: "All caught up", description: "Reminders were cleared. Your activity history stays." });
    } catch (cause) {
      toast({
        tone: "error",
        title: "Could not mark updates as read",
        description: cause instanceof ApiFailure ? cause.error.message : "Check your connection and try again.",
      });
    } finally {
      setMarkingAll(false);
    }
  }

  async function retry() {
    setRetrying(true);
    await load();
    setRetrying(false);
  }

  const loading = items === null;
  const hasItems = shown > 0;
  const failedToLoad = Boolean(error) && !items?.length;

  return (
    <div className="ws-page updates-workspace">
      <WorkspaceHead
        icon="updates"
        title="Updates"
        summary={loading ? null : unread > 0 ? (
          <>
            {/* What is listed as new, not the server's whole unread total: weeks-old records sit in Recent. */}
            <strong>{newCount} new</strong>
            {waitingCount > 0 ? <><span className="ws-summary-sep" aria-hidden="true">·</span><span data-tone="warning">{waitingCount} waiting on you</span></> : null}
          </>
        ) : (
          <span className="updates-caught-up"><Icon name="check" />You&rsquo;re all caught up</span>
        )}
        actions={unread > 0 ? (
          <Button
            className="updates-mark-all"
            variant="quiet"
            size="sm"
            busy={markingAll}
            busyLabel="Marking…"
            aria-label="Mark all updates as read"
            title="Mark all read"
            onClick={() => void markAllRead()}
          >
            <Icon name="check" /><span className="updates-mark-all-label">Mark all read</span>
          </Button>
        ) : null}
      />

      <section className="ws-panel" aria-label="Updates" aria-busy={loading || undefined}>
        {error && items?.length ? (
          <div className="ws-inline-error" role="alert">
            <Icon name="warning" />
            <span>{error}</span>
            <button type="button" onClick={() => void retry()} disabled={retrying}>{retrying ? "Retrying…" : "Try again"}</button>
          </div>
        ) : null}

        {loading ? <PanelSkeleton rows={4} /> : null}

        {failedToLoad ? (
          <PanelState
            tone="error"
            icon="warning"
            title="Updates didn’t load"
            body={error}
            action={<Button variant="secondary" size="sm" busy={retrying} busyLabel="Retrying…" onClick={() => void retry()}>Try again</Button>}
          />
        ) : null}

        {!loading && !failedToLoad && !hasItems ? (
          <PanelState
            icon="check"
            title="You’re all caught up"
            body="New viewing, application, agreement and payment updates appear here. Alerts clear once read. Your activity history stays."
          />
        ) : null}

        {hasItems ? (
          <div className="ws-panel-body updates-feed" onKeyDown={moveFocus}>
            {groups.map((group, index) => (
              <UpdateSection
                key={group.key}
                group={group}
                offset={groups.slice(0, index).reduce((sum, previous) => sum + previous.items.length, 0)}
                // The group title already says it; a tag per row would repeat it.
                tagAction={!group.urgent && group.key !== "recent"}
                opening={opening}
                returnedTo={returnedTo}
                onOpen={open}
                onAcknowledge={acknowledge}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function UpdateSection({
  group,
  offset,
  tagAction,
  opening,
  returnedTo,
  onOpen,
  onAcknowledge,
}: {
  group: Group;
  offset: number;
  tagAction: boolean;
  opening: string | null;
  returnedTo: string | null;
  onOpen: (item: Notification) => void;
  onAcknowledge: (item: Notification) => void;
}) {
  const rows = (
      <ul className="ws-rows">
        {group.items.map((item, index) => (
          <UpdateRow
            key={item.id}
            item={item}
            order={offset + index}
            tagAction={tagAction}
            opening={opening === item.id}
            returned={returnedTo === item.id}
            onOpen={onOpen}
            onAcknowledge={onAcknowledge}
          />
        ))}
      </ul>
  );

  if (group.key === "older") {
    return (
      <details className="ws-group updates-older">
        <summary className="ws-group-heading">
          {group.title}<span>{group.items.length}</span>
          <Chevron />
        </summary>
        {rows}
      </details>
    );
  }

  return (
    <section className={`ws-group${group.urgent ? " is-urgent" : ""}`} aria-labelledby={`updates-${group.key}`}>
      <h2 className="ws-group-heading" id={`updates-${group.key}`}>
        {group.title}<span>{group.items.length}</span>
      </h2>
      {group.note ? <p className="updates-group-note">{group.note}</p> : null}
      {rows}
    </section>
  );
}

function UpdateRow({
  item,
  order,
  tagAction,
  opening,
  returned,
  onOpen,
  onAcknowledge,
}: {
  item: Notification;
  order: number;
  tagAction: boolean;
  opening: boolean;
  returned: boolean;
  onOpen: (item: Notification) => void;
  onAcknowledge: (item: Notification) => void;
}) {
  const tone = notificationTone(item);
  const actionable = needsYou(item);
  const status = notificationStatus(item);
  // Only the statuses that change what someone does next earn a visible tag;
  // "Read" and "Completed" are already said by the row's weight and colour.
  const tag = tone === "critical" ? "Important" : actionable && tagAction ? status : null;
  return (
    <li
      className={`update-item${item.is_read ? "" : " is-unread"}${returned ? " is-returned" : ""}`}
      style={{ "--update-order": Math.min(order, 10) } as React.CSSProperties}
    >
      <button
        type="button"
        className={`update-row${item.is_read ? "" : " is-unread"}`}
        data-tone={tone}
        data-update-id={item.id}
        aria-busy={opening || undefined}
        onClick={() => onOpen(item)}
        aria-label={`${item.is_read ? "" : "Unread. "}${notificationSource(item.kind)}. ${item.title}. ${item.body}. ${status}. ${when(item.created_at)}`}
      >
        <span className="update-row-dot" aria-hidden="true" />
        <span className="update-row-symbol" aria-hidden="true"><Icon name={iconFor(item.kind, tone)} /></span>
        <span className="update-row-content">
          <span className="update-row-title">{item.title}</span>
          <span className="update-row-body">
            <span className="update-row-source">{notificationSource(item.kind)}</span>
            <span aria-hidden="true" className="update-row-sep">·</span>
            {item.body}
          </span>
        </span>
        <span className="update-row-end">
          {tag ? <span className="update-row-tag" data-tone={tone}>{tag}</span> : null}
          <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })}>{when(item.created_at)}</time>
          <span className="update-row-go" aria-hidden="true">
            {opening ? <span className="update-row-spinner" /> : <Chevron />}
          </span>
        </span>
      </button>
      {item.is_read ? null : (
        <button
          type="button"
          className="update-row-mark"
          aria-label={`Mark "${item.title}" as read`}
          title="Mark as read"
          onClick={() => onAcknowledge(item)}
        >
          <Icon name="check" />
        </button>
      )}
    </li>
  );
}

function Chevron({ flip = false }: { flip?: boolean }) {
  return (
    <svg className="updates-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"
      style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Up and down move between rows, so the log reads like a list and not a page of links. */
function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const target = event.target as HTMLElement;
  if (!target.classList.contains("update-row")) return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".update-row"))
    .filter((row) => row.offsetParent !== null);
  const index = rows.indexOf(target as HTMLButtonElement);
  const next = event.key === "Home" ? 0
    : event.key === "End" ? rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)));
  event.preventDefault();
  rows[next]?.focus();
}

function iconFor(kind: string, tone: ReturnType<typeof notificationTone>): IconName {
  if (tone === "critical") return "warning";
  if (kind.startsWith("payment.") || kind.startsWith("rent.") || kind.startsWith("billing.")) return "payments";
  if (kind.startsWith("application.") || kind.startsWith("tenancy_request.")) return "applications";
  if (kind.startsWith("viewing.")) return "viewings";
  if (kind.startsWith("lease.")) return "leases";
  if (kind.startsWith("organization.")) return "users";
  if (tone === "success") return "check";
  return "updates";
}

function when(value: string) {
  const at = new Date(value);
  const today = new Date().toDateString() === at.toDateString();
  return at.toLocaleString("en-GH", today
    ? { hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short" });
}
