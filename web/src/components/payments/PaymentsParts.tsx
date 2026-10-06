"use client";

/**
 * The pieces both sides of Payments are drawn from, so a tenant and a landlord
 * read money the same way: the headline figures, the tiles for what is waiting
 * on the reader, the view tabs, and the ledger's column head. Styles live in
 * payments-workspace.css.
 */

import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/portal/icons";
import { formatMoney } from "@/lib/money";

/** Money in cedis, the one way the Payments pages print an amount. */
export const ghs = (minor: number) => formatMoney({ minor, currency: "GHS" });

/** A part of a whole, from 0 to 1, safe when the whole is nothing. */
export function share(part: number, whole: number) {
  return whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0;
}

export function percent(part: number, whole: number) {
  return `${Math.round(share(part, whole) * 100)}%`;
}

export type FigureTone = "received" | "settled" | "outstanding" | "overdue";
export type FigureTrend = "up" | "down" | "flat" | "settled";

/**
 * One headline figure, as a card of its own: a quiet label with the direction
 * it moves in, a strong amount in the colour of what it means, and a hairline
 * showing the share it is of the whole it belongs to.
 */
export function FinanceFigure({ trend, tone, label, value, ratio, note }: { trend: FigureTrend; tone: FigureTone; label: string; value: number; ratio: number; note: string }) {
  return (
    <div className="payments-figure" data-tone={tone} data-zero={value === 0 || undefined}>
      <dt>
        <span>{label}</span>
        <TrendGlyph trend={trend} />
      </dt>
      <dd className="payments-figure-amount">{ghs(value)}</dd>
      <dd className="payments-figure-meter" aria-hidden="true"><span style={{ transform: `scaleX(${ratio})` }} /></dd>
      <dd className="payments-figure-note">{note}</dd>
    </div>
  );
}

function TrendGlyph({ trend }: { trend: FigureTrend }) {
  const path = trend === "up"
    ? "M3 13.5l4.5-4.5 3 3L17 5.5M12.5 5.5H17V10"
    : trend === "down"
      ? "M3 6.5l4.5 4.5 3-3L17 14.5M12.5 14.5H17V10"
      : trend === "settled"
        ? "M4 10.5l3.5 3.5L16 6"
        : "M4 10h12";
  return (
    <svg className="payments-figure-trend" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Something waiting on the reader, and the one place that answers it. */
export function AttentionTile({ tone, icon, title, action, onClick }: { tone: "overdue" | "review" | "payout"; icon: IconName; title: string; action: string; onClick: () => void }) {
  return (
    <button type="button" className="rent-attention-tile" data-tone={tone} onClick={onClick}>
      <span className="rent-attention-mark" aria-hidden="true"><Icon name={icon} /></span>
      <span className="rent-attention-copy"><strong>{title}</strong><span>{action}</span></span>
      <svg className="rent-attention-go" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3.5 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );
}

/** Column names for a ledger, drawn once above the rows on wide screens. */
export function LedgerHead({ columns }: { columns: [string, string, string, string] }) {
  return <div className="rent-ledger-head" aria-hidden="true"><span>{columns[0]}</span><span>{columns[1]}</span><span>{columns[2]}</span><span>{columns[3]}</span></div>;
}

/** One of the page's views, as a tab that arrow keys move between. */
export function PaymentTab({ selected, controls, icon, count, alert = false, onClick, children }: { selected: boolean; controls: string; icon: IconName; count?: number; alert?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      id={`${controls}-tab`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      className="payments-tab"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]") ?? []);
        const current = tabs.indexOf(event.currentTarget);
        const next = tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
        event.preventDefault();
        next?.focus();
        next?.click();
      }}
    >
      <Icon name={icon} />
      <span className="payments-tab-label">{children}</span>
      {count ? <span className="payments-tab-count" data-alert={alert || undefined}>{count}</span> : null}
    </button>
  );
}

export function Chevron() {
  return <svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
