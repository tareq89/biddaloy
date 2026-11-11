/**
 * [99.W0] Sticky danger banner shown while someone is signed in as another
 * person. Every string is a prop (no `useTranslation`). Tone is icon + text,
 * never colour alone. The countdown shows whole minutes (H:MM) so it changes
 * once a minute; only the crossing of `warnBelowSeconds` is announced, through
 * a polite status region that is empty until then. At 0 it calls `onEnd` once.
 * `remainingSeconds` is controlled: the parent ticks it.
 */
import { AlertCircleIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../primitives/lib/utils';

import { Button } from './button';

export interface ImpersonationBannerProps {
  message: string;
  remainingSeconds: number;
  endLabel: string;
  onEnd: () => void;
  /** Default 300. */
  warnBelowSeconds?: number;
  /** Announced once when the time drops to `warnBelowSeconds`. */
  warningLabel: string;
  viewOnlyLabel?: string;
  className?: string;
}

function clock(seconds: number) {
  const mins = Math.ceil(Math.max(0, seconds) / 60);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

export function ImpersonationBanner({
  message,
  remainingSeconds,
  endLabel,
  onEnd,
  warnBelowSeconds = 300,
  warningLabel,
  viewOnlyLabel,
  className,
}: ImpersonationBannerProps) {
  const warning = remainingSeconds <= warnBelowSeconds;
  const ended = remainingSeconds <= 0;
  const endedRef = React.useRef(false);
  const onEndRef = React.useRef(onEnd);
  onEndRef.current = onEnd;
  React.useEffect(() => {
    if (ended && !endedRef.current) {
      endedRef.current = true;
      onEndRef.current();
    }
  }, [ended]);
  return (
    <div
      data-tone="danger"
      data-warning={warning || undefined}
      className={cn(
        'sticky top-0 z-50 flex w-full items-center gap-3 bg-status-overdue-bg px-4 py-2 text-sm text-status-overdue-fg print:hidden',
        className,
      )}
    >
      <AlertCircleIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate sm:whitespace-normal">
        {message}
        {viewOnlyLabel && <span className="ms-2 font-semibold">{viewOnlyLabel}</span>}
      </span>
      <span className={cn('shrink-0 tabular-nums', warning && 'font-bold')}>
        {clock(remainingSeconds)}
      </span>
      <span role="status" aria-live="polite" className="sr-only">
        {warning && warningLabel}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onEnd}
        className="min-h-11 shrink-0 sm:min-h-0"
      >
        {endLabel}
      </Button>
    </div>
  );
}
