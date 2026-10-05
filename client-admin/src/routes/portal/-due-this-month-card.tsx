import { Card } from '@biddaloy/ui/components';
import type { FeeDueEntry } from '@biddaloy/ui/hooks';
import { useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatServerAmount, isPastDueDate, parseServerDate } from '@biddaloy/ui/utils';

/**
 * [38.4.5] One child's "due this month" figures — rendered from the same
 * `FeeDueEntry[]` `portal/index.tsx` already fetches through `useFeeDues`,
 * never a second fetch.
 *
 * **This month** = `due_date` falls in `now`'s calendar month/year.
 * **Carried over** = `due_date` is before `now`'s month and the line is
 * still outstanding (`balance > 0`) — same "still outstanding" test
 * `portal/index.tsx`'s `summarize` uses, so a line paid off last month
 * never reappears here as a debt.
 *
 * Deliberately does **not** branch on `FeeStatus.OVERDUE` — nothing
 * server-side ever writes `OVERDUE` into a due line, so a component that
 * tested for it would silently never see it. "Carried over" is a date
 * test (`isPastDueDate`), not a status test.
 */
function splitDues(dues: FeeDueEntry[], now: Date) {
  const outstanding = dues.filter((due) => due.balance > 0);
  const thisMonth = outstanding.filter(
    (due) => due.due_date !== null && isInMonth(due.due_date, now),
  );
  const carriedOver = outstanding.filter(
    (due) =>
      due.due_date !== null && !isInMonth(due.due_date, now) && isPastDueDate(due.due_date, now),
  );
  const carriedOverTotal = carriedOver.reduce((sum, due) => sum + due.balance, 0);
  const total = thisMonth.reduce((sum, due) => sum + due.balance, 0) + carriedOverTotal;
  return {
    thisMonth,
    carriedOver,
    carriedOverTotal,
    total,
    empty: thisMonth.length === 0 && carriedOver.length === 0,
  };
}

interface DueProps {
  dues: FeeDueEntry[];
  now: Date;
  config: RegionConfig;
}

function DueBody({ dues, now, config }: DueProps) {
  const { t } = useTranslation('portal');
  const { thisMonth, carriedOver, carriedOverTotal, total } = splitDues(dues, now);
  return (
    <>
      <ul className="space-y-1">
        {thisMonth.map((due) => (
          <DueLine key={due.student_fee_id} due={due} config={config} t={t} />
        ))}
      </ul>
      {carriedOver.length > 0 && (
        <div className="space-y-1 border-t border-border-subtle pt-2">
          <p className="flex items-baseline justify-between gap-3 text-label text-status-overdue-fg">
            <span>{t('fees.carriedOver')}</span>
            <span className="tabular-nums">{formatServerAmount(carriedOverTotal, config)}</span>
          </p>
          <ul className="space-y-1">
            {carriedOver.map((due) => (
              <DueLine key={due.student_fee_id} due={due} config={config} t={t} />
            ))}
          </ul>
        </div>
      )}
      <p className="flex items-baseline justify-between gap-3 border-t border-border-subtle pt-2 font-semibold">
        <span>{t('fees.totalToPayThisMonth')}</span>
        <span className="tabular-nums">{formatServerAmount(total, config)}</span>
      </p>
    </>
  );
}

/** Section form, placed inside a child's own card. Renders nothing when
 * the child has no this-month and no carried-over line. */
export function DueThisMonthSection(props: DueProps) {
  const { t } = useTranslation('portal');
  if (splitDues(props.dues, props.now).empty) return null;
  return (
    <div className="space-y-2 border-t border-border-subtle pt-3">
      <h4 className="text-label text-text-secondary">{t('fees.dueThisMonth')}</h4>
      <DueBody {...props} />
    </div>
  );
}

/** Standalone card (single-student frame); keeps the "nothing due" line. */
export function DueThisMonthCard(props: DueProps) {
  const { t } = useTranslation('portal');
  return (
    <Card className="space-y-2 p-4 md:p-5">
      <h2 className="text-h2">{t('fees.dueThisMonth')}</h2>
      {splitDues(props.dues, props.now).empty ? (
        <p className="text-text-secondary">{t('fees.nothingDueThisMonth')}</p>
      ) : (
        <DueBody {...props} />
      )}
    </Card>
  );
}

function isInMonth(dueDate: string, now: Date): boolean {
  const date = parseServerDate(dueDate);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function DueLine({
  due,
  config,
  t,
}: {
  due: FeeDueEntry;
  config: RegionConfig;
  t: (key: string) => string;
}) {
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span>
          {due.fee_name}
          {due.is_fine && (
            <span className="ml-1.5 text-caption font-normal text-status-overdue-fg">
              {t('fees.fineBadge')}
            </span>
          )}
        </span>
        <span className="font-semibold tabular-nums">
          {formatServerAmount(due.balance, config)}
        </span>
      </div>
      {due.is_fine && due.note !== null && due.note !== '' && (
        <span className="text-caption text-text-secondary">{due.note}</span>
      )}
    </li>
  );
}
