/**
 * [13.4.3] A thin full-width bar for the top of the shell (trial ending,
 * and later the billing renewal warning). Tone is carried by an icon *and*
 * the text, never colour alone; colours are the status tokens.
 *
 * On phone it is one truncated line. When `onOpenDetails` is given, the
 * icon + text are a button that calls it (the full text lives in the
 * details view). ponytail: the button exists at every width rather than
 * phone-only — a tap target that also works on desktop costs nothing.
 */
import { AlertCircleIcon, AlertTriangleIcon, InfoIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { Button } from './button';

export type NoticeBarTone = 'info' | 'warning' | 'danger';

const TONES = {
  info: { icon: InfoIcon, className: 'bg-status-partial-bg text-status-partial-fg' },
  warning: { icon: AlertTriangleIcon, className: 'bg-status-due-bg text-status-due-fg' },
  danger: { icon: AlertCircleIcon, className: 'bg-status-overdue-bg text-status-overdue-fg' },
} as const;

export interface NoticeBarProps {
  tone: NoticeBarTone;
  children: React.ReactNode;
  /** Optional call to action, e.g. a "Choose a plan" link. Hidden on phone. */
  action?: React.ReactNode;
  onOpenDetails?: () => void;
  className?: string;
}

export function NoticeBar({ tone, children, action, onOpenDetails, className }: NoticeBarProps) {
  const { icon: Icon, className: toneClass } = TONES[tone];
  const body = (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate sm:whitespace-normal">{children}</span>
    </>
  );
  return (
    <div
      role="status"
      data-tone={tone}
      className={cn(
        'flex w-full items-center gap-3 px-4 text-sm',
        // With a details button the button carries the padding, so the whole
        // bar height is the tap target (44 px on phone).
        !onOpenDetails && 'py-2',
        toneClass,
        className,
      )}
    >
      {onOpenDetails ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenDetails}
          className="h-auto min-h-11 min-w-0 flex-1 justify-start px-0 py-2 text-inherit hover:bg-transparent sm:min-h-0"
        >
          {body}
        </Button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2">{body}</span>
      )}
      {action && <span className="hidden shrink-0 sm:block">{action}</span>}
    </div>
  );
}
