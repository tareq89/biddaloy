/**
 * [48.3.D-01] The Printables page's tab row. The URL's `tab` drives it (no local state), so a palette
 * link or a reload lands on the right tab. "To print" needs `DOCUMENT_PRINT`, the queue's own gate.
 */
import { Permission } from '@biddaloy/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@biddaloy/ui/components';
import { useHasPermission, usePrintQueue } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

import type { PrintHistorySearch } from './print-history-filters';

export type PrintablesTab = NonNullable<PrintHistorySearch['tab']>;

/** A tab the person may not open (or a missing one) falls back to the history. */
export function useActiveTab(tab: PrintHistorySearch['tab']): PrintablesTab {
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  return tab === 'to-print' && !canPrint ? 'history' : (tab ?? 'history');
}

function WaitingCount() {
  const { data } = usePrintQueue();
  const region = useRegionConfig();
  if (!data || data.total === 0) return null;
  return (
    <span className="bg-primary-subtle ms-2 rounded-full px-2 text-caption">
      {formatNumber(data.total, region)}
    </span>
  );
}

export function PrintablesTabs({
  value,
  onChange,
}: {
  value: PrintablesTab;
  onChange: (tab: PrintablesTab) => void;
}) {
  const { t } = useTranslation('printHistory');
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as PrintablesTab)}>
      <TabsList variant="line" aria-label={t('title')}>
        <TabsTrigger value="history">{t('tabs.history')}</TabsTrigger>
        <TabsTrigger value="register">{t('tabs.register')}</TabsTrigger>
        {canPrint ? (
          <TabsTrigger value="to-print">
            {t('tabs.toPrint')}
            <WaitingCount />
          </TabsTrigger>
        ) : null}
      </TabsList>
      {/* The page body sits outside the tab row; this empty panel is what the tab's aria-controls points at. */}
      <TabsContent value={value} className="hidden" />
    </Tabs>
  );
}
