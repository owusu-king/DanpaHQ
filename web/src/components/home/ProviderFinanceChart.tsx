"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";

import type { OrganizationPortfolio } from "@/lib/console";
import { abbreviateMoney, formatMoney } from "@/lib/money";

type Collection = OrganizationPortfolio["rent_collection"];
type Point = Collection["monthly"][number];
type Period = "monthly" | "yearly";

const WIDTH = 920;
const HEIGHT = 276;
const LEFT = 54;
const RIGHT = 78;
const TOP = 22;
const BOTTOM = 34;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;

export function ProviderFinanceChart({ collection }: { collection: Collection }) {
  const [period, setPeriod] = useState<Period>("monthly");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const gradientId = useId().replaceAll(":", "");
  const points = collection[period];
  const totals = useMemo(
    () => points.reduce(
      (sum, point) => ({
        collected: sum.collected + point.collected_minor,
        outstanding: sum.outstanding + point.outstanding_minor,
      }),
      { collected: 0, outstanding: 0 },
    ),
    [points],
  );
  const latest = points.at(-1);
  const previous = points.at(-2);
  const outstandingPeriods = points.filter((point) => point.outstanding_minor > 0).length;
  const endLabel = latest
    ? abbreviateMoney({ minor: latest.collected_minor, currency: collection.currency })
    : "";
  const comparison = collectionComparison(latest, previous, period);

  const maxValue = Math.max(
    1,
    ...points.flatMap((point) => [point.collected_minor, point.outstanding_minor]),
  );
  const axisMax = niceCeiling(maxValue);
  const step = points.length > 1 ? PLOT_WIDTH / (points.length - 1) : PLOT_WIDTH;
  const x = (index: number) => LEFT + step * index;
  const y = (value: number) => TOP + PLOT_HEIGHT * (1 - value / axisMax);
  const collectedPath = monotonePath(
    points.map((_, index) => x(index)),
    points.map((point) => y(point.collected_minor)),
  );
  const areaPath = points.length
    ? `${collectedPath} L ${x(points.length - 1)} ${TOP + PLOT_HEIGHT} L ${x(0)} ${TOP + PLOT_HEIGHT} Z`
    : "";
  const active = activeIndex === null ? null : points[activeIndex] ?? null;
  const activeX = activeIndex === null ? 0 : x(activeIndex);
  const activeY = active ? y(active.collected_minor) : 0;

  return (
    <section className="home-finance-chart" aria-labelledby="home-finance-chart-title">
      <div className="home-finance-head">
        <div>
          <p className="home-eyebrow">Rent collection</p>
          <h2 id="home-finance-chart-title">Confirmed received and still outstanding</h2>
          <p>Grouped by payment date and obligation due date.</p>
        </div>
        <div className="home-finance-actions">
          <div className="home-period-toggle" data-period={period} aria-label="Chart period">
            <span aria-hidden="true" />
            <button
              type="button"
              aria-pressed={period === "monthly"}
              onClick={() => { setPeriod("monthly"); setActiveIndex(null); }}
            >
              Monthly
            </button>
            <button
              type="button"
              aria-pressed={period === "yearly"}
              onClick={() => { setPeriod("yearly"); setActiveIndex(null); }}
            >
              Yearly
            </button>
          </div>
          <Link href="/payments" className="home-widget-link">
            Open Payments
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>

      <div className="home-finance-metrics">
        <div>
          <span><i className="is-collected" aria-hidden="true" />Confirmed in view</span>
          <strong>{formatMoney({ minor: totals.collected, currency: collection.currency })}</strong>
          <small>{comparison}</small>
        </div>
        <div>
          <span><i className="is-outstanding" aria-hidden="true" />Still outstanding in view</span>
          <strong>{formatMoney({ minor: totals.outstanding, currency: collection.currency })}</strong>
          {/* Money still owed is not good news, and the sub-line should not be
              the same reassuring green as the figure above it. */}
          <small data-tone="negative">
            {outstandingPeriods
              ? `${outstandingPeriods} ${outstandingPeriods === 1 ? "period" : "periods"} still owing`
              : "Nothing outstanding in this view"}
          </small>
        </div>
      </div>

      <div className="home-chart-wrap" onPointerLeave={() => setActiveIndex(null)}>
        <svg
          className="home-chart"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="group"
          aria-label={`${period === "monthly" ? "Monthly" : "Yearly"} rent collection chart`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ph-navy)" stopOpacity=".32" />
              <stop offset="55%" stopColor="var(--ph-navy)" stopOpacity=".08" />
              <stop offset="100%" stopColor="var(--ph-navy)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, .25, .5, .75, 1].map((ratio) => {
            const lineY = TOP + PLOT_HEIGHT * ratio;
            const value = axisMax * (1 - ratio);
            return (
              <g key={ratio} className="home-chart-grid">
                <line x1={LEFT} y1={lineY} x2={WIDTH - RIGHT} y2={lineY} />
                <text x={LEFT - 10} y={lineY + 4} textAnchor="end">{abbreviateMoney({ minor: value, currency: collection.currency })}</text>
              </g>
            );
          })}

          {points.map((point, index) => {
            const barWidth = Math.min(22, Math.max(10, step * .34));
            const barY = y(point.outstanding_minor);
            const barHeight = Math.max(0, TOP + PLOT_HEIGHT - barY);
            const label = periodLabel(point.period, period);
            return (
              <g key={point.period}>
                <rect
                  className="home-chart-bar"
                  data-active={activeIndex === index || undefined}
                  x={x(index) - barWidth / 2}
                  y={barY}
                  width={barWidth}
                  height={barHeight}
                  // A short column with a full pill radius collapses into an
                  // ellipse, which reads as a dot rather than a quantity.
                  rx={Math.min(barWidth / 2, barHeight / 2)}
                />
                <text
                  className="home-chart-label"
                  data-emphasis={activeIndex === index || index === points.length - 1 || undefined}
                  x={x(index)}
                  y={HEIGHT - 9}
                  textAnchor="middle"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {areaPath ? <path className="home-chart-area" d={areaPath} fill={`url(#${gradientId})`} /> : null}
          {collectedPath ? (
            <path className="home-chart-line" pathLength="1" d={collectedPath} />
          ) : null}

          {points.map((point, index) => (
            <circle
              key={`point-${point.period}`}
              className="home-chart-point"
              data-active={activeIndex === index || index === points.length - 1 || undefined}
              cx={x(index)}
              cy={y(point.collected_minor)}
              r={activeIndex === index ? 5.5 : 4}
            />
          ))}

          {latest && points.length > 1 ? (
            <g className="home-chart-end" aria-hidden="true">
              <line
                x1={x(points.length - 1)}
                y1={y(latest.collected_minor)}
                x2={x(points.length - 1) + 13}
                y2={y(latest.collected_minor)}
              />
              <rect
                x={x(points.length - 1) + 14}
                y={y(latest.collected_minor) - 11}
                width={endLabel.length * 6.6 + 14}
                height={22}
                rx={6}
              />
              <text x={x(points.length - 1) + 21} y={y(latest.collected_minor) + 4}>
                {endLabel}
              </text>
            </g>
          ) : null}

          {active ? (
            <line
              className="home-chart-crosshair"
              x1={activeX}
              y1={TOP}
              x2={activeX}
              y2={TOP + PLOT_HEIGHT}
            />
          ) : null}

          {points.map((point, index) => {
            const hitLeft = index === 0 ? LEFT : (x(index - 1) + x(index)) / 2;
            const hitRight = index === points.length - 1
              ? WIDTH - RIGHT
              : (x(index) + x(index + 1)) / 2;
            return (
              <rect
                key={`hit-${point.period}`}
                className="home-chart-hit"
                x={hitLeft}
                y={TOP}
                width={hitRight - hitLeft}
                height={PLOT_HEIGHT}
                tabIndex={0}
                role="img"
                aria-label={`${fullPeriodLabel(point.period, period)}: ${formatMoney({ minor: point.collected_minor, currency: collection.currency })} confirmed, ${formatMoney({ minor: point.outstanding_minor, currency: collection.currency })} still outstanding`}
                onPointerEnter={() => setActiveIndex(index)}
                onPointerMove={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
              />
            );
          })}
        </svg>

        {active && activeIndex !== null ? (
          <div
            className="home-chart-tooltip"
            role="status"
            style={{
              left: `${(activeX / WIDTH) * 100}%`,
              top: `${Math.max(8, (activeY / HEIGHT) * 100)}%`,
            }}
          >
            <strong>{fullPeriodLabel(active.period, period)}</strong>
            <p>
              <i className="is-collected" aria-hidden="true" />
              <span>Collected</span>
              <b>{formatMoney({ minor: active.collected_minor, currency: collection.currency })}</b>
            </p>
            <p>
              <i className="is-outstanding" aria-hidden="true" />
              <span>Outstanding</span>
              <b>{formatMoney({ minor: active.outstanding_minor, currency: collection.currency })}</b>
            </p>
          </div>
        ) : null}

        {totals.collected === 0 && totals.outstanding === 0 ? (
          <p className="home-chart-empty">No rent activity falls inside this view yet.</p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The top of the axis: a little headroom above the peak, rounded to a tick a
 * person can read.
 *
 * Quarter-power steps rather than the 1/2/5/10 ladder, which for a peak of
 * GH₵27k would jump the axis to GH₵50k and leave the whole series
 * squashed into the bottom half of the plot. The shape of the trend is the
 * point of the chart; wasting half the height loses it.
 */
function niceCeiling(value: number): number {
  const target = value * 1.12;
  const power = 10 ** Math.floor(Math.log10(target));
  const step = power / 4;
  return Math.ceil(target / step) * step;
}

function periodLabel(value: string, period: Period): string {
  if (period === "yearly") return value;
  return new Date(`${value}-01T12:00:00`).toLocaleDateString("en-GH", { month: "short" });
}

function fullPeriodLabel(value: string, period: Period): string {
  if (period === "yearly") return value;
  return new Date(`${value}-01T12:00:00`).toLocaleDateString("en-GH", {
    month: "long",
    year: "numeric",
  });
}

function collectionComparison(latest: Point | undefined, previous: Point | undefined, period: Period): string {
  if (!latest || !previous) return "No earlier period to compare";
  if (latest.collected_minor === 0 && previous.collected_minor === 0) {
    return `No confirmed collection in the latest ${period === "monthly" ? "month" : "year"}`;
  }
  if (previous.collected_minor === 0) return "Collection began in the latest period";
  const change = Math.round(
    ((latest.collected_minor - previous.collected_minor) / previous.collected_minor) * 100,
  );
  const direction = change > 0 ? "+" : "";
  return `${direction}${change}% vs the previous ${period === "monthly" ? "month" : "year"}`;
}

/** Monotone cubic interpolation keeps the line refined without overshooting data. */
function monotonePath(xs: number[], ys: number[]): string {
  if (xs.length === 0) return "";
  if (xs.length === 1) return `M ${xs[0]} ${ys[0]}`;
  const slopes = xs.slice(0, -1).map((value, index) => (
    (ys[index + 1]! - ys[index]!) / (xs[index + 1]! - value)
  ));
  const tangents = new Array<number>(xs.length);
  tangents[0] = slopes[0]!;
  tangents[tangents.length - 1] = slopes.at(-1)!;
  for (let index = 1; index < tangents.length - 1; index += 1) {
    tangents[index] = slopes[index - 1]! * slopes[index]! <= 0
      ? 0
      : (slopes[index - 1]! + slopes[index]!) / 2;
  }
  let path = `M ${xs[0]} ${ys[0]}`;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const distance = (xs[index + 1]! - xs[index]!) / 3;
    path += ` C ${xs[index]! + distance} ${ys[index]! + tangents[index]! * distance},`;
    path += ` ${xs[index + 1]! - distance} ${ys[index + 1]! - tangents[index + 1]! * distance},`;
    path += ` ${xs[index + 1]} ${ys[index + 1]}`;
  }
  return path;
}
