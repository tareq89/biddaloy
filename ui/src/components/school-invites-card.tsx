/**
 * [68.2.23] Pending "join this school" requests, one row each, with Accept and
 * Decline. Presentational: the caller owns the data and the two handlers.
 * Renders nothing for an empty list. Decline is reversible (the school can
 * invite again), so it is an outline button, never red.
 */
import * as React from 'react';

import type { SchoolInvite } from '../hooks/school-invites';
import { useRegionConfig, useTranslation } from '../i18n';
import { formatDate } from '../utils';

import { Button } from './button';

export interface SchoolInvitesCardProps {
  invites: SchoolInvite[];
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  /** Disables every button while a request is in flight. */
  busy?: boolean;
  error?: string;
}

export function SchoolInvitesCard({
  invites,
  onAccept,
  onDecline,
  busy = false,
  error,
}: SchoolInvitesCardProps) {
  // `nav` first: `check-i18n-keys.mjs` resolves bare `t()` off the first call.
  const { t } = useTranslation('nav');
  const { t: tAuth } = useTranslation('auth');
  const config = useRegionConfig();
  const titleId = React.useId();
  if (invites.length === 0) return null;

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-5"
    >
      <h2 id={titleId} className="text-h3">
        {t('schoolInvites.title')}
      </h2>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {invites.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="font-semibold">{invite.school_name}</span>
              <span className="text-caption text-text-secondary">
                {tAuth(`schoolPicker.roles.${invite.role}`)}
                {' · '}
                {t('schoolInvites.expires', { date: formatDate(invite.expires_at, config) })}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => onDecline(invite.id)}>
                {t('schoolInvites.decline')}
              </Button>
              <Button disabled={busy} onClick={() => onAccept(invite.id)}>
                {t('schoolInvites.accept')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
