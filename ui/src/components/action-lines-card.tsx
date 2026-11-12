/**
 * [100.0.02] A short prioritised "what to do" list: each line has a tone
 * (icon + text, never colour alone) and one action. The caller sorts; the
 * component keeps the order. Every string is a prop.
 */
import { Link } from '@tanstack/react-router';
import { AlertCircleIcon, AlertTriangleIcon, InfoIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from './button';
import { Card } from './card';

export type ActionLineTone = 'danger' | 'warning' | 'neutral';

const TONES = {
  danger: { icon: AlertCircleIcon, className: 'bg-status-overdue-bg text-status-overdue-fg' },
  warning: { icon: AlertTriangleIcon, className: 'bg-status-due-bg text-status-due-fg' },
  neutral: { icon: InfoIcon, className: 'bg-status-partial-bg text-status-partial-fg' },
} as const;

export interface ActionLine {
  id: string;
  tone: ActionLineTone;
  text: string;
  action: { label: string; onClick?: () => void; href?: string };
}

export interface ActionLinesCardProps {
  title: string;
  lines: ActionLine[];
  emptyText: string;
  className?: string;
}

export function ActionLinesCard({ title, lines, emptyText, className }: ActionLinesCardProps) {
  const titleId = React.useId();
  return (
    <Card padded className={className} role="region" aria-labelledby={titleId}>
      <h2 id={titleId} className="text-base font-semibold text-text-primary">
        {title}
      </h2>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-text-secondary">{emptyText}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {lines.map(({ id, tone, text, action }) => {
            const { icon: Icon, className: toneClass } = TONES[tone];
            return (
              <li
                key={id}
                data-tone={tone}
                className={`flex flex-col gap-2 rounded-md p-3 text-sm sm:flex-row sm:items-center sm:justify-between ${toneClass}`}
              >
                <span className="flex min-w-0 items-start gap-2">
                  <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>{text}</span>
                </span>
                {action.href ? (
                  <Button asChild variant="outline" className="min-h-11 md:min-h-0">
                    <Link to={action.href}>{action.label}</Link>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="min-h-11 md:min-h-0"
                    onClick={action.onClick}
                  >
                    {action.label}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
