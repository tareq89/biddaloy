import type { RestoreSummary } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { tabLabel } from '../../../pages/settings/restore-wizard';

/** [13.5.2] "This is what will be created": one count per sheet. */
export function StarterPreview({ tabs }: { tabs: RestoreSummary['tabs'] }) {
  const { t } = useTranslation('onboardingSetup');
  const { t: tb } = useTranslation('backup');
  const rows = tabs.filter((tab) => tab.creates > 0);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t('excel.preview')}</h3>
      <ul className="flex flex-col divide-y divide-border-subtle text-sm">
        {rows.map((tab) => (
          <li key={tab.name} className="flex justify-between gap-4 py-1">
            <span>{tabLabel(tb, tab.name)}</span>
            <span className="font-medium">{tab.creates}</span>
          </li>
        ))}
      </ul>
      <p className="text-caption text-text-secondary">{t('excel.createOnly')}</p>
    </div>
  );
}
