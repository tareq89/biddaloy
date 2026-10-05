import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import {
  PLACEHOLDER_NAMES,
  usePlaceholderLabels,
  type PlaceholderName,
} from './template-placeholders';

/** A sent template with each supported `{{token}}` shown as a chip with its plain label (D9); the school's own text stays as written. */
export function TemplatePreview({ template }: { template: string }) {
  const { t } = useTranslation('communications');
  const labels = usePlaceholderLabels();
  return (
    <>
      <p className="mt-3 leading-loose whitespace-pre-wrap">
        {template.split(/(\{\{[^{}]*\}\})/).map((part, index) => {
          const name = /^\{\{([^{}]*)\}\}$/.exec(part)?.[1]?.trim();
          if (name !== undefined && (PLACEHOLDER_NAMES as readonly string[]).includes(name)) {
            return (
              <span
                // The split alternates text / token, so the index is stable per template.
                key={index}
                className="rounded-sm bg-secondary px-1.5 py-0.5 text-label text-secondary-foreground"
              >
                {labels[name as PlaceholderName]}
              </span>
            );
          }
          return <React.Fragment key={index}>{part}</React.Fragment>;
        })}
      </p>
      <p className="mt-2 text-caption text-text-secondary">{t('batches.detail.templateHelp')}</p>
    </>
  );
}
