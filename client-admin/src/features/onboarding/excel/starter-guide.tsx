import { Button } from '@biddaloy/ui/components';
import { downloadWorkbookTemplate } from '@biddaloy/ui/hooks';
import { useLocale, useTranslation } from '@biddaloy/ui/i18n';
import { DownloadIcon } from 'lucide-react';
import * as React from 'react';

import { tabLabel } from '../../../pages/settings/restore-wizard';

/** The sheets of the starter file (server `STARTER_TABS`). */
export const STARTER_SHEETS = [
  'academic_years',
  'classes',
  'sections',
  'subjects',
  'fee_structures',
] as const;

/** [13.5.2] Sample file download + three plain steps + what goes in each sheet. */
export function StarterGuide() {
  const { t } = useTranslation('onboardingSetup');
  const { t: tb } = useTranslation('backup');
  const { locale } = useLocale();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      await downloadWorkbookTemplate(locale, { variant: 'starter' });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-1 pl-5">
        <li>{t('excel.step1')}</li>
        <li>{t('excel.step2')}</li>
        <li>{t('excel.step3')}</li>
      </ol>
      <div>
        <Button
          type="button"
          variant="outline"
          className="w-full md:w-auto"
          loading={busy}
          onClick={() => void download()}
        >
          <DownloadIcon aria-hidden="true" />
          {t('excel.download')}
        </Button>
        {failed && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {tb('downloadTemplateFailed')}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{t('excel.sheetsTitle')}</h3>
        <ul className="list-disc pl-5 text-sm text-text-secondary">
          {STARTER_SHEETS.map((sheet) => (
            <li key={sheet}>{t(`excel.sheet.${sheet}`, { defaultValue: tabLabel(tb, sheet) })}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
