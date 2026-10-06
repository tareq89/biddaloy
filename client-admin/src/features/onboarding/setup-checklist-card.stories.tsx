import { setAccessToken, setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { withMemoryRouter } from '../../../../ui/.storybook/router-decorator';

import { ConnectHintCard } from './connect-hint-card';
import { SetupChecklistCard } from './setup-checklist-card';

/** [13.5.1] Dashboard setup checklist and the sign-in hint. Toolbar locale switches to Bangla. */
setActiveRole('ADMIN');
// The hint keys its dismiss flag on the token's `sub`.
setAccessToken(`h.${btoa(JSON.stringify({ sub: 'story-user' }))}.s`);

const ids = [
  'profile',
  'structure',
  'sections',
  'students',
  'staff',
  'feeStructures',
  'guardianInvites',
  'messageSettings',
];
const status = (done: number) =>
  http.get('/api/v1/onboarding/status', () =>
    HttpResponse.json({
      finished_at: null,
      dismissed_at: null,
      seen: true,
      setup_path: null,
      items: ids.map((id, i) => ({ id, done: i < done })),
      counts: { classes: 0, sections: 0, students: 0, staff: 0 },
      trial: null,
      support_url: null,
    }),
  );

const meta: Meta<typeof SetupChecklistCard> = {
  title: 'Features/Onboarding/SetupChecklistCard',
  component: SetupChecklistCard,
  decorators: [withMemoryRouter(['/'])],
  parameters: { msw: { handlers: [status(3)] } },
};
export default meta;
type Story = StoryObj<typeof SetupChecklistCard>;

export const Partway: Story = {};

export const JustStarted: Story = { parameters: { msw: { handlers: [status(0)] } } };

export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

const hintHandlers = [
  http.get('/api/v1/auth/social/providers', () =>
    HttpResponse.json({ providers: ['google', 'facebook'] }),
  ),
  http.get('/api/v1/auth/social/identities', () => HttpResponse.json([])),
];

export const ConnectHint: StoryObj<typeof ConnectHintCard> = {
  render: () => <ConnectHintCard />,
  parameters: { msw: { handlers: hintHandlers } },
};

export const ConnectHintPhone: StoryObj<typeof ConnectHintCard> = {
  ...ConnectHint,
  parameters: { ...ConnectHint.parameters, viewport: { defaultViewport: 'mobile1' } },
};
