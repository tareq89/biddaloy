import { Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';

import { usePresetStatus } from '../curriculum-preset/use-preset-status';

/** [35.5.2] Link to the Curriculum preset page; shows the current state. Mounted only with CURRICULUM_PRESET_APPLY (the status call is ADMIN-only). */
export function PresetLinkCard() {
  const { t } = useTranslation('curriculumPreset');
  const { data } = usePresetStatus();
  const state =
    data?.state === 'APPLIED' && data.preset
      ? t('settingsLink.applied', { id: data.preset.id, version: data.preset.version })
      : t('settingsLink.notApplied');
  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{t('settingsLink.title')}</h2>
        <p className="text-sm text-muted-foreground">{state}</p>
      </div>
      <Link
        to="/curriculum-preset"
        className="text-sm text-primary underline-offset-2 hover:underline"
      >
        {t('settingsLink.open')}
      </Link>
    </Card>
  );
}
