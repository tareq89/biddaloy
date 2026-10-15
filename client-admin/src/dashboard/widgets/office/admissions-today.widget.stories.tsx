import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { AdmissionsTodayView, type AdmissionsTodayDto } from './admissions-today.widget';

const data: AdmissionsTodayDto = {
  new_today: 4,
  pending_total: 17,
  latest: [
    {
      id: 'a-1',
      reference_number: 'ADM-2026-0042',
      applicant_name: 'Nadia Akter',
      created_at: '2026-10-07T03:12:00.000Z',
      status: 'PENDING',
    },
    {
      id: 'a-2',
      reference_number: 'ADM-2026-0041',
      applicant_name: 'Rahim Uddin',
      created_at: '2026-10-07T02:40:00.000Z',
      status: 'SHORTLISTED',
    },
  ],
};

const meta: Meta<typeof AdmissionsTodayView> = {
  title: 'Dashboard/Widgets/AdmissionsToday',
  component: AdmissionsTodayView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof AdmissionsTodayView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Zero: Story = { args: { data: { new_today: 0, pending_total: 0, latest: [] } } };
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
