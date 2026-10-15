import { DashboardWidgetKey } from '@biddaloy/shared';

import { UpcomingCalendarCard } from '../../../components/upcoming-calendar-card';

export const widgetKey = DashboardWidgetKey.UPCOMING;

// The card has one shape; the phone shows it as-is under its tile row.
export default function UpcomingWidget() {
  return <UpcomingCalendarCard calendarPath="/calendar" requirePermission />;
}
