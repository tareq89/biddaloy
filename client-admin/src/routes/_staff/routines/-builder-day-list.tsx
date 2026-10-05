/**
 * [31.4] Phone view of the section's week (below `md`, where the wide
 * `RoutineGrid` is hidden): working-day tabs, one day's periods as tappable
 * rows. A row opens the same `CellPicker` the grid does, via
 * `onActivateCell`. Clearing a cell stays desktop-only (Delete key).
 */
import type { RoutineGridCell, RoutineGridPeriodRow } from '@biddaloy/ui/components';
import { Card, Tabs, TabsContent, TabsList, TabsTrigger } from '@biddaloy/ui/components';
import { routineCellKey } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatTime } from '@biddaloy/ui/utils';
import { ChevronRightIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react';
import * as React from 'react';

export interface BuilderDayListProps {
  weekdays: number[];
  weekdayLabels: Record<number, string>;
  periods: RoutineGridPeriodRow[];
  cells: Record<string, RoutineGridCell>;
  onActivateCell: (weekday: number, periodSlotId: string) => void;
}

export function BuilderDayList({
  weekdays,
  weekdayLabels,
  periods,
  cells,
  onActivateCell,
}: BuilderDayListProps) {
  const { t } = useTranslation('routines');
  const { t: tCommon } = useTranslation('common');
  const config = useRegionConfig();
  const today = new Date().getDay();
  const [day, setDay] = React.useState<number | undefined>(undefined);
  const selected = day ?? (weekdays.includes(today) ? today : weekdays[0]);
  if (selected === undefined) return null;

  return (
    <Tabs value={String(selected)} onValueChange={(value) => setDay(Number(value))}>
      <TabsList variant="line" aria-label={t('agenda.daySwitcherLabel')}>
        {weekdays.map((weekday) => (
          <TabsTrigger key={weekday} value={String(weekday)} className="min-h-11">
            {weekdayLabels[weekday]}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={String(selected)}>
        <Card padded={false} className="overflow-hidden">
          <ul className="divide-y divide-border-subtle">
            {periods.map((period) => {
              const time = `${formatTime(period.starts_at, config)} – ${formatTime(period.ends_at, config)}`;
              if (period.kind === 'BREAK') {
                return (
                  <li
                    key={period.id}
                    className="bg-muted px-4 py-2 text-center text-caption text-text-secondary"
                  >
                    {period.name ?? t('grid.breakUnnamed')} · {time}
                  </li>
                );
              }
              const cell = cells[routineCellKey(selected, period.id)];
              const periodLabel = t('agenda.periodLabel', { sequence: period.sequence });
              const label = cell
                ? tCommon('routine.cellLabel', {
                    weekday: weekdayLabels[selected],
                    period: periodLabel,
                    subject: cell.subjectLabel,
                    teachers: cell.teacherLabels.join(', '),
                  })
                : tCommon('routine.cellLabelEmpty', {
                    weekday: weekdayLabels[selected],
                    period: periodLabel,
                  });
              const tone = !cell
                ? 'border-dashed border-border-subtle text-text-secondary'
                : cell.hasWarning
                  ? 'border-status-due-fg bg-status-due-bg text-status-due-fg'
                  : 'border-border-subtle bg-surface';
              return (
                <li key={period.id} className="p-2">
                  <button
                    type="button"
                    aria-label={label}
                    onClick={() => onActivateCell(selected, period.id)}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-md border px-3 py-2 text-start ${tone}`}
                  >
                    <span className="w-24 shrink-0">
                      <span className="block text-label font-medium">{periodLabel}</span>
                      <span className="block text-caption text-text-secondary">
                        {formatTime(period.starts_at, config)}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      {cell ? (
                        <>
                          <span className="flex items-center gap-1 font-medium">
                            {cell.subjectLabel}
                            {cell.hasWarning && (
                              <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
                            )}
                          </span>
                          <span className="block text-caption">
                            {cell.teacherLabels.join(', ')}
                          </span>
                        </>
                      ) : (
                        <span className="flex items-center gap-1">
                          <PlusIcon className="size-3.5" aria-hidden="true" />
                          {t('grid.emptyCell')}
                        </span>
                      )}
                    </span>
                    <ChevronRightIcon
                      className="size-4 shrink-0 rtl:rotate-180"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
