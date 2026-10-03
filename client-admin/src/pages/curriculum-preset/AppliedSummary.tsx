/** [35.4.3] APPLIED state: the stored preset block, plus created counts when this session just applied. */
import type { PresetSettings } from '@biddaloy/shared';
import { Card } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface AppliedSummaryProps {
  preset: PresetSettings;
  created?: Record<string, number> | undefined;
}

export function AppliedSummary({ preset, created }: AppliedSummaryProps) {
  const { t } = useTranslation('curriculumPreset');
  return (
    <Card className="flex flex-col gap-2 p-4" data-testid="preset-applied">
      <h2 className="text-base font-semibold">{t('applied.title')}</h2>
      <p className="text-sm">{t('applied.preset', { id: preset.id, version: preset.version })}</p>
      <p className="text-sm text-muted-foreground">
        {t('applied.appliedAt', { date: new Date(preset.appliedAt).toLocaleDateString() })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('applied.appliedBy', { id: preset.appliedByUserId })}
      </p>
      {created && (
        <>
          <h3 className="pt-2 text-sm font-medium">{t('applied.createdHeading')}</h3>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {Object.entries(created).map(([key, count]) => (
              <React.Fragment key={key}>
                <dt>{t(`applied.created.${key}`, { defaultValue: key })}</dt>
                <dd className="tabular-nums">{count}</dd>
              </React.Fragment>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}
