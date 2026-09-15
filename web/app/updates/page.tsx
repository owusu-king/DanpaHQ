"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { Icon, type IconName } from "@/components/portal/icons";
import { ApiFailure } from "@/lib/api";
import { listNotifications, markNotificationsRead, type Notification } from "@/lib/console";
import {
  destination,
  needsYou,
  notificationCategory,
  notificationSource,
  notificationStatus,
  notificationTone,
  type NotificationCategory,
} from "@/lib/notificationMeaning";

type View = "all" | "unread" | "action" | NotificationCategory;
type Group = { key: string; title: string; items: Notification[]; urgent?: boolean };
const PAGE_SIZE = 10;

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  rental: "Rental",
  applications: "Applications",
  payments: "Payments",
  system: "System",
};

/** Notification history; Home remains the source of truth for live work. */
export default function UpdatesPage() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [view, setView] = useState<View>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await listNotifications();
      setItems(page.results);
      setUnread(page.unread_count);
      setError("");
    } catch (cause) {
      if (cause instanceof ApiFailure && (cause.status === 401 || cause.status === 403)) {
        router.push("/sign-in");
        return;
      }
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not load updates.");
      setItems([]);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const source = items ?? [];
    return {
      unread: source.filter((item) => !item.is_read).length,
      action: source.filter(needsYou).length,
      rental: source.filter((item) => notificationCategory(item.kind) === "rental").length,
      applications: source.filter((item) => notificationCategory(item.kind) === "applications").length,
      payments: source.filter((item) => notificationCategory(item.kind) === "payments").length,
      system: source.filter((item) => notificationCategory(item.kind) === "system").length,
    };
  }, [items]);

  const visible = useMemo(() => {
    const source = items ?? [];
    if (view === "unread") return source.filter((item) => !item.is_read);
    if (view === "action") return source.filter(needsYou);
    if (view !== "all") return source.filter((item) => notificationCategory(item.kind) === view);
    return source;
  }, [items, view]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const orderedVisible = useMemo(
    () => view === "all" ? [...visible.filter(needsYou), ...visible.filter((item) => !needsYou(item))] : visible,
    [view, visible],
  );
  const paged = useMemo(
    () => orderedVisible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, orderedVisible],
  );
  const groups = useMemo(() => groupUpdates(paged, view === "all"), [paged, view]);

  function selectView(next: View) {
    setView(next);
    setPage(1);
  }

  function open(item: Notification) {
    if (!item.is_read) {
      setItems((current) => current?.map((row) => row.id === item.id ? { ...row, is_read: true } : row) ?? null);
      setUnread((current) => Math.max(0, current - 1));
      void markNotificationsRead([item.id]).catch(() => void load());
    }
    router.push(destination(item) as never);
  }

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await markNotificationsRead();
      setItems((current) => current?.map((item) => ({ ...item, is_read: true })) ?? null);
      setUnread(0);
    } catch (cause) {
      setError(cause instanceof ApiFailure ? cause.error.message : "Could not mark updates as read.");
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="updates-workspace">
      
      <PageHeader title="Updates" description="Stay informed with the latest changes and activity across your own." />
      {error ? <Notice tone="error" title={error} /> : null}

      {items?.length ? (
        <div className="updates-controls">
          <nav className="updates-filters" aria-label="Filter updates">
            <FilterButton label="All" count={items.length} selected={view === "all"} onSelect={() => selectView("all")} />
            <FilterButton label="Unread" count={counts.unread} selected={view === "unread"} onSelect={() => selectView("unread")} />
            <FilterButton label="Action needed" count={counts.action} selected={view === "action"} onSelect={() => selectView("action")} />
            {(Object.keys(CATEGORY_LABEL) as NotificationCategory[]).map((category) => counts[category] > 0 ? (
              <FilterButton
                key={category}
                label={CATEGORY_LABEL[category]}
                count={counts[category]}
                selected={view === category}
                onSelect={() => selectView(category)}
              />
            ) : null)}
          </nav>
          {unread > 0 ? (
            <Button className="updates-mark-all" variant="quiet" size="sm" busy={markingAll} onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          ) : null}
        </div>
      ) : null}

      {items === null ? <div className="updates-loading"><LoadingRows rows={4} /></div> : null}

      {items?.length === 0 ? (
        <Empty
          title="Nothing here yet"
          body="Rental, application, agreement and payment updates will appear here as your Rooomly journey moves forward."
        />
      ) : null}

      {items?.length && visible.length === 0 ? (
        <Empty
          title={view === "action" ? "Nothing needs your attention" : `No ${view === "unread" ? "unread" : CATEGORY_LABEL[view as NotificationCategory]?.toLowerCase()} updates`}
          body="Choose another filter to see the rest of your update history."
        />
      ) : null}

      {groups.map((group) => (
        <UpdateSection key={group.key} group={group} onOpen={open} />
      ))}

      {visible.length > PAGE_SIZE ? (
        <Pagination
          page={currentPage}
          pages={pageCount}
          total={visible.length}
          onPage={setPage}
        />
      ) : null}
    </div>
  );
}

