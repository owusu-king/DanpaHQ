"use client";

import { Icon, type IconName } from "@/components/portal/icons";

export type CheckpointState = "completed" | "current" | "upcoming" | "attention";

export type CreationCheckpoint = {
  key: string;
  label: string;
  icon: IconName;
  state: CheckpointState;
};

/**
 * The milestone language shared by Property and Unit creation.
 *
 * Progress, and — when the page passes `onSelect` — the way between sections
 * too (owner, 2026-10-05: jump "via the tracking icons", with no side list).
 * `canSelect` says which icons may be pressed: every section of a property
 * that already exists, but a Unit step only once the steps before it are done.
 */
export function CheckpointJourney({
  checkpoints,
  label,
  ariaLabel,
  valueNow,
  valueMax,
  onSelect,
  canSelect,
}: {
  checkpoints: CreationCheckpoint[];
  label: string;
  ariaLabel: string;
  /** Makes each reachable icon a button that opens its section. */
  onSelect?: (key: string) => void;
  canSelect?: (checkpoint: CreationCheckpoint) => boolean;
  /** Optional domain-specific completion value (for example required setup work). */
  valueNow?: number;
  valueMax?: number;
}) {
  const currentIndex = Math.max(
    0,
    checkpoints.findIndex((checkpoint) => checkpoint.state === "current"),
  );
  const nearby = checkpoints.slice(
    Math.max(0, Math.min(currentIndex - 1, checkpoints.length - 3)),
    Math.min(checkpoints.length, Math.max(3, currentIndex + 2)),
  );
  const complete = checkpoints.filter((checkpoint) => checkpoint.state === "completed").length;

  return (
    <section
      className="checkpoint-journey"
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={valueMax ?? checkpoints.length}
      aria-valuenow={valueNow ?? complete}
      aria-valuetext={`${label}. ${currentIndex + 1} of ${checkpoints.length}: ${checkpoints[currentIndex]?.label}.`}
    >
      <div className="checkpoint-journey-head">
        <span className="type-label">{label}</span>
        <span className="type-caption checkpoint-position">
          {currentIndex + 1} of {checkpoints.length}
        </span>
      </div>

      <CheckpointRow checkpoints={checkpoints} className="checkpoint-row-wide" onSelect={onSelect} canSelect={canSelect} />
      <CheckpointRow checkpoints={nearby} className="checkpoint-row-compact" onSelect={onSelect} canSelect={canSelect} />
    </section>
  );
}

function CheckpointRow({
  checkpoints,
  className,
  onSelect,
  canSelect,
}: {
  checkpoints: CreationCheckpoint[];
  className: string;
  onSelect?: (key: string) => void;
  canSelect?: (checkpoint: CreationCheckpoint) => boolean;
}) {
  return (
    <ol
      className={`checkpoint-row ${className}${onSelect ? " is-navigable" : ""}`}
      style={{ "--checkpoint-count": checkpoints.length } as React.CSSProperties}
      // Read once, by the progressbar above, unless the icons are controls.
      aria-hidden={onSelect ? undefined : "true"}
      aria-label={onSelect ? "Sections" : undefined}
    >
      {checkpoints.map((checkpoint, index) => {
        const previous = checkpoints[index - 1];
        const connectorComplete = previous?.state === "completed"
          && (checkpoint.state === "completed" || checkpoint.state === "current");
        return (
          <li
            key={checkpoint.key}
            className={`checkpoint checkpoint-${checkpoint.state}${connectorComplete ? " connector-complete" : ""}`}
          >
            {index ? <span className="checkpoint-connector" /> : null}
            {onSelect && (canSelect ? canSelect(checkpoint) : true) ? (
              <button
                type="button"
                className="checkpoint-button"
                aria-current={checkpoint.state === "current" ? "step" : undefined}
                aria-label={`${checkpoint.label}${checkpoint.state === "completed" ? ", done" : checkpoint.state === "attention" ? ", started" : ""}`}
                onClick={() => onSelect(checkpoint.key)}
              >
                <Marker checkpoint={checkpoint} />
                <span className="checkpoint-label">{checkpoint.label}</span>
              </button>
            ) : (
              <>
                <Marker checkpoint={checkpoint} />
                <span className="checkpoint-label">{checkpoint.label}</span>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Marker({ checkpoint }: { checkpoint: CreationCheckpoint }) {
  return (
    <span className="checkpoint-marker" aria-hidden="true">
      {checkpoint.state === "completed" ? (
        <span className="checkpoint-check">✓</span>
      ) : checkpoint.state === "attention" ? (
        <span className="checkpoint-warning">!</span>
      ) : (
        <Icon name={checkpoint.icon} />
      )}
    </span>
  );
}
