/**
 * [52.4.2] A letter on "paper": a stored one (detail / print) or the server-rendered
 * draft (D48). Text is split into paragraphs and rendered as text, never as HTML.
 */
import type { ApplicationStatus } from '@biddaloy/shared';
import { StatusBadge } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface LetterPreviewProps {
  text: string;
  /** Not saved yet: adds the "Draft" badge and its note. */
  draft?: boolean;
  decision?: { status: ApplicationStatus; by: string; at: string; note?: string };
}

export function LetterPreview({ text, draft = false, decision }: LetterPreviewProps) {
  const { t } = useTranslation('applicationForms');
  const { t: tApp } = useTranslation('applications');
  const regionConfig = useRegionConfig();
  const paragraphs = text.split(/(?:\r?\n){2,}/);

  return (
    <article
      id="application-letter-print-area"
      className="space-y-3 rounded-md border border-border-subtle bg-bg p-4 md:p-6"
    >
      {draft && (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral" label={t('preview.draftBadge')} />
          <span className="text-caption text-text-secondary">{t('preview.draftNote')}</span>
        </div>
      )}
      {paragraphs.map((paragraph, i) => (
        <p key={i} className="text-body">
          {paragraph.split(/\r?\n/).map((line, j) => (
            <React.Fragment key={j}>
              {j > 0 && <br />}
              {line}
            </React.Fragment>
          ))}
        </p>
      ))}
      {decision && (
        <div className="space-y-1 border-t border-border-subtle pt-3">
          <p className="text-label">
            {t('preview.decision', {
              status: tApp(`statuses.${decision.status}`),
              by: decision.by,
              date: formatDate(decision.at, regionConfig),
            })}
          </p>
          {decision.note && <p className="text-body text-text-secondary">{decision.note}</p>}
        </div>
      )}
    </article>
  );
}
