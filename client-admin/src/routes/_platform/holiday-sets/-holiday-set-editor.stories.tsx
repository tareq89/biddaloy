import type { PublicHolidaySet } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { HolidaySetEditor } from './-holiday-set-editor';

const meta: Meta<typeof HolidaySetEditor> = {
  component: HolidaySetEditor,
};
export default meta;

type Story = StoryObj<typeof HolidaySetEditor>;

// `PublicHolidayEntry.set` is the schema's own back-reference to its
// parent set (see `schema.d.ts`'s `PublicHolidayEntry`) — the editor never
// reads it, so the fixture below omits it and casts, same "don't hand-type
// a self-referencing generated shape" call other fixtures in this repo
// make for circular DTOs.
const BASE_SET = {
  id: 'set-1',
  country: 'BD',
  year: 2026,
  source: 'NAGER_DATE',
  published_at: null,
  fetched_at: '2026-01-01T00:00:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  entries: [
    {
      id: 'entry-1',
      set_id: 'set-1',
      date: '2026-02-21',
      end_date: '2026-02-21',
      name: 'International Mother Language Day',
      name_bn: 'আন্তর্জাতিক মাতৃভাষা দিবস',
    },
    {
      id: 'entry-2',
      set_id: 'set-1',
      date: '2026-03-26',
      end_date: '2026-03-26',
      name: 'Independence Day',
      name_bn: 'স্বাধীনতা দিবস',
    },
  ],
} as unknown as PublicHolidaySet;

const noop = () => {};

export const Populated: Story = {
  args: {
    set: BASE_SET,
    onSave: noop,
    isSaving: false,
    saveError: null,
    saveSucceeded: false,
    onPublish: noop,
    onUnpublish: noop,
    isPublishing: false,
    isUnpublishing: false,
    publishError: null,
    unpublishError: null,
  },
};

export const Empty: Story = {
  args: {
    ...Populated.args,
    set: { ...BASE_SET, entries: [] },
  },
};

export const Published: Story = {
  args: {
    ...Populated.args,
    set: { ...BASE_SET, published_at: '2026-01-05T00:00:00.000Z' },
  },
};

export const SaveError: Story = {
  args: {
    ...Populated.args,
    saveError: new Error('Could not save these entries.'),
  },
};

export const Saving: Story = {
  args: {
    ...Populated.args,
    isSaving: true,
  },
};
