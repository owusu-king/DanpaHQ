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
 * This is progress, not navigation. Property's separate checklist remains the
 * place where non-sequential work is opened; Unit creation remains sequential.
 */
export function CheckpointJourney({
  checkpoints,
  label,
  ariaLabel,
  valueNow,
  valueMax,
}: {
  checkpoints: CreationCheckpoint[];
  label: string;
  ariaLabel: string;
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

      <CheckpointRow checkpoints={checkpoints} className="checkpoint-row-wide" />
      <CheckpointRow checkpoints={nearby} className="checkpoint-row-compact" />
    </section>
  );
}

function CheckpointRow({
  checkpoints,
  className,
}: {
  checkpoints: CreationCheckpoint[];
  className: string;
}) {
  return (
    <ol
      className={`checkpoint-row ${className}`}
      style={{ "--checkpoint-count": checkpoints.length } as React.CSSProperties}
      aria-hidden="true"
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
            <span className="checkpoint-marker">
              {checkpoint.state === "completed" ? (
                <span className="checkpoint-check">✓</span>
              ) : checkpoint.state === "attention" ? (
                <span className="checkpoint-warning">!</span>
              ) : (
                <Icon name={checkpoint.icon} />
              )}
            </span>
            <span className="checkpoint-label">{checkpoint.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
