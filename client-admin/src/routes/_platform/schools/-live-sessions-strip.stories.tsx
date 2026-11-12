import type { ImpersonationSessionDto } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { LiveSessionsStripView } from './-live-sessions-strip';

/** Mockup "Live sessions strip": chips wrap at 1440 px and scroll sideways at 390 px. */
const viewports = {
  desktop1440: { name: 'Desktop 1440', styles: { width: '1440px', height: '400px' } },
  phone390: { name: 'Phone 390', styles: { width: '390px', height: '400px' } },
};
const NOW = Date.parse('2030-01-01T00:00:00.000Z');
const s = (id: string, schoolName: string, userName: string, role: string, mins: number) =>
  ({
    id,
    schoolName,
    userName,
    role,
    expiresAt: new Date(NOW + mins * 60_000).toISOString(),
  }) as ImpersonationSessionDto;

const meta: Meta<typeof LiveSessionsStripView> = {
  component: LiveSessionsStripView,
  args: {
    now: NOW,
    onEnd: () => {},
    sessions: [
      s('1', 'Green Valley', 'Rahim', 'TEACHER', 42),
      s('2', 'Sunrise', 'Nabil', 'ADMIN', 12),
    ],
  },
  parameters: { viewport: { viewports, defaultViewport: 'desktop1440' } },
};
export default meta;
type Story = StoryObj<typeof LiveSessionsStripView>;

export const Desktop: Story = {};
export const Phone: Story = {
  parameters: { viewport: { viewports, defaultViewport: 'phone390' } },
};
export const EndFailed: Story = { args: { error: true } };
/** Nothing is drawn when no one is signed in. */
export const Hidden: Story = { args: { sessions: [] } };
