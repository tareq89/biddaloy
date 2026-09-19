import { CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import type { CalendarEvent, PublicHolidayEntry } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { EventDetailsSheet } from './-event-details-sheet';
import { EventFormDialog } from './-event-form-dialog';
import { GovernmentHolidaysDialog } from './-government-holidays-dialog';

/**
 * [17.4.2]'s route-local dialogs, stubbed against static data — same
 * "client-admin isn't globbed into a running Storybook instance yet"
 * precedent as `CalendarSection.stories.tsx`.
 */
const meta: Meta = {};
export default meta;

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    academic_year_id: 'year-1',
    type: CalendarEventType.EVENT,
    name: 'Sports day',
    description: 'Annual inter-house sports day.',
    start_date: '2026-09-10',
    end_date: '2026-09-10',
    start_time: null,
    end_time: null,
    counts_as_working_day: true,
    audience: CalendarAudience.ALL,
    class_ids: [],
    is_locked: false,
    published: true,
    ...overrides,
  };
}

export const EventDetailsPublished: StoryObj = {
  render: () => (
    <EventDetailsSheet
      open
      onOpenChange={() => {}}
      event={event()}
      canManage
      onEdit={() => {}}
      onDelete={() => {}}
      onPublish={() => {}}
    />
  ),
};

export const EventDetailsLocked: StoryObj = {
  render: () => (
    <EventDetailsSheet
      open
      onOpenChange={() => {}}
      event={event({ is_locked: true })}
      canManage
      onEdit={() => {}}
      onDelete={() => {}}
      onPublish={() => {}}
    />
  ),
};

export const EventDetailsDraft: StoryObj = {
  render: () => (
    <EventDetailsSheet
      open
      onOpenChange={() => {}}
      event={event({ published: false })}
      canManage
      onEdit={() => {}}
      onDelete={() => {}}
      onPublish={() => {}}
    />
  ),
};

export const EventFormCreate: StoryObj = {
  render: () => (
    <EventFormDialog
      open
      onOpenChange={() => {}}
      mode="create"
      isPending={false}
      error={undefined}
      onSubmit={() => {}}
    />
  ),
};

export const EventFormEdit: StoryObj = {
  render: () => (
    <EventFormDialog
      open
      onOpenChange={() => {}}
      mode="edit"
      initialValues={event()}
      isPending={false}
      error={undefined}
      onSubmit={() => {}}
    />
  ),
};

const SUGGESTIONS: PublicHolidayEntry[] = [
  {
    id: 'h-1',
    set_id: 'set-1',
    set: {} as PublicHolidayEntry['set'],
    date: '2026-12-16',
    end_date: '2026-12-16',
    name: 'Victory Day',
    name_bn: 'বিজয় দিবস',
  },
  {
    id: 'h-2',
    set_id: 'set-1',
    set: {} as PublicHolidayEntry['set'],
    date: '2026-03-26',
    end_date: '2026-03-26',
    name: 'Independence Day',
    name_bn: 'স্বাধীনতা দিবস',
  },
];

export const GovernmentHolidaysPopulated: StoryObj = {
  render: () => (
    <GovernmentHolidaysDialog
      open
      onOpenChange={() => {}}
      suggestions={SUGGESTIONS}
      existingEvents={[]}
      isPending={false}
      onAdd={() => {}}
    />
  ),
};

export const GovernmentHolidaysEmpty: StoryObj = {
  render: () => (
    <GovernmentHolidaysDialog
      open
      onOpenChange={() => {}}
      suggestions={[]}
      existingEvents={[]}
      isPending={false}
      onAdd={() => {}}
    />
  ),
};
