/** [35.4.3] APPLIED state: the stored preset block, plus created counts when this session just applied. */
import type { PresetSettings } from '@biddaloy/shared';
import { Card } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface AppliedSummaryProps {
  preset: PresetSettings;
  /** The curriculum's name, when the list has loaded and still carries it. */
  presetName?: string | undefined;
  created?: Record<string, number> | undefined;
}

export function AppliedSummary({ preset, presetName, created }: AppliedSummaryProps) {
  const { t } = useTranslation('curriculumPreset');
  const config = useRegionConfig();
  // No "applied by" line: the server sends only a user id, and an id is never shown (D9).
  return (
    <Card padded className="flex flex-col gap-2" data-testid="preset-applied">
      <h2 className="text-h2">{t('applied.title')}</h2>
      <p>
        {presetName
          ? t('applied.preset', { name: presetName, version: preset.version })
          : t('applied.versionOnly', { version: preset.version })}
      </p>
      <p className="text-text-secondary">
        {t('applied.appliedAt', { date: formatDate(preset.appliedAt, config) })}
      </p>
      {created && (
        <>
          <h3 className="pt-2 text-h3">{t('applied.createdHeading')}</h3>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
            {Object.entries(created).map(([key, count]) => (
              <React.Fragment key={key}>
                <dt>{t(`applied.created.${key}`, { defaultValue: key })}</dt>
                <dd className="text-end tabular-nums">{formatNumber(count, config)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}
