import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';
import { SummaryStep } from '../summary/summary-step';

import { PeopleStep } from './people-step';

/**
 * [13.6.4] The people and summary slots of the welcome wizard (the frame's
 * Back / Next footer is not part of them). Switch the toolbar locale for Bangla.
 */
const status = (over: object = {}) =>
  http.get('/api/v1/onboarding/status', () =>
    HttpResponse.json({
      finished_at: null,
      dismissed_at: null,
      seen: true,
      setup_path: 'guided',
      items: [],
      counts: { classes: 6, sections: 12, students: 240, staff: 18 },
      trial: null,
      support_url: null,
      ...over,
    }),
  );

const meta: Meta<typeof PeopleStep> = {
  title: 'Features/Onboarding/PeopleStep',
  component: PeopleStep,
  args: { onDownloadStudentSample: () => undefined, onDownloadStaffSample: () => undefined },
  decorators: [withMemoryRouter(['/welcome?step=people'])],
  parameters: { msw: { handlers: [status()] } },
};
export default meta;
type Story = StoryObj<typeof PeopleStep>;

export const Default: Story = {};

export const Empty: Story = {
  parameters: {
    msw: { handlers: [status({ counts: { classes: 0, sections: 0, students: 0, staff: 1 } })] },
  },
};

export const Trial: Story = {
  parameters: {
    msw: {
      handlers: [
        status({ trial: { ends_at: '2030-01-01', days_left: 9, seats: { used: 3, limit: 50 } } }),
      ],
    },
  },
};

export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const Summary: Story = {
  render: () => <SummaryStep />,
  parameters: {
    msw: { handlers: [status(), http.patch('/api/v1/onboarding', () => HttpResponse.json({}))] },
  },
};

export const SummaryPhone: Story = {
  ...Summary,
  parameters: { ...Summary.parameters, viewport: { defaultViewport: 'mobile1' } },
};
