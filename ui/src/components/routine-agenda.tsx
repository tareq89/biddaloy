/**
 * [21.10.1] D18: the phone-first agenda — a dated list, never a grid, at
 * every width. Renders exactly the shape its callers build from
 * `resolveRoutine` (D14): no date/recurrence logic lives here, only
 * display. `my.tsx` (teacher) and `portal/routine.tsx` (student/guardian)
 * are its two callers; they resolve subject/room/teacher/section ids into
 * labels and decide each day's off-reason before handing this component
 * plain strings.
 */
import { CalendarDaysIcon } from 'lucide-react';

import { useRegionConfig, useTranslation } from '../i18n';
import type { RegionConfig } from '../i18n/region-config';
import { cn } from '../primitives/lib/utils';
import { formatDate, formatTime, formatWeekday } from '../utils/date';
import { formatNumber } from '../utils/number';

import { Button } from './button';
import { StatusBadge } from './status-badge';

export interface RoutineAgendaItem {
  slotId: string;
  periodLabel: string;
  startsAt: string;
  endsAt: string;
  subjectLabel: string;
  /** Only set where the agenda spans more than one section (the teacher
   * view) — the portal view already knows which single section it is. */
  sectionLabel?: string | undefined;
  roomLabel?: string | null | undefined;
  cancelled: boolean;
  /** "Covering for Ms Nahar" — set only when this period is a
   * substitution the caller is covering, never for their own periods. */
  coveringForLabel?: string | undefined;
}

export interface RoutineAgendaDay {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  weekdayLabel: string;
  isToday: boolean;
  /** Set only when this day has no items *because* it isn't a working
   * day (holiday or weekly off) — the reason to show instead of a bare
   * "no classes". Absent on a working day with genuinely nothing
   * scheduled. */
  offReason?: string | undefined;
  items: RoutineAgendaItem[];
}

export interface RoutineAgendaProps {
  /** Today first, in the order to render — this component never
   * reorders or filters it. */
  days: RoutineAgendaDay[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  weekView: boolean;
  onToggleWeekView: (weekView: boolean) => void;
}

function DayItems({
  items,
  t,
  config,
}: {
  items: RoutineAgendaItem[];
  t: ReturnType<typeof useTranslation>['t'];
  config: RegionConfig;
}) {
  if (items.length === 0) {
    return <p className="text-text-secondary">{t('agenda.emptyDay')}</p>;
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {items.map((item) => (
        <li key={item.slotId} className="flex items-start gap-4 py-3">
          <div className="w-24 shrink-0 md:w-28">
            <p className="font-medium">{formatTime(item.startsAt, config)}</p>
            <p className="text-caption text-text-secondary">
              {t('routine.until', { ns: 'common', time: formatTime(item.endsAt, config) })}
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p
                className={cn('font-medium', item.cancelled && 'text-text-secondary line-through')}
              >
                {item.subjectLabel}
              </p>
              {item.cancelled && <StatusBadge tone="neutral" label={t('agenda.cancelledLabel')} />}
              {item.coveringForLabel && <StatusBadge tone="info" label={item.coveringForLabel} />}
            </div>
            <p className="text-caption text-text-secondary">
              {[item.sectionLabel, item.periodLabel, item.roomLabel].filter(Boolean).join(' · ')}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RoutineAgenda({
  days,
  selectedDate,
  onSelectDate,
  weekView,
  onToggleWeekView,
}: RoutineAgendaProps) {
  const { t } = useTranslation('routines');
  const { t: tc } = useTranslation('common');
  const config = useRegionConfig();
  const selectedDay = days.find((day) => day.date === selectedDate) ?? days[0];

  const dayCard = (day: RoutineAgendaDay, toggle: boolean) => (
    <section
      key={day.date}
      className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-h3">
            {formatWeekday(day.date, config)}, {formatDate(day.date, config)}
          </h2>
          <p className="text-text-secondary">
            {tc('routine.periodCount', { count: day.items.length })}
          </p>
        </div>
        {toggle && (
          <Button
            type="button"
            variant="outline"
            aria-pressed={weekView}
            onClick={() => onToggleWeekView(!weekView)}
            className="h-11 shrink-0 md:h-8"
          >
            <CalendarDaysIcon aria-hidden="true" />
            {weekView ? t('agenda.weekViewOn') : t('agenda.weekViewOff')}
          </Button>
        )}
      </div>
      <div className="mt-2">
        {day.offReason ? (
          <p className="text-text-secondary">{day.offReason}</p>
        ) : (
          <DayItems items={day.items} t={t} config={config} />
        )}
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* D18: a horizontally-scrolling row of day tabs, never columns
          in a grid — this scrolls at 390px instead of overflowing it. */}
      <div
        role="tablist"
        aria-label={t('agenda.daySwitcherLabel')}
        className="flex [scrollbar-width:none] overflow-x-auto border-b border-border-subtle"
      >
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            role="tab"
            aria-selected={day.date === selectedDate}
            onClick={() => onSelectDate(day.date)}
            className={cn(
              'inline-flex h-11 shrink-0 items-center border-b-2 px-3 whitespace-nowrap md:h-10',
              day.date === selectedDate
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {day.isToday
              ? t('agenda.todayLabel')
              : `${day.weekdayLabel} ${formatNumber(Number(day.date.slice(8, 10)), config)}`}
          </button>
        ))}
      </div>

      {weekView ? (
        <div className="flex flex-col gap-4">
          {days.map((day) => dayCard(day, day.date === selectedDay?.date))}
        </div>
      ) : selectedDay ? (
        dayCard(selectedDay, true)
      ) : (
        <p className="text-text-secondary">{t('agenda.emptyDay')}</p>
      )}
    </div>
  );
}
