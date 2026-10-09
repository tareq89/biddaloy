/**
 * [23.9] Promotion/employment-history section — the designation-history
 * timeline (`GET /staff-hr-records/:userId/designation-history`, [23.2])
 * plus the "Promote" action that opens `-promote-staff-dialog.tsx`. The
 * open row (`end_date === null`) is the current designation and is
 * visually distinguished from history (acceptance criterion).
 */
import {
  Button,
  EmptyState,
  ErrorState,
  SkeletonFieldList,
  StatusBadge,
} from '@biddaloy/ui/components';
import { designationTitle, useDesignations, useStaffDesignationHistory } from '@biddaloy/ui/hooks';
import { useLocale, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { ArrowUpRightIcon } from 'lucide-react';
import * as React from 'react';

import { PromoteStaffDialog } from './-promote-staff-dialog';

export interface HrRecordPromotionSectionProps {
  userId: string;
}

export function HrRecordPromotionSection({ userId }: HrRecordPromotionSectionProps) {
  const { t } = useTranslation('staff');
  const { locale } = useLocale();
  const regionConfig = useRegionConfig();
  const historyQuery = useStaffDesignationHistory(userId);
  const designationsQuery = useDesignations();
  const [promoteOpen, setPromoteOpen] = React.useState(false);

  const designationLabel = (designationId: string) => {
    const designation = designationsQuery.data?.find((d) => d.id === designationId);
    return designation ? designationTitle(designation, locale) : designationId;
  };

  if (historyQuery.isPending) {
    return <SkeletonFieldList fields={3} />;
  }

  if (historyQuery.isError) {
    return (
      <ErrorState
        message={t('hrRecord.loadError')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => void historyQuery.refetch()}
      />
    );
  }

  const history = historyQuery.data;

  return (
    <div>
      {history.length === 0 ? (
        <EmptyState
          title={t('hrRecord.promotion.emptyTitle')}
          explanation={t('hrRecord.promotion.emptyExplanation')}
          action={{
            label: t('hrRecord.promotion.promoteAction'),
            onClick: () => setPromoteOpen(true),
          }}
        />
      ) : (
        <>
          <ol className="divide-y divide-border-subtle">
            {history.map((row) => {
              const current = row.end_date === null;
              return (
                <li
                  key={row.id}
                  aria-current={current ? 'true' : undefined}
                  className="flex flex-col items-start gap-1 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <span className="font-medium">{designationLabel(row.designation_id)}</span>
                    <p className="text-text-secondary">
                      {current
                        ? t('hrRecord.promotion.effectiveSince', {
                            date: formatDate(parseServerDate(row.effective_date), regionConfig),
                          })
                        : t('hrRecord.promotion.effectiveRange', {
                            from: formatDate(parseServerDate(row.effective_date), regionConfig),
                            to: formatDate(parseServerDate(row.end_date!), regionConfig),
                          })}
                    </p>
                  </div>
                  {current && (
                    <StatusBadge tone="success" label={t('hrRecord.promotion.current')} />
                  )}
                </li>
              );
            })}
          </ol>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="outline" onClick={() => setPromoteOpen(true)}>
              <ArrowUpRightIcon aria-hidden="true" />
              {t('hrRecord.promotion.promoteAction')}
            </Button>
          </div>
        </>
      )}

      <PromoteStaffDialog open={promoteOpen} onOpenChange={setPromoteOpen} userId={userId} />
    </div>
  );
}
