import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';

import { usePresetStatus } from '../curriculum-preset/use-preset-status';
import { usePickText, usePresetList } from '../curriculum-preset/use-presets';

/** [35.5.2] Link to the Curriculum preset page; shows the current state. Mounted only with CURRICULUM_PRESET_APPLY (the status call is ADMIN-only). */
export function PresetLinkCard() {
  const { t } = useTranslation('curriculumPreset');
  const { data } = usePresetStatus();
  const { data: presets, isPending: presetsPending } = usePresetList();
  const pick = usePickText();
  const applied = data?.state === 'APPLIED' ? data.preset : undefined;
  // D9: the preset's name, never its id.
  const found = applied ? presets?.find((p) => p.id === applied.id) : undefined;
  // Until the list loads, show nothing for the state line.
  const listLoading = applied !== undefined && presetsPending;
  const state = listLoading
    ? ''
    : applied
      ? found
        ? // `id` and `name` both passed: the wording lives in a shared file that drops `{{id}}` separately.
          t('settingsLink.applied', {
            id: pick(found.name),
            name: pick(found.name),
            version: applied.version,
          })
        : // The list failed to load or doesn't have this preset: no name to show.
          t('settingsLink.appliedUnnamed', { version: applied.version })
      : t('settingsLink.notApplied');
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:flex-row md:items-center md:justify-between md:p-5">
      <div className="min-w-0">
        <h2 className="text-h2">{t('settingsLink.title')}</h2>
        <p className="mt-0.5 text-text-secondary">{state}</p>
      </div>
      <Button asChild variant="outline" className="w-full md:w-auto">
        <Link to="/curriculum-preset">
          {t('settingsLink.open')}
          <ArrowRightIcon aria-hidden="true" className="size-4" />
        </Link>
      </Button>
    </section>
  );
}
