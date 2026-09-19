import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { TermsTab } from './terms-tab';

/**
 * [17.3.4]'s Terms tab. Same "client-admin isn't globbed into a running
 * Storybook instance yet" gap `record-payment-modal.stories.tsx` notes —
 * written anyway, following that precedent, so it's ready once that
 * wiring gap is fixed.
 */
const meta: Meta<typeof TermsTab> = {
  component: TermsTab,
  args: {
    academicYearId: 'year-1',
  },
};
export default meta;

type Story = StoryObj<typeof TermsTab>;

const CALENDAR_SETTINGS = {
  termLabel: 'TERM',
  country: 'BD',
  firstDayOfWeek: 0,
  weeklyOffDays: [5],
  timezone: 'Asia/Dhaka',
  currentAcademicYear: null,
};

function calendarSettingsHandler(overrides: Partial<typeof CALENDAR_SETTINGS> = {}) {
  return http.get('/api/v1/calendar-settings', () =>
    HttpResponse.json({ ...CALENDAR_SETTINGS, ...overrides }),
  );
}

function termsHandler(terms: unknown[]) {
  return http.get('/api/v1/calendar/terms', () => HttpResponse.json(terms));
}

const TERMS = [
  {
    id: 'term-1',
    academic_year_id: 'year-1',
    seq: 1,
    name: 'First Term',
    start_date: '2026-01-01',
    end_date: '2026-04-30',
  },
  {
    id: 'term-2',
    academic_year_id: 'year-1',
    seq: 2,
    name: 'Second Term',
    start_date: '2026-05-01',
    end_date: '2026-08-31',
  },
];

export const Populated: Story = {
  parameters: {
    msw: { handlers: [termsHandler(TERMS), calendarSettingsHandler()] },
  },
};

export const Empty: Story = {
  parameters: {
    msw: { handlers: [termsHandler([]), calendarSettingsHandler()] },
  },
};

export const SemesterSchool: Story = {
  parameters: {
    msw: {
      handlers: [termsHandler(TERMS), calendarSettingsHandler({ termLabel: 'SEMESTER' })],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/calendar/terms', () => new Promise(() => undefined)),
        calendarSettingsHandler(),
      ],
    },
  },
};

export const ErrorState: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/calendar/terms', () => HttpResponse.json({ message: 'error' }, { status: 500 })),
        calendarSettingsHandler(),
      ],
    },
  },
};
