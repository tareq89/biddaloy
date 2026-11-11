/**
 * Step 3 of "Create next year": what was made, and the other setups worth copying next.
 *
 * Fine rules copy in place (`CopyRulesDialog` already takes the target year). The class routine,
 * calendar and recurring fee schedules cannot open in place: the calendar copy hands its preview
 * to the import page, and the routine and schedule copies belong to one routine / one schedule,
 * so each button opens the page that owns that copy.
 */
import { YEAR_ROLLOVER_BLOCKS } from '@biddaloy/shared';
import { Button, Card } from '@biddaloy/ui/components';
import type { YearRolloverResult } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { CopyRulesDialog } from '../../fees/fines/-rules/copy-rules-dialog';

export function DoneStep({
  yearName,
  newYearId,
  result,
}: {
  yearName: string;
  newYearId: string;
  result: YearRolloverResult;
}) {
  const { t } = useTranslation('academicYears');
  const regionConfig = useTenantRegionConfig();
  const [rulesOpen, setRulesOpen] = React.useState(false);

  const totals = YEAR_ROLLOVER_BLOCKS.reduce(
    (sum, block) => {
      const r = result[block];
      return {
        created: sum.created + (r?.created ?? 0),
        existing: sum.existing + (r?.existing ?? 0),
        skipped: sum.skipped + (r?.skipped.length ?? 0),
      };
    },
    { created: 0, existing: 0, skipped: 0 },
  );
  const num = (n: number) => formatNumber(n, regionConfig);

  return (
    <div className="flex flex-col gap-6">
      <Card padded className="flex flex-col gap-1">
        <h2 className="text-h3">{t('nextYear.done.title', { name: yearName })}</h2>
        <p className="text-text-secondary tabular-nums">
          {t('nextYear.done.counts', {
            created: num(totals.created),
            existing: num(totals.existing),
            skipped: num(totals.skipped),
          })}
        </p>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="next-year-also-copy">
        <h3 id="next-year-also-copy" className="font-medium">
          {t('nextYear.done.alsoCopy', { name: yearName })}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/routines/review">{t('nextYear.done.routines')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/calendar" search={{ panel: 'clone' } as never}>
              {t('nextYear.done.calendar')}
            </Link>
          </Button>
          <Button type="button" variant="outline" onClick={() => setRulesOpen(true)}>
            {t('nextYear.done.fineRules')}
          </Button>
          <Button asChild variant="outline">
            <Link to="/fees/schedules">{t('nextYear.done.schedules')}</Link>
          </Button>
        </div>
      </section>

      <p>
        <Link
          to="/academic-years/$academicYearId"
          params={{ academicYearId: newYearId }}
          search={{ tab: 'feeStructures' } as never}
          className="font-medium text-primary underline underline-offset-2"
        >
          {t('nextYear.done.feeStructuresLink')}
        </Link>
      </p>

      <CopyRulesDialog
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        toAcademicYearId={newYearId}
        onCopied={() => setRulesOpen(false)}
      />
    </div>
  );
}
