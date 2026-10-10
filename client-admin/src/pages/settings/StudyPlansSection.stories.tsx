import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { StudyPlansSection } from './StudyPlansSection';

/**
 * [66.3] Study-plans settings section. Same "client-admin isn't globbed into
 * a running Storybook instance yet" precedent as `CalendarSection.stories.tsx`.
 */
const meta: Meta<typeof StudyPlansSection> = {
  component: StudyPlansSection,
  args: { schoolId: 'school-1', studyPlans: undefined, smsConfigured: true },
};
export default meta;

type Story = StoryObj<typeof StudyPlansSection>;

const credits = (body: object) =>
  http.get('/api/v1/communications/sms-credits', () => HttpResponse.json(body));

export const Default: Story = {
  parameters: { msw: { handlers: [credits({ metering: 'OFF', available: 0, reserved: 0 })] } },
};

export const SmsOnWithBalance: Story = {
  args: {
    studyPlans: {
      statusDeadline: '18:00',
      reminderTime: '08:00',
      escalateAfterSchoolDays: 2,
      weeklyDigestTime: '17:00',
      guardianDigestSms: true,
    },
  },
  parameters: {
    msw: { handlers: [credits({ metering: 'PLATFORM', available: 2150, reserved: 0 })] },
  },
};

export const SmsNotSetUp: Story = {
  args: { smsConfigured: false },
  parameters: { msw: { handlers: [credits({ metering: 'OFF', available: 0, reserved: 0 })] } },
};
