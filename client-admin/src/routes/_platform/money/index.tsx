import type { ActionLineDto } from '@biddaloy/shared';
import { downloadMoneyCsv, usePlatformSmsReport } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { SmsStateView } from '../../../features/cockpit/money/sms-state/sms-state-view';
import { StockSlot } from '../../../features/cockpit/money/stock/stock-slot';

/** [100.5.gI-04] SMS state, the default Money tab. `?record=1` opens the record dialog (#3885). */
export const Route = createFileRoute('/_platform/money/')({
  validateSearch: z.object({
    record: z
      .union([z.literal(1), z.literal('1')])
      .optional()
      .catch(undefined),
  }),
  component: SmsStatePage,
});

function SmsStatePage() {
  const { t } = useTranslation('money');
  const navigate = useNavigate();
  // The report pages its school rows by an opaque cursor; keep the visited ones for "next".
  const [after, setAfter] = React.useState<string | undefined>(undefined);
  const [csvError, setCsvError] = React.useState(false);
  const query = usePlatformSmsReport(after);

  function onAction(line: ActionLineDto) {
    if (line.target.kind === 'school') {
      void navigate({ to: '/subscriptions' });
    } else if (line.target.tab === 'stock') {
      void navigate({ to: '/money', search: { record: 1 } });
    } else if (line.target.tab === 'packages') {
      void navigate({ to: '/money/packages' as never });
    } else {
      document.getElementById('sms-schools-title')?.scrollIntoView?.({ block: 'start' });
    }
  }

  async function onCsv() {
    setCsvError(false);
    try {
      await downloadMoneyCsv('/platform/money/sms?format=csv', {}, 'sms-state.csv');
    } catch {
      setCsvError(true);
    }
  }

  return (
    <SmsStateView
      report={query.data}
      loading={query.isLoading}
      error={query.isError ? t('sms.loadError') : undefined}
      onRetry={() => void query.refetch()}
      onAction={onAction}
      onOpenSchool={() => void navigate({ to: '/subscriptions' })}
      onCsv={() => void onCsv()}
      csvError={csvError ? t('sms.csvError') : undefined}
      onNext={() => setAfter(query.data?.nextCursor ?? undefined)}
      stockSlot={<StockSlot />}
    />
  );
}
