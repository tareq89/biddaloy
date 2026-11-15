/**
 * [71.4.01] "What to do next" on an admission screen: a title, one sentence, ONE primary button
 * and an optional quieter link. When `done` the card says so (icon + text, never colour alone)
 * and drops the button. Every string is a prop.
 */
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, CircleCheckIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from './button';
import { Card } from './card';

export interface NextActionLink {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface NextActionCardProps {
  title: string;
  description: string;
  action: NextActionLink;
  secondary?: NextActionLink;
  done?: boolean;
  /** Spoken/visible tag when `done`, e.g. "Done". */
  doneLabel?: string;
  className?: string;
}

function Act({ link, variant }: { link: NextActionLink; variant: 'default' | 'link' }) {
  const cls = 'min-h-11 md:min-h-0';
  return link.href ? (
    <Button asChild variant={variant} className={cls}>
      <Link to={link.href}>{link.label}</Link>
    </Button>
  ) : (
    <Button variant={variant} className={cls} onClick={link.onClick}>
      {link.label}
    </Button>
  );
}

export function NextActionCard({
  title,
  description,
  action,
  secondary,
  done = false,
  doneLabel,
  className,
}: NextActionCardProps) {
  const titleId = React.useId();
  return (
    <Card padded className={className} role="region" aria-labelledby={titleId} data-done={done}>
      <div className="flex items-start gap-3">
        {done ? (
          <CircleCheckIcon
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-status-paid-fg"
          />
        ) : (
          <ArrowRightIcon
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-text-secondary"
          />
        )}
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-text-primary">
            {title}
            {done && doneLabel ? <span className="sr-only"> — {doneLabel}</span> : null}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">{description}</p>
        </div>
      </div>
      {done ? null : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Act link={action} variant="default" />
          {secondary ? <Act link={secondary} variant="link" /> : null}
        </div>
      )}
    </Card>
  );
}
