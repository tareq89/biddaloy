import { setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse, delay } from 'msw';

import { MorningDigestCard } from './morning-digest-card';

// Self-gates on role (ADMIN / EXECUTIVE / TEACHER); the hidden case is in the test.
setActiveRole('TEACHER');

const me = (preferences: unknown) =>
  http.get('/api/v1/users/me', () => HttpResponse.json({ id: 'u1', preferences }));

const meta: Meta<typeof MorningDigestCard> = {
  component: MorningDigestCard,
  parameters: { msw: { handlers: [me(null)] } },
};

export default meta;
type Story = StoryObj<typeof MorningDigestCard>;

/** No stored preference: on. */
export const On: Story = {};

export const Off: Story = {
  parameters: { msw: { handlers: [me({ digest: { enabled: false } })] } },
};

export const Saving: Story = {
  parameters: {
    msw: {
      handlers: [
        me(null),
        http.patch('/api/v1/users/me/preferences/digest', async () => {
          await delay('infinite');
        }),
      ],
    },
  },
};

export const SaveError: Story = {
  parameters: {
    msw: {
      handlers: [
        me(null),
        http.patch('/api/v1/users/me/preferences/digest', () =>
          HttpResponse.json({ message: 'Could not save' }, { status: 500 }),
        ),
      ],
    },
  },
};

/** ADMIN can read the school settings, so the description shows the time. */
export const AdminWithTime: Story = {
  decorators: [
    (Story) => {
      setActiveRole('ADMIN');
      return <Story />;
    },
  ],
  parameters: {
    msw: {
      handlers: [
        me(null),
        http.get('/api/v1/schools/:id/settings', () =>
          HttpResponse.json({ dashboard: { digestTime: '07:15' } }),
        ),
      ],
    },
  },
};
