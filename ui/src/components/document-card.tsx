/**
 * [48.1.04] D15/D16/D34 — a card with one action. Filled only when `primary`;
 * when `unavailable` the button is disabled and the reason + a real fix link
 * stay reachable (a disabled button is not focusable). `href` / `fixHref` are
 * app paths rendered as router `Link`s (no full page reload); the card needs a
 * router above it, like `RowActions` and `Breadcrumbs`.
 */
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { Button } from './button';

export interface DocumentCardProps {
  title: string;
  description: string;
  action: { label: string; onClick?: () => void; href?: string; primary?: boolean };
  unavailable?: { reason: string; fixLabel: string; fixHref: string };
  meta?: string;
  /** Pick the level that fits the page outline; looks the same at every level. */
  headingLevel?: 'h2' | 'h3' | 'h4';
}

export function DocumentCard({
  title,
  description,
  action,
  unavailable,
  meta,
  headingLevel: Heading = 'h3',
}: DocumentCardProps) {
  const id = React.useId();
  const titleId = `${id}-title`;
  const reasonId = `${id}-reason`;
  const variant = action.primary ? 'default' : 'outline';
  const cls = 'min-h-11 md:min-h-0';
  return (
    <section
      data-slot="document-card"
      aria-labelledby={titleId}
      className="flex flex-col rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
    >
      <Heading id={titleId} className="text-h2">
        {title}
      </Heading>
      <p className="mt-1 text-text-secondary">{description}</p>
      {meta ? <p className="mt-1 text-caption text-text-secondary">{meta}</p> : null}
      <div className="mt-4 flex flex-col items-start gap-2">
        {unavailable ? (
          <>
            <Button variant={variant} className={cls} disabled aria-describedby={reasonId}>
              {action.label}
            </Button>
            <p id={reasonId} className="text-caption text-text-secondary">
              {unavailable.reason} ·{' '}
              <Link
                to={unavailable.fixHref}
                className="font-medium text-primary underline underline-offset-2"
              >
                {unavailable.fixLabel}
              </Link>
            </p>
          </>
        ) : action.href ? (
          <Button asChild variant={variant} className={cls}>
            <Link to={action.href}>{action.label}</Link>
          </Button>
        ) : (
          <Button variant={variant} className={cls} onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </section>
  );
}
