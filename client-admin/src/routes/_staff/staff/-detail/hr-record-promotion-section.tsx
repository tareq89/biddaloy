/**
 * [23.9] Promotion/employment-history section — the designation-history
 * timeline (`GET /staff-hr-records/:userId/designation-history`, [23.2])
 * plus the "Promote" action that opens `-promote-staff-dialog.tsx`. The
 * open row (`end_date === null`) is the current designation and is
 * visually distinguished from history (acceptance criterion).
 */
import { Button, EmptyState, SkeletonFieldList } from '@biddaloy/ui/components';
import { useDesignations, useStaffDesignationHistory } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import { PromoteStaffDialog } from './-promote-staff-dialog';

export interface HrRecordPromotionSectionProps {
  userId: string;
}

export function HrRecordPromotionSection({ userId }: HrRecordPromotionSectionProps) {
  const { t } = useTranslation('staff');
  const regionConfig = useRegionConfig();
  const historyQuery = useStaffDesignationHistory(userId);
  const designationsQuery = useDesignations();
  const [promoteOpen, setPromoteOpen] = React.useState(false);

  const designationTitle = (designationId: string) =>
    designationsQuery.data?.find((designation) => designation.id === designationId)?.title_en ??
    designationId;

  if (historyQuery.isPending) {
    return <SkeletonFieldList fields={3} />;
  }

  const history = historyQuery.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Button type="button" className="self-start" onClick={() => setPromoteOpen(true)}>
        {t('hrRecord.promotion.promoteAction')}
      </Button>

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
        <ol className="flex flex-col gap-2">
          {history.map((row) => {
            const current = row.end_date === null;
            return (
              <li
                key={row.id}
                aria-current={current ? 'true' : undefined}
                className={
                  current
                    ? 'rounded-lg border border-primary bg-primary/5 p-3'
                    : 'rounded-lg border border-border-subtle p-3'
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{designationTitle(row.designation_id)}</span>
                  {current && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                      {t('hrRecord.promotion.current')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {current
                    ? t('hrRecord.promotion.effectiveSince', {
                        date: formatDate(new Date(row.effective_date), regionConfig),
                      })
                    : t('hrRecord.promotion.effectiveRange', {
                        from: formatDate(new Date(row.effective_date), regionConfig),
                        to: formatDate(new Date(row.end_date!), regionConfig),
                      })}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      <PromoteStaffDialog open={promoteOpen} onOpenChange={setPromoteOpen} userId={userId} />
    </div>
  );
}
