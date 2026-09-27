/**
 * [34.4.1] Milestone progress — `done / total` as a labeled bar. Hidden
 * entirely by the caller when `total === 0` (D6/D12: a program with no
 * milestones has no progress to show); this component itself just draws
 * whatever it's given. i18n is prop-driven, same convention as every
 * other `@biddaloy/ui` component — it never calls `useTranslation` itself.
 */
export interface ProgressBarProps {
  done: number;
  total: number;
  /** Already translated, e.g. "3 / 5". */
  label: string;
}

export function ProgressBar({ done, total, label }: ProgressBarProps) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex min-w-24 flex-col gap-1">
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
