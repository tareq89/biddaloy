/** [35.4.3] Step 1: one card per preset. Cards stack on phone, two columns from `md`. */
import { Button, Card, StatusBadge } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Check, CircleCheck } from 'lucide-react';

import { usePickText, type PresetSummary } from './use-presets';

export interface PresetCardsProps {
  presets: PresetSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
}

export function PresetCards({ presets, selectedId, onSelect, onPreview }: PresetCardsProps) {
  const { t } = useTranslation('curriculumPreset');
  const pick = usePickText();

  return (
    <ul aria-label={t('cards.label')} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {presets.map((preset) => {
        const name = pick(preset.name);
        const selected = preset.id === selectedId;
        return (
          <li key={preset.id}>
            {/* Enter on the focused card opens the preview; the buttons inside
             * keep their own Enter/Space behaviour. */}
            <Card
              padded
              role="group"
              aria-label={name}
              tabIndex={0}
              data-testid={`preset-card-${preset.id}`}
              className={`flex h-full flex-col gap-2 focus-visible:outline-2 focus-visible:outline-ring ${selected ? 'border-primary ring-2 ring-primary' : ''}`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.target === event.currentTarget) {
                  // Stops the Enter keypress from also "clicking" whatever the opening
                  // dialog focuses first.
                  event.preventDefault();
                  onPreview(preset.id);
                }
              }}
            >
              <div className="flex items-center gap-2">
                {selected && <CircleCheck aria-hidden className="size-4 shrink-0 text-primary" />}
                <h2 className="text-h3">{name}</h2>
              </div>
              <p className="text-text-secondary">{pick(preset.board)}</p>
              <p>{pick(preset.description)}</p>
              <p className="text-caption text-text-secondary">
                {t('cards.stages', { names: preset.stages.map((s) => pick(s.name)).join(', ') })}
              </p>
              {preset.versions && (
                <p className="text-caption text-text-secondary">
                  {t('cards.withVersions', {
                    names: preset.versions.map((v) => pick(v.name)).join(', '),
                  })}
                </p>
              )}
              {!preset.verified && (
                <>
                  <StatusBadge tone="warning" label={t('unverifiedBadge')} />
                  <p className="text-caption text-status-due-fg">{t('unverified')}</p>
                </>
              )}
              <div className="mt-auto flex gap-2 pt-2">
                {/* Outline in both states: the wizard's Next is the one filled button. */}
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 md:h-8"
                  aria-pressed={selected}
                  onClick={() => onSelect(preset.id)}
                >
                  {selected && <Check aria-hidden />}
                  {selected ? t('cards.selected') : t('cards.select')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 md:h-8"
                  aria-label={`${t('cards.preview')}: ${name}`}
                  onClick={() => onPreview(preset.id)}
                >
                  {t('cards.preview')}
                </Button>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
