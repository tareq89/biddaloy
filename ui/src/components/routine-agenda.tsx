/**
 * [21.10.1] D18: the phone-first agenda — a dated list, never a grid, at
 * every width. Renders exactly the shape its callers build from
 * `resolveRoutine` (D14): no date/recurrence logic lives here, only
 * display. `my.tsx` (teacher) and `portal/routine.tsx` (student/guardian)
 * are its two callers; they resolve subject/room/teacher/section ids into
 * labels and decide each day's off-reason before handing this component
 * plain strings.
 */
import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

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
}: {
  items: RoutineAgendaItem[];
  t: ReturnType<typeof useTranslation>['t'];
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('agenda.emptyDay')}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li
          key={item.slotId}
          className={cn(
            'flex flex-col gap-1 rounded-lg border border-border-subtle bg-card px-3 py-2 text-sm',
            item.cancelled && 'opacity-60',
          )}
        >
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="font-medium">{item.periodLabel}</span>
            <span className="text-muted-foreground">
              · {item.startsAt}–{item.endsAt}
            </span>
            {item.sectionLabel && <span className="text-muted-foreground">· {item.sectionLabel}</span>}
            <span className={cn(item.cancelled && 'line-through')}>· {item.subjectLabel}</span>
            {item.roomLabel && <span className="text-muted-foreground">· {item.roomLabel}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {item.cancelled && (
              <span className="rounded-full bg-status-overdue-bg px-2 py-0.5 text-xs text-status-overdue-fg">
                {t('agenda.cancelledLabel')}
              </span>
            )}
            {item.coveringForLabel && (
              <span className="rounded-full bg-status-due-bg px-2 py-0.5 text-xs text-status-due-fg">
                {item.coveringForLabel}
              </span>
            )}
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
  const selectedDay = days.find((day) => day.date === selectedDate) ?? days[0];

  return (
    <div className="flex flex-col gap-3">
      {/* D18: a horizontally-scrolling row of day buttons, never columns
          in a grid — this scrolls at 390px instead of overflowing it. */}
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label={t('agenda.daySwitcherLabel')} className="flex gap-1.5 overflow-x-auto">
          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              role="tab"
              aria-selected={day.date === selectedDate}
              onClick={() => onSelectDate(day.date)}
              className={cn(
                'flex min-w-14 flex-col items-center rounded-md border px-2 py-1.5 text-xs',
                day.date === selectedDate
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border-subtle bg-card',
              )}
            >
              <span>{day.weekdayLabel}</span>
              {day.isToday && <span className="text-[10px] uppercase">{t('agenda.todayLabel')}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={weekView}
          onClick={() => onToggleWeekView(!weekView)}
          className="h-9 shrink-0 rounded-md border border-border-subtle px-2.5 text-xs"
        >
          {weekView ? t('agenda.weekViewOn') : t('agenda.weekViewOff')}
        </button>
      </div>

      {weekView ? (
        <div className="flex flex-col gap-4">
          {days.map((day) => (
            <div key={day.date} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">
                {day.weekdayLabel}
                {day.isToday && ` · ${t('agenda.todayLabel')}`}
              </h2>
              {day.offReason ? (
                <p className="text-sm text-muted-foreground">{day.offReason}</p>
              ) : (
                <DayItems items={day.items} t={t} />
              )}
            </div>
          ))}
        </div>
      ) : selectedDay ? (
        selectedDay.offReason ? (
          <p className="text-sm text-muted-foreground">{selectedDay.offReason}</p>
        ) : (
          <DayItems items={selectedDay.items} t={t} />
        )
      ) : (
        <p className="text-sm text-muted-foreground">{t('agenda.emptyDay')}</p>
      )}
    </div>
  );
}
