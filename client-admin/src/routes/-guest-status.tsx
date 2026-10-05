import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

const TONE = {
  info: 'bg-status-partial-bg text-status-partial-fg',
  success: 'bg-status-paid-bg text-status-paid-fg',
  warning: 'bg-status-due-bg text-status-due-fg',
  danger: 'bg-status-overdue-bg text-status-overdue-fg',
} as const;

/**
 * One status block for the guest pages (link problems, "email sent", fetch
 * failures) inside `AuthLayout` — no nested card. Buttons go in `children`.
 */
export function GuestStatus({
  icon: Icon,
  tone,
  title,
  explanation,
  headingLevel = 'h1',
  children,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE;
  title: string;
  explanation?: string;
  headingLevel?: 'h1' | 'h2';
  children?: React.ReactNode;
}) {
  const Heading = headingLevel;
  return (
    <div>
      <div
        role={tone === 'danger' ? 'alert' : 'status'}
        className="flex flex-col items-center gap-2 text-center"
      >
        <span
          aria-hidden="true"
          className={`flex size-12 items-center justify-center rounded-full ${TONE[tone]}`}
        >
          <Icon className="size-6" />
        </span>
        <Heading className="text-h2 text-balance">{title}</Heading>
        {explanation && <p className="text-text-secondary">{explanation}</p>}
      </div>
      {children && <div className="mt-5 flex flex-col gap-2">{children}</div>}
    </div>
  );
}
