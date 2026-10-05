import { CalendarEventType } from '@biddaloy/shared';
import {
  DayPanel,
  MonthGrid,
  type MonthGridEvent,
  StudentPicker,
  type StudentPickerItem,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatMonth } from '@biddaloy/ui/utils';
import type { Meta, StoryObj } from '@storybook/react-vite';

/**
 * [17.5.2]'s `/portal/calendar` — static composition of the same
 * presentational pieces the route renders (`StudentPicker`, `MonthGrid`,
 * `DayPanel`), same "client-admin isn't globbed into a running
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
  const config = useRegionConfig();
  const selectedDate = '2026-09-08';
  const onSelected = events.filter(
    (e) => e.startDate <= selectedDate && (e.endDate ?? e.startDate) >= selectedDate,
  );
  return (
    <PageContainer>
      <PageHeader title={t('calendar.title')} subtitle={`Fatima Rahman · ${formatMonth('2026-09', config)}`} />
      {showPicker && (
        <StudentPicker
          label={t('calendar.pickerLabel')}
          items={CHILDREN}
          selectedId="fatima"
          to="/portal/calendar"
        />
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <div className="min-w-0 flex-1">
          <MonthGrid
            month="2026-09"
            today="2026-09-08"
            selectedDate={selectedDate}
            onMonthChange={() => undefined}
            firstDayOfWeek={0}
            weeklyOffDays={[5, 6]}
            events={events}
            weekdayLabels={WEEKDAY_LABELS}
            moreLabel={(count) => t('calendar.moreEvents', { count: count })}
          />
        </div>
        <DayPanel date={selectedDate} events={onSelected} />
      </div>
    </PageContainer>
  );
}

type Story = StoryObj<typeof PortalCalendarView>;

/** Grid on every width with the day panel beside it. One linked child, no picker —
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

/** Empty month: the grid with no chips and the panel's own empty-day line. */
export const EmptyMonth: Story = {
  render: () => <PortalCalendarView events={[]} showPicker={false} />,
};
