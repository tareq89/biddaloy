import { CalendarEventType } from '@biddaloy/shared';
import { Card, StudentPicker, type StudentPickerItem } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { AgendaList, type AgendaEvent } from '../../components/calendar/agenda-list';
import { MonthGrid, type MonthGridEvent } from '../../components/calendar/month-grid';

/**
 * [17.5.2]'s `/portal/calendar` — static composition of the same
 * presentational pieces the route renders (`StudentPicker`, `MonthGrid`,
 * `AgendaList`), same "client-admin isn't globbed into a running
 * Storybook instance yet" precedent as `-calendar-view.stories.tsx`
 * ([17.4.2]'s staff calendar). No data hooks, no router — a route-level
 * RTL test (`calendar.test.tsx`) exercises the real thing.
 */
const meta: Meta = {};
export default meta;

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CLASS_8_EVENTS: MonthGridEvent[] = [
  {
    id: 'e1',
    type: CalendarEventType.EXAM,
    typeLabel: 'Exam',
    name: 'Class 8 mid-terms',
    startDate: '2026-09-10',
    endDate: '2026-09-12',
  },
  {
    id: 'e2',
    type: CalendarEventType.HOLIDAY,
    typeLabel: 'Holiday',
    name: 'National Day',
    startDate: '2026-09-05',
    endDate: '2026-09-05',
  },
];

const CLASS_3_EVENTS: MonthGridEvent[] = [
  {
    id: 'e3',
    type: CalendarEventType.EVENT,
    typeLabel: 'Event',
    name: 'Class 3 sports day',
    startDate: '2026-09-18',
    endDate: '2026-09-18',
  },
];

const CHILDREN: StudentPickerItem[] = [
  { id: 'fatima', name: 'Fatima Rahman', meta: 'Class 8 B · Roll 14' },
  { id: 'imran', name: 'Imran Rahman', meta: 'Class 3 A · Roll 7' },
];

function PortalCalendarView({
  events,
  showPicker,
}: {
  events: MonthGridEvent[];
  showPicker: boolean;
}) {
  const { t } = useTranslation('portal');
  const agendaEvents: AgendaEvent[] = events;
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <h1 className="text-lg font-semibold tracking-tight">{t('calendar.title')}</h1>
      {showPicker && (
        <StudentPicker
          label={t('calendar.pickerLabel')}
          items={CHILDREN}
          selectedId="fatima"
          to="/portal/calendar"
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <span aria-hidden="true">{'<'}</span>
        <span className="text-sm font-semibold" aria-hidden="true">
          {t('attendanceGrid.months.9')} 2026
        </span>
        <span aria-hidden="true">{'>'}</span>
      </div>
      <Card className="p-3.5">
        <div className="hidden md:block">
          <MonthGrid
            month="2026-09"
            firstDayOfWeek={0}
            weeklyOffDays={[5, 6]}
            events={events}
            weekdayLabels={WEEKDAY_LABELS}
            moreLabel={(count) => t('calendar.moreEvents', { count: count })}
          />
        </div>
        <div className="md:hidden">
          <AgendaList
            events={agendaEvents}
            formatDayHeading={(day) => day}
            emptyLabel={t('calendar.agendaEmpty')}
          />
        </div>
      </Card>
    </div>
  );
}

type Story = StoryObj<typeof PortalCalendarView>;

/** Desktop-shaped: `MonthGrid` visible via `md:block` (Storybook's own
 * viewport is desktop-sized by default). One linked child, no picker —
 * the "no picker when exactly one student" case `calendar.test.tsx`
 * asserts. */
export const DesktopGridSingleChild: Story = {
  render: () => <PortalCalendarView events={CLASS_8_EVENTS} showPicker={false} />,
};

/** Two linked children: `StudentPicker` renders, each chip switching to
 * that child's own class-scoped events (`Fatima` → Class 8's events
 * shown here; switching to `Imran` in the real route re-fetches Class
 * 3's). */
export const ChildSelectorMultipleChildren: Story = {
  render: () => <PortalCalendarView events={CLASS_8_EVENTS} showPicker />,
};

/** A different child's differently-scoped event list, so the story set
 * shows the child filter actually changes what's on the calendar, not
 * just who's selected. */
export const SecondChildScopedEvents: Story = {
  render: () => <PortalCalendarView events={CLASS_3_EVENTS} showPicker />,
};

/** Empty month: `AgendaList`'s own empty-state text
 * ("No events this month.") — both the grid and agenda branches are
 * always mounted (same `hidden md:block` / `md:hidden` split as the
 * real route), so viewing this story at a narrow Storybook viewport
 * shows the mobile-shaped agenda empty state. */
export const EmptyMonth: Story = {
  render: () => <PortalCalendarView events={[]} showPicker={false} />,
};
