/**
 * [2598] A detail page whose API answered 404: the record was removed or the link is wrong.
 * Same card as `ErrorState` but with no retry (retrying a 404 never succeeds) and a way back.
 * Default copy comes from the `common` keys `recordNotFound.*`.
 */
import { FileSearchIcon } from 'lucide-react';

import { useTranslation } from '../i18n';

import { Button } from './button';

export interface RecordNotFoundStateProps {
  title?: string;
  message?: string;
  onBack: () => void;
  backLabel?: string;
}

export function RecordNotFoundState({
  title,
  message,
  onBack,
  backLabel,
}: RecordNotFoundStateProps) {
  const { t } = useTranslation('common');
  return (
    <div
      role="status"
      data-slot="record-not-found-state"
      className="flex flex-col items-center gap-2 rounded-lg border border-border-subtle bg-surface px-4 py-10 text-center shadow-e1"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-text-secondary [&_svg]:size-6">
        <FileSearchIcon aria-hidden="true" />
      </div>
      <h2 className="text-h3">{title ?? t('recordNotFound.title')}</h2>
      <p className="max-w-prose text-text-secondary">{message ?? t('recordNotFound.message')}</p>
      <div className="mt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          {backLabel ?? t('recordNotFound.back')}
        </Button>
      </div>
    </div>
  );
}
