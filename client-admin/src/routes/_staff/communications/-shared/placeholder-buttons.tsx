import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PlusIcon } from 'lucide-react';

import { PLACEHOLDER_NAMES, type PlaceholderLabels } from './template-placeholders';

/** "Insert into message" buttons: each shows the placeholder as a word and hands `{word}` to the caller. */
export function PlaceholderButtons({
  labels,
  onInsert,
}: {
  labels: PlaceholderLabels;
  onInsert: (token: string) => void;
}) {
  const { t } = useTranslation('communications');
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label text-text-primary">{t('reminders.placeholdersLabel')}</span>
      <div
        role="group"
        aria-label={t('reminders.placeholdersLabel')}
        className="flex flex-wrap gap-2"
      >
        {PLACEHOLDER_NAMES.map((name) => (
          <Button
            key={name}
            type="button"
            variant="outline"
            className="h-11 md:h-8"
            onClick={() => onInsert(`{${labels[name]}}`)}
          >
            <PlusIcon aria-hidden />
            {labels[name]}
          </Button>
        ))}
      </div>
      <p className="text-caption text-text-secondary">{t('reminders.placeholderHelp')}</p>
    </div>
  );
}
