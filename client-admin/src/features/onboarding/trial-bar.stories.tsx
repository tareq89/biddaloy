import { setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { withMemoryRouter } from '../../../../ui/.storybook/router-decorator';

import { TrialBar } from './trial-bar';
import { TrialDetailsDialog } from './trial-details-dialog';

/** [13.5.1] Trial bar for the staff shell (ADMIN, trial school). Toolbar locale switches to Bangla. */
setActiveRole('ADMIN');

const status = (days_left: number, limit: number | null = 50) =>
  http.get('/api/v1/onboarding/status', () =>
    HttpResponse.json({
      finished_at: null,
      dismissed_at: null,
      seen: true,
      setup_path: null,
      items: [],
      counts: { classes: 0, sections: 0, students: 0, staff: 0 },
      trial: { ends_at: '2030-01-01', days_left, seats: { used: 12, limit } },
      support_url: 'https://example.com/contact',
    }),
  );

const meta: Meta<typeof TrialBar> = {
  title: 'Features/Onboarding/TrialBar',
  component: TrialBar,
  decorators: [withMemoryRouter(['/'])],
  parameters: { msw: { handlers: [status(12)] } },
};
export default meta;
type Story = StoryObj<typeof TrialBar>;

export const Warning: Story = {};

export const LastDays: Story = { parameters: { msw: { handlers: [status(2)] } } };

export const LastDay: Story = { parameters: { msw: { handlers: [status(0)] } } };

export const NoLimit: Story = { parameters: { msw: { handlers: [status(12, null)] } } };

export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

export const Details: StoryObj<typeof TrialDetailsDialog> = {
  render: () => (
    <TrialDetailsDialog
      open
      onOpenChange={() => undefined}
      daysLeft={12}
      seats={{ used: 12, limit: 50 }}
      supportUrl="https://example.com/contact"
    />
  ),
};
