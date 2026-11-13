import { ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  BookOpenIcon,
  CircleDashedIcon,
  GraduationCapIcon,
  LandmarkIcon,
  LanguagesIcon,
  type LucideIcon,
  MoonStarIcon,
  PresentationIcon,
  SchoolIcon,
  WrenchIcon,
} from 'lucide-react';

import type { InstitutionKind } from './use-institution-kinds';

/** Icon per kind id; a kind the client does not know yet still gets a card. */
const KIND_ICONS: Record<string, LucideIcon> = {
  primary: SchoolIcon,
  secondary: GraduationCapIcon,
  college: LandmarkIcon,
  'alia-madrasa': MoonStarIcon,
  'qawmi-madrasa': BookOpenIcon,
  'english-medium': LanguagesIcon,
  coaching: PresentationIcon,
  technical: WrenchIcon,
};

export interface KindCardsProps {
  kinds: readonly InstitutionKind[] | undefined;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  /** The kind whose preview is open. */
  selectedId?: string | undefined;
  onSelect: (id: string) => void;
  /** Replaces the Settings heading and intro (the welcome wizard words them differently). */
  title?: string;
  intro?: string;
}

/** D28: the eight institution-kind cards that open Settings › Modules & words. */
export function KindCards({
  kinds,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
  title,
  intro,
}: KindCardsProps) {
  const { t, i18n } = useTranslation('settings');
  const bn = i18n.language.startsWith('bn');

  return (
    <section aria-labelledby="modules-words-kinds-heading" className="space-y-3">
      <div>
        <h2 id="modules-words-kinds-heading" className="text-h2">
          {title ?? t('modulesWords.kinds.title')}
        </h2>
        <p className="mt-0.5 text-text-secondary">{intro ?? t('modulesWords.kinds.intro')}</p>
      </div>
      {error ? (
        <ErrorState message={t('modulesWords.kinds.loadError')} onRetry={onRetry} />
      ) : loading || !kinds ? (
        <ul
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          aria-busy="true"
          aria-label={t('modulesWords.kinds.loading')}
        >
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i}>
              <Skeleton className="h-20 w-full md:h-32" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kinds.map((kind) => {
            const Icon = KIND_ICONS[kind.id] ?? SchoolIcon;
            const name = bn ? kind.name.bn : kind.name.en;
            return (
              <li key={kind.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === kind.id}
                  onClick={() => onSelect(kind.id)}
                  className="flex min-h-11 w-full items-start gap-3 rounded-lg border border-border-subtle bg-surface p-3 text-left shadow-e1 hover:bg-muted aria-pressed:border-primary aria-pressed:bg-muted md:h-full md:flex-col md:p-4"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-text-secondary">
                    <Icon aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-text-primary">{name}</span>
                    <span className="block text-text-secondary">
                      {t(`modulesWords.kinds.lines.${kind.id}`, { defaultValue: '' })}
                    </span>
                    {!kind.verified && (
                      <span className="mt-1 inline-flex h-6 items-center gap-1 rounded-full bg-status-partial-bg px-2 text-label text-status-partial-fg">
                        <CircleDashedIcon className="size-3.5" aria-hidden="true" />
                        {t('modulesWords.kinds.unverified')}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
