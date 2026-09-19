import type { MaskedRegionSettings } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { CalendarSection } from './CalendarSection';

/**
 * [17.3.4]'s Calendar settings section. Same "client-admin isn't globbed
 * into a running Storybook instance yet" gap `record-payment-modal
 * .stories.tsx` notes — written anyway, following that precedent.
 */
const meta: Meta<typeof CalendarSection> = {
  component: CalendarSection,
  args: {
    schoolId: 'school-1',
  },
};
export default meta;

type Story = StoryObj<typeof CalendarSection>;

const REGION: MaskedRegionSettings = {
  locale: 'en-BD',
  country: 'BD',
  currency: { code: 'BDT', symbol: '৳', position: 'prefix', decimals: 2, grouping: 'lakh-crore' },
  numerals: 'latin',
  date: { format: 'dd/MM/yyyy', firstDayOfWeek: 0, calendar: 'gregorian' },
  phone: {
    country: 'BD',
    pattern: '^01[0-9]{9}$',
    example: '01712345678',
    displayFormat: '+880 XXXXXXXXXX',
  },
  address: { fields: ['street', 'city'], order: ['street', 'city'] },
  academicYear: { startMonth: 1 },
  identifiers: { national: 'NID', student: 'Student ID' },
  timezone: 'Asia/Dhaka',
  calendar: { termLabel: 'TERM' },
};

function calendarSettingsHandler(weeklyOffDays: number[] = [5], firstDayOfWeek = 0) {
  return http.get('/api/v1/calendar-settings', () =>
    HttpResponse.json({
      termLabel: 'TERM',
      country: 'BD',
      firstDayOfWeek,
      weeklyOffDays,
      timezone: 'Asia/Dhaka',
      currentAcademicYear: null,
    }),
  );
}

export const Populated: Story = {
  args: { region: REGION },
  parameters: { msw: { handlers: [calendarSettingsHandler()] } },
};

export const SemesterSchool: Story = {
  args: { region: { ...REGION, calendar: { termLabel: 'SEMESTER' } } },
  parameters: { msw: { handlers: [calendarSettingsHandler()] } },
};

export const Loading: Story = {
  args: { region: REGION },
  parameters: {
    msw: { handlers: [http.get('/api/v1/calendar-settings', () => new Promise(() => undefined))] },
  },
};

export const WeekShapeError: Story = {
  args: { region: REGION },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/calendar-settings', () => HttpResponse.json({ message: 'error' }, { status: 500 })),
      ],
    },
  },
};
