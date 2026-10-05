/**
 * [32.3.6] One of the seeded designs (D51). The thumbnail is the front artwork,
 * fetched through the authenticated client as a `data:` URL — a bare `<img src>`
 * to an authenticated route sends no bearer token and would 401.
 */
import { DocumentKind } from '@biddaloy/shared';
import { Skeleton } from '@biddaloy/ui/components';
import type { PrintSuggestion } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { useDataUrls } from '../preview/use-data-urls';

export interface SuggestionCardProps {
  suggestion: PrintSuggestion;
  selected: boolean;
  onSelect: (key: string) => void;
}

export function SuggestionCard({ suggestion, selected, onSelect }: SuggestionCardProps) {
  const { t } = useTranslation('printTemplates');
  const artworkUrl = `/print-templates/suggestions/${suggestion.key}/artwork/front`;
  const thumbnail = useDataUrls([artworkUrl])[artworkUrl];
  // An ACR page is not an ID card: style/orientation would read "Classic · portrait".
  const isAcr = suggestion.documentKind === DocumentKind.ACR_ASSESSMENT;
  const style = t(`style.${suggestion.style}`);
  const orientation = t(`orientation.${suggestion.orientation}`);
  const label = isAcr ? t('suggestion.acrLabel') : `${style} · ${orientation}`;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(suggestion.key)}
      className={`flex flex-col gap-2 rounded-lg border p-2 text-start ${
        selected ? 'border-primary bg-secondary' : 'border-border-subtle hover:bg-muted'
      }`}
    >
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={isAcr ? label : t('suggestion.alt', { style, orientation })}
          className="h-24 w-full rounded-md bg-muted object-contain"
        />
      ) : (
        <Skeleton role="status" aria-label={t('suggestion.loading')} className="h-24 w-full" />
      )}
      <span className="text-label font-medium">{label}</span>
      {isAcr && <span className="text-caption text-text-secondary">{t('suggestion.acrHelp')}</span>}
    </button>
  );
}
