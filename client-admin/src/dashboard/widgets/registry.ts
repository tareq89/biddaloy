/**
 * [169.2-10] The widget seam (D38). A widget is one file
 * `widgets/<group>/<key>.widget.tsx` exporting `widgetKey` and a default
 * component. The key is the file name (D37), so the glob stays lazy and
 * wave-3 tickets add files without touching a shared list.
 */
import type { DashboardWidgetKey, WidgetSize } from '@biddaloy/shared';
import * as React from 'react';

import type { Gated } from '../../module-gate';

export interface WidgetProps {
  variant: 'full' | 'compact' | 'tile';
  size: WidgetSize;
  config?: Record<string, unknown>;
}

const modules = import.meta.glob<{ default: React.ComponentType<WidgetProps> }>('./*/*.widget.tsx');

/**
 * React.lazy caches a rejected import, so a chunk that failed once (e.g. a stale
 * tab after a deploy) would rethrow forever. On failure, swap in a fresh lazy
 * component so the card's Retry (a remount) imports again.
 */
export function retryableLazy(
  load: () => Promise<{ default: React.ComponentType<WidgetProps> }>,
): React.ComponentType<WidgetProps> {
  const make = (): React.ComponentType<WidgetProps> =>
    React.lazy(() =>
      load().catch((error: unknown) => {
        current = make();
        throw error;
      }),
    );
  let current = make();
  return function RetryableWidget(props: WidgetProps) {
    return React.createElement(current, props);
  };
}

export const WIDGET_COMPONENTS = new Map<DashboardWidgetKey, React.ComponentType<WidgetProps>>(
  Object.entries(modules).map(([path, load]) => [
    path.split('/').pop()!.replace('.widget.tsx', '') as DashboardWidgetKey,
    retryableLazy(load),
  ]),
);

/**
 * [77.3 / #3921, D37] The module each dashboard widget belongs to, or `'core'` for the areas that
 * are never off. `Record` over the key union: a new widget key fails to compile until it picks one.
 * Lives here, not in the shared catalogue (a shared file), see the lane report.
 */
export const WIDGET_MODULES: Record<DashboardWidgetKey, Gated> = {
  'attendance-today': 'attendance',
  'staff-today': 'staffAttendance',
  'collection-month': 'fees',
  'mark-entry-progress': 'exams',
  'syllabus-progress': 'syllabus',
  'at-risk-students': 'attendance',
  'sms-balance': 'messaging',
  'failed-messages': 'messaging',
  upcoming: 'core',
  'homework-submission-rate': 'homework',
  'recent-activity': 'core',
  'my-routine-today': 'routines',
  'my-pending-sections': 'attendance',
  'my-mark-deadlines': 'exams',
  'homework-to-check': 'homework',
  'class-teacher-streaks': 'attendance',
  'my-leave-balance': 'staffAttendance',
  'my-syllabus-progress': 'syllabus',
  'collection-today': 'fees',
  'collection-by-month': 'fees',
  'dues-ageing': 'fees',
  'dues-by-class': 'fees',
  'fee-generation-status': 'fees',
  'reminders-pending': 'fees',
  'recent-payments': 'fees',
  'committee-enrollment': 'core',
  'committee-attendance': 'attendance',
  'committee-finance': 'fees',
  'committee-pass-rate': 'exams',
  'seat-plan-status': 'seatPlans',
  'results-state': 'exams',
  'admissions-today': 'admission',
  'guardians-incomplete': 'core',
  'students-added-today': 'core',
  'approvals-pending': 'applications',
  'print-queue': 'core',
  'setup-checklist': 'core',
  'syllabus-vs-plan': 'syllabus',
  'my-lessons-to-mark': 'syllabus',
  'latest-notices': 'notices',
};
