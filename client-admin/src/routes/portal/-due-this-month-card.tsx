import { Card } from '@biddaloy/ui/components';
import type { FeeDueEntry } from '@biddaloy/ui/hooks';
import { useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatServerAmount, isPastDueDate, parseServerDate } from '@biddaloy/ui/utils';

/**
 * [38.4.5] One child's "due this month" card — rendered from the same
 * `FeeDueEntry[]` `portal/index.tsx` already fetches through `useFeeDues`,
 * never a second fetch.
 *
 * **This month** = `due_date` falls in `now`'s calendar month/year.
 * **Carried over** = `due_date` is before `now`'s month and the line is
 * still outstanding (`balance > 0`) — same "still outstanding" test
 * `portal/index.tsx`'s `summarize` uses, so a line paid off last month
 * never reappears here as a debt.
 *
 * Deliberately does **not** branch on `FeeStatus.OVERDUE` — see the
 * comment at `portal/index.tsx:146` this ticket points at: nothing
 * server-side ever writes `OVERDUE` into a due line, so a component that
 * tested for it would silently never see it. "Carried over" is a date
 * test (`isPastDueDate`), not a status test.
 */
export function DueThisMonthCard({
  dues,
  now,
  config,
}: {
  dues: FeeDueEntry[];
  now: Date;
  config: RegionConfig;
}) {
  const { t } = useTranslation('portal');

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

  return (
    <Card className="flex flex-col gap-2 p-3.5">
      {/* `<h2>` to match this page's other section headings — see
          `portal/index.tsx`'s header comment ("Section titles are
          `<h2>`") — not `<h3>`, which would jump a level and fail
          `heading-order` under whichever `<h1>` this card ends up nested
          beneath (`SingleStudentView`'s child name, or nothing in
          `MultiChildView`, which has no further heading below it). */}
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {t('fees.dueThisMonth')}
      </h2>
      {thisMonth.length === 0 && carriedOver.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('fees.nothingDueThisMonth')}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {thisMonth.map((due) => (
              <DueLine key={due.student_fee_id} due={due} config={config} t={t} />
            ))}
          </ul>
          {carriedOver.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border-subtle pt-1.5">
              <div className="flex items-baseline justify-between gap-2 text-xs font-semibold text-status-overdue-fg">
                <span>{t('fees.carriedOver')}</span>
                <span className="tabular-nums">{formatServerAmount(carriedOverTotal, config)}</span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {carriedOver.map((due) => (
                  <DueLine key={due.student_fee_id} due={due} config={config} t={t} />
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-2 border-t border-border-subtle pt-1.5 text-sm font-bold">
            <span>{t('fees.totalToPayThisMonth')}</span>
            <span className="tabular-nums">{formatServerAmount(total, config)}</span>
          </div>
        </>
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm">
          {due.fee_name}
          {due.is_fine && (
            <span className="ml-1.5 text-[11px] font-normal text-status-overdue-fg">
              {t('fees.fineBadge')}
            </span>
          )}
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {formatServerAmount(due.balance, config)}
        </span>
      </div>
      {due.is_fine && due.note !== null && due.note !== '' && (
        <span className="text-[11px] text-muted-foreground">{due.note}</span>
      )}
    </li>
  );
}
