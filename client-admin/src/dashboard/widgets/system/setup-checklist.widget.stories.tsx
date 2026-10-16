import { setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import SetupChecklistWidget from './setup-checklist.widget';

setActiveRole('ADMIN');

const body = (extra: object = {}, done = 3) => ({
  finished_at: null,
  dismissed_at: null,
  seen: true,
  setup_path: null,
  items: ['profile', 'structure', 'sections', 'students', 'staff', 'feeStructures'].map(
    (id, i) => ({ id, done: i < done }),
  ),
  counts: { classes: 0, sections: 0, students: 0, staff: 1 },
  ...extra,
});
const status = (b: object) => http.get('/api/v1/onboarding/status', () => HttpResponse.json(b));

const meta: Meta<typeof SetupChecklistWidget> = {
  title: 'Dashboard/Widgets/SetupChecklist',
  component: SetupChecklistWidget,
  decorators: [withMemoryRouter(['/dashboard'])],
  args: { variant: 'full', size: 'L' },
  parameters: { msw: { handlers: [status(body())] } },
};
export default meta;
type Story = StoryObj<typeof SetupChecklistWidget>;

export const PartlyDone: Story = {};
export const Compact: Story = { args: { variant: 'compact' } };
export const BrandNew: Story = {
  parameters: { msw: { handlers: [status(body({}, 0))] } },
};
/** Finished or hidden: the slot renders nothing. */
export const Hidden: Story = {
  parameters: { msw: { handlers: [status(body({ dismissed_at: '2026-10-01T00:00:00Z' }))] } },
};
