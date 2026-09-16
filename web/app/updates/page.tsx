"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";
import { Empty, LoadingRows, PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import { listNotifications, markNotificationsRead, type Notification } from "@/lib/console";
import { destination, needsYou } from "@/lib/notificationMeaning";

type View = "all" | "waiting";

/**
 * What happened while the console was closed.
 *
 * A log, deliberately — Home is what knows the state of the business and what is
 * still outstanding. The one thing this adds is that some of these wanted a
 * reply, and the feed used to render a viewing request waiting on you exactly
 * like a receipt for a payment that already went through.
 */
export default function UpdatesPage() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [view, setView] = useState<View>("all");
  const [error, setError] = useState("");

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

  const waiting = useMemo(() => (items ?? []).filter(needsYou), [items]);
  const visible = view === "waiting" ? waiting : items ?? [];

  async function open(item: Notification) {
    if (!item.is_read) await markNotificationsRead([item.id]);
    router.push(destination(item) as never);
  }

  return (
    <div className="updates-workspace">
      <PageHeader
        title="Updates"
        description="Everything that has happened. Home is where you see what is still outstanding."
        actions={
          unread > 0 ? (
            <Button
              variant="secondary"
              onClick={async () => { await markNotificationsRead(); await load(); }}
            >Mark all {unread} as read</Button>
          ) : null
        }
      />

      {error ? <Notice tone="error" title={error} /> : null}

      {items?.length ? (
        <div className="updates-tabs" role="tablist" aria-label="Updates">
          <Tab selected={view === "all"} controls="updates-all" onSelect={() => setView("all")}>
            Everything <span>{items.length}</span>
          </Tab>
          <Tab selected={view === "waiting"} controls="updates-waiting" onSelect={() => setView("waiting")}>
            Waiting on you <span>{waiting.length}</span>
          </Tab>
        </div>
      ) : null}

      {items === null ? <LoadingRows rows={4} /> : null}

      {items?.length === 0 ? (
        <Empty
          icon="updates"
          title="Nothing yet"
          body="When someone asks about one of your places, responds to a request, or a rent record changes, it appears here."
        />
      ) : null}

      {items?.length ? (
        <section
          id={view === "waiting" ? "updates-waiting" : "updates-all"}
          role="tabpanel"
          aria-labelledby={view === "waiting" ? "updates-waiting-tab" : "updates-all-tab"}
        >
          {view === "waiting" && waiting.length === 0 ? (
            <Empty
              icon="updates"
              title="Nothing is waiting on you"
              body="Updates that asked for a reply appear here until you open them."
            />
          ) : (
            <ul className="updates-rows">
              {visible.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`update-row${item.is_read ? "" : " is-unread"}`}
                    onClick={() => void open(item)}
                  >
                    <p className={item.is_read ? "update-row-title type-body" : "update-row-title type-body-strong"}>
                      {item.title}
                    </p>
                    {needsYou(item) ? <span className="update-row-flag">Needs a reply</span> : null}
                    <p className="update-row-body">{item.body}</p>
                    <span className="update-row-when">{when(item.created_at)}</span>
                    <span className="update-row-arrow" aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Tab({
  selected,
  controls,
  onSelect,
  children,
}: {
  selected: boolean;
  controls: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={`${controls}-tab`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      className="updates-tab type-body-strong"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const tabs = Array.from(
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? [],
        );
        const current = tabs.indexOf(event.currentTarget);
        const next = tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
        event.preventDefault();
        next?.focus();
        next?.click();
      }}
    >{children}</button>
  );
}

/** Today keeps its clock; anything older keeps its date. */
function when(value: string) {
  const at = new Date(value);
  const today = new Date().toDateString() === at.toDateString();
  return at.toLocaleString("en-GH", today
    ? { hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
