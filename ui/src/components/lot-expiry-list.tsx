/**
 * [100.0.02] One row per purchase: remaining count and expiry. The caller
 * passes rows soonest first; rows with `expiryLabel: null` are moved last.
 * The component never reads a clock: `soon` comes from the caller.
 */
import { AlertTriangleIcon } from 'lucide-react';

import { cn } from '../primitives/lib/utils';

export interface LotExpiryRow {
  id: string;
  remainingLabel: string;
  expiryLabel: string | null;
  soon?: boolean;
}

export interface LotExpiryListProps {
  rows: LotExpiryRow[];
  noExpiryLabel: string;
  soonLabel: string;
  emptyText: string;
  className?: string;
}

export function LotExpiryList({
  rows,
  noExpiryLabel,
  soonLabel,
  emptyText,
  className,
}: LotExpiryListProps) {
  if (rows.length === 0)
    return <p className={cn('text-sm text-text-secondary', className)}>{emptyText}</p>;
  // Stable sort: only moves the no-expiry rows to the end.
  const ordered = [...rows].sort(
    (a, b) => Number(a.expiryLabel === null) - Number(b.expiryLabel === null),
  );
  return (
    <ul className={className}>
      {ordered.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle py-2 text-sm last:border-b-0"
        >
          <span className="font-medium text-text-primary">{row.remainingLabel}</span>
          <span className="flex items-center gap-2 text-text-secondary">
            {row.soon ? (
              <span className="flex items-center gap-1 text-status-due-fg">
                <AlertTriangleIcon aria-hidden="true" className="size-4" />
                {soonLabel}
              </span>
            ) : null}
            {row.expiryLabel ?? noExpiryLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}
