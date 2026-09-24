import { schoolFactory } from '@biddaloy/ui/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { PeriodSlotsPanel } from './period-slots-panel';

/**
 * [21.7.1] period-slots-panel states called out by the ticket: the
 * empty-shift prompt, a normal week of CLASS rows, a BREAK row (visually
 * distinct, no name field), and the D7 changeover-gap append in action.
 */
const meta: Meta<typeof PeriodSlotsPanel> = {
  component: PeriodSlotsPanel,
  args: {
    changeoverGapMinutes: 5,
  },
};
export default meta;

type Story = StoryObj<typeof PeriodSlotsPanel>;

const TENANT = schoolFactory({ id: 'school-1' });

const SHIFT = {
  id: 'shift-1',
  tenant: TENANT,
  tenant_id: 'school-1',
  name: 'Morning',
  day_starts_at: '08:00',
  day_ends_at: '16:00',
  sequence: 0,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
  deleted_at: null,
};

function slotsHandler(slots: unknown[]) {
  return http.get('*/routines/shifts/shift-1/period-slots', () => HttpResponse.json(slots));
}

export const NoShiftSelected: Story = {
  args: { shift: undefined },
};

export const FullWeek: Story = {
  args: { shift: SHIFT },
  parameters: {
    msw: {
      handlers: [
        slotsHandler([
          {
            id: 's1',
            shift_id: 'shift-1',
            sequence: 0,
            kind: 'CLASS',
            name: 'Math',
            starts_at: '08:00',
            ends_at: '08:40',
          },
          {
            id: 's2',
            shift_id: 'shift-1',
            sequence: 1,
            kind: 'CLASS',
            name: 'English',
            starts_at: '08:45',
            ends_at: '09:25',
          },
          {
            id: 's3',
            shift_id: 'shift-1',
            sequence: 2,
            kind: 'CLASS',
            name: 'Science',
            starts_at: '09:30',
            ends_at: '10:10',
          },
        ]),
      ],
    },
  },
};

export const WithBreakRow: Story = {
  args: { shift: SHIFT },
  parameters: {
    msw: {
      handlers: [
        slotsHandler([
          {
            id: 's1',
            shift_id: 'shift-1',
            sequence: 0,
            kind: 'CLASS',
            name: 'Math',
            starts_at: '08:00',
            ends_at: '08:40',
          },
          {
            id: 's2',
            shift_id: 'shift-1',
            sequence: 1,
            kind: 'BREAK',
            name: null,
            starts_at: '08:40',
            ends_at: '08:55',
          },
          {
            id: 's3',
            shift_id: 'shift-1',
            sequence: 2,
            kind: 'CLASS',
            name: 'English',
            starts_at: '09:00',
            ends_at: '09:40',
          },
        ]),
      ],
    },
  },
};

export const MissingPeriodGapVisible: Story = {
  args: { shift: SHIFT },
  parameters: {
    msw: {
      handlers: [
        slotsHandler([
          {
            id: 's1',
            shift_id: 'shift-1',
            sequence: 0,
            kind: 'CLASS',
            name: 'Math',
            starts_at: '08:00',
            ends_at: '08:40',
          },
          {
            id: 's2',
            shift_id: 'shift-1',
            sequence: 1,
            kind: 'CLASS',
            name: 'Science',
            starts_at: '11:00',
            ends_at: '11:40',
          },
        ]),
      ],
    },
  },
};
