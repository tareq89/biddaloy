/**
 * Step 2 of "Create next year": one tile per block, "new N · already there M · skipped K", with a
 * checkbox to leave the block out. Nothing is made until the clerk presses Create year.
 */
import { YEAR_ROLLOVER_BLOCKS, type YearRolloverBlock } from '@biddaloy/shared';
import { Card, Checkbox, ErrorState, Skeleton } from '@biddaloy/ui/components';
import type { YearRolloverResult } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

export interface PreviewStepProps {
  yearName: string;
  preview: YearRolloverResult | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  included: ReadonlySet<YearRolloverBlock>;
  onToggle: (block: YearRolloverBlock) => void;
}

export function PreviewStep({
  yearName,
  preview,
  isPending,
  isError,
  onRetry,
  included,
  onToggle,
}: PreviewStepProps) {
  const { t } = useTranslation('academicYears');
  const regionConfig = useTenantRegionConfig();
  const num = (n: number) => formatNumber(n, regionConfig);

  if (isError) {
    return (
      <ErrorState
        message={t('nextYear.previewError')}
        retryLabel={t('nextYear.retry')}
        onRetry={onRetry}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-text-secondary">{t('nextYear.previewIntro', { name: yearName })}</p>
      <p className="text-caption text-text-secondary">{t('help.yearRollover.rerun')}</p>
      <ul className="grid gap-3 md:grid-cols-2">
        {YEAR_ROLLOVER_BLOCKS.map((block) => {
          const result = preview?.[block];
          const id = `next-year-block-${block}`;
          return (
            <li key={block}>
              <Card padded className="flex items-start gap-3">
                <Checkbox
                  id={id}
                  checked={included.has(block)}
                  onCheckedChange={() => onToggle(block)}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <label htmlFor={id} className="font-medium">
                    {t(`nextYear.blocks.${block}`)}
                  </label>
                  {isPending || !result ? (
                    <Skeleton className="h-4 w-40" />
                  ) : (
                    <p className="text-label text-text-secondary tabular-nums">
                      {t('nextYear.tile', {
                        created: num(result.created),
                        existing: num(result.existing),
                        skipped: num(result.skipped.length),
                      })}
                    </p>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      {preview && preview.skipped_staff.length > 0 && (
        <Card padded className="flex flex-col gap-2">
          <h3 className="font-medium">{t('nextYear.skippedStaffTitle')}</h3>
          <ul className="list-disc ps-5 text-label">
            {preview.skipped_staff.map((s) => (
              <li key={`${s.teacher_name}|${s.section}|${s.subject}`}>
                {t('nextYear.skippedStaffRow', {
                  teacher: s.teacher_name,
                  section: s.section,
                  subject: s.subject,
                })}
              </li>
            ))}
          </ul>
          <p className="text-caption text-text-secondary">{t('help.yearRollover.skippedStaff')}</p>
        </Card>
      )}
      {included.size === 0 && (
        <p role="alert" className="text-label text-destructive">
          {t('nextYear.noBlockChosen')}
        </p>
      )}
    </div>
  );
}
