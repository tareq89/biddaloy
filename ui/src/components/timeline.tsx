/** Vertical event list, caller-ordered. Lifted from the student lifecycle timeline. */
import type { ReactNode } from 'react';

import { useRegionConfig } from '../i18n';
import { formatDateTime, parseServerDate } from '../utils';

import { StatusBadge, type StatusTone } from './status-badge';

export interface TimelineItem {
  id: string;
  title: ReactNode;
  /** ISO timestamp. */
  time: string;
  tone?: StatusTone;
  badge?: string;
  body?: ReactNode;
}

export interface TimelineProps {
  items: TimelineItem[];
  'aria-label': string;
  emptyText?: string;
}

export function Timeline({ items, emptyText, ...props }: TimelineProps) {
  const regionConfig = useRegionConfig();
  if (items.length === 0) return <p className="text-text-secondary">{emptyText}</p>;
  return (
    <ol aria-label={props['aria-label']} className="divide-y divide-border-subtle">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-1 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {item.badge && <StatusBadge tone={item.tone ?? 'neutral'} label={item.badge} />}
            <span className="font-medium">{item.title}</span>
          </div>
          <time className="text-text-secondary" dateTime={item.time}>
            {formatDateTime(parseServerDate(item.time), regionConfig)}
          </time>
          {item.body && <div>{item.body}</div>}
        </li>
      ))}
    </ol>
  );
}
