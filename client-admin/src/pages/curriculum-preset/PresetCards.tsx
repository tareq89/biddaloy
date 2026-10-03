/** [35.4.3] Step 1: one card per preset. Cards stack on phone, two columns from `sm`. */
import { Button, Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

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
    <ul aria-label={t('cards.label')} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {presets.map((preset) => {
        const name = pick(preset.name);
        const selected = preset.id === selectedId;
        return (
          <li key={preset.id}>
            {/* Enter on the focused card opens the preview; the buttons inside
             * keep their own Enter/Space behaviour. */}
            <Card
              role="group"
              aria-label={name}
              tabIndex={0}
              data-testid={`preset-card-${preset.id}`}
              className={`flex h-full flex-col gap-2 p-4 focus-visible:outline-2 focus-visible:outline-ring ${selected ? 'border-primary' : ''}`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.target === event.currentTarget) {
                  // Stops the Enter keypress from also "clicking" whatever the opening
                  // dialog focuses first.
                  event.preventDefault();
                  onPreview(preset.id);
                }
              }}
            >
              <h2 className="text-base font-semibold">{name}</h2>
              <p className="text-sm text-muted-foreground">{pick(preset.board)}</p>
              <p className="text-sm">{pick(preset.description)}</p>
              <p className="text-sm text-muted-foreground">
                {t('cards.stages', { names: preset.stages.map((s) => pick(s.name)).join(', ') })}
              </p>
              {preset.versions && (
                <p className="text-sm text-muted-foreground">
                  {t('cards.withVersions', {
                    names: preset.versions.map((v) => pick(v.name)).join(', '),
                  })}
                </p>
              )}
              {!preset.verified && (
                <p className="w-fit rounded-full bg-status-due-bg px-2 py-0.5 text-xs font-medium text-status-due-fg">
                  {t('unverified')}
                </p>
              )}
              <div className="mt-auto flex gap-2 pt-2">
                <Button
                  type="button"
                  variant={selected ? 'default' : 'outline'}
                  aria-pressed={selected}
                  onClick={() => onSelect(preset.id)}
                >
                  {selected ? t('cards.selected') : t('cards.select')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
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