function FilterButton({ label, count, selected, onSelect }: { label: string; count: number; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="updates-filter" aria-pressed={selected} onClick={onSelect}>
      {label}<span>{count}</span>
    </button>
  );
}

function UpdateSection({ group, onOpen }: { group: Group; onOpen: (item: Notification) => void }) {
  return (
    <section className={`updates-group${group.urgent ? " is-urgent" : ""}`} aria-labelledby={`updates-${group.key}`}>
      <div className="updates-group-heading">
        <h2 id={`updates-${group.key}`}>{group.title}</h2>
        <span>{group.items.length}</span>
      </div>
      <ul className="updates-rows">
        {group.items.map((item) => <UpdateRow key={item.id} item={item} onOpen={onOpen} />)}
      </ul>
    </section>
  );
}

function UpdateRow({ item, onOpen }: { item: Notification; onOpen: (item: Notification) => void }) {
  const tone = notificationTone(item);
  const actionable = needsYou(item);
  return (
    <li>
      <button
        type="button"
        className={`update-row${item.is_read ? "" : " is-unread"}`}
        data-tone={tone}
        onClick={() => onOpen(item)}
        aria-label={`${notificationSource(item.kind)}. ${item.title}. ${item.body}. ${notificationStatus(item)}. ${when(item.created_at)}`}
      >
        <span className="update-row-symbol"><Icon name={iconFor(item.kind, tone)} /></span>
        <span className="update-row-content">
          <span className="update-row-meta">
            <span className="update-row-source">{notificationSource(item.kind)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={item.created_at}>{when(item.created_at)}</time>
            <span aria-hidden="true">·</span>
            <span className="update-row-status">{notificationStatus(item)}</span>
          </span>
          <span className="update-row-title">{item.title}</span>
          <span className="update-row-body">{item.body}</span>
        </span>
        <span className="update-row-end">
          {actionable ? <span className="update-row-action">Review now</span> : null}
          <span className="update-row-arrow" aria-hidden="true">›</span>
        </span>
      </button>
    </li>
  );
}

function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  return (
    <nav className="updates-pagination" aria-label="Updates pages">
      <p><strong>{first}–{last}</strong> of {total}</p>
      <div>
        <button type="button" disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span aria-current="page">{page} / {pages}</span>
        <button type="button" disabled={page === pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </nav>
  );
}

function iconFor(kind: string, tone: ReturnType<typeof notificationTone>): IconName {
  if (tone === "critical" || tone === "warning" || tone === "action") return "warning";
  if (kind.startsWith("payment.") || kind.startsWith("rent.") || kind.startsWith("billing.")) return "payments";
  if (kind.startsWith("application.") || kind.startsWith("tenancy_request.")) return "applications";
  if (kind.startsWith("viewing.")) return "viewings";
  if (kind.startsWith("lease.")) return "leases";
  if (tone === "success") return "check";
  return "updates";
}

function groupUpdates(items: Notification[], pullActionForward: boolean): Group[] {
  const action = pullActionForward ? items.filter(needsYou) : [];
  const timeline = pullActionForward ? items.filter((item) => !needsYou(item)) : items;
  const buckets = new Map<string, Notification[]>();
  for (const item of timeline) {
    const key = timeBucket(item.created_at);
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  const groups: Group[] = [];
  if (action.length) groups.push({ key: "attention", title: "Needs your attention", items: action, urgent: true });
  for (const [key, title] of [["today", "Today"], ["week", "This week"], ["earlier", "Earlier"]] as const) {
    const grouped = buckets.get(key);
    if (grouped?.length) groups.push({ key, title, items: grouped });
  }
  return groups;
}

function timeBucket(value: string): "today" | "week" | "earlier" {
  const at = new Date(value);
  const now = new Date();
  if (at.toDateString() === now.toDateString()) return "today";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return startOfToday - at.getTime() < 7 * 24 * 60 * 60 * 1000 ? "week" : "earlier";
}

function when(value: string) {
  const at = new Date(value);
  const today = new Date().toDateString() === at.toDateString();
  return at.toLocaleString("en-GH", today
    ? { hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
