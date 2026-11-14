import { UserRole, type PlatformModules, type SchoolModules } from '@biddaloy/shared';
import { Toaster } from '@biddaloy/ui/components';
import type { SchoolProfile } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse, delay } from 'msw';

import { ModulesTab } from './ModulesTab';

/** [77.4.03] D30-D32: Settings › Modules & words › Modules. The profile comes from MSW. */
const profile = (platform: PlatformModules = {}, school: SchoolModules = {}): SchoolProfile =>
  ({
    name: 'Demo school',
    slug: 'demo',
    modules: { platform, school },
    labels: {},
  }) as SchoolProfile;

const handlers = (
  p: SchoolProfile,
  patch: Parameters<typeof http.patch>[1] = () => HttpResponse.json({ version: 1 }),
) => [
  http.get('/api/v1/schools/me/profile', () => HttpResponse.json(p)),
  http.patch('/api/v1/schools/:id/settings', patch),
];

const meta: Meta<typeof ModulesTab> = {
  title: 'Settings/ModulesWords/ModulesTab',
  component: ModulesTab,
  args: { schoolId: 'school-1' },
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
  parameters: { msw: { handlers: handlers(profile()) } },
};
export default meta;

type Story = StoryObj<typeof ModulesTab>;

export const AllOn: Story = {};

export const SomeOff: Story = {
  parameters: {
    msw: {
      handlers: handlers(
        profile(
          {},
          {
            fines: { on: false },
            programs: { on: false },
            homework: { offForRoles: [UserRole.PARENT] },
          },
        ),
      ),
    },
  },
};

/** Platform-off (Website), platform-locked on (Messages and SMS). */
export const PlatformLocked: Story = {
  parameters: {
    msw: {
      handlers: handlers(profile({ website: false }, { messaging: { lock: 'on' } })),
    },
  },
};

/** Fees is off, so Fines is off because of it and cannot be clicked. */
export const DependencyOff: Story = {
  parameters: { msw: { handlers: handlers(profile({}, { fees: { on: false } })) } },
};

/** Click a switch: the save hangs, the switch is held. */
export const Saving: Story = {
  parameters: {
    msw: {
      handlers: handlers(profile(), async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    },
  },
};

/** Click a switch: the save fails, the switch goes back and the row says "Not saved". */
export const SaveError: Story = {
  parameters: {
    msw: {
      handlers: handlers(profile(), () =>
        HttpResponse.json({ statusCode: 400, message: 'no', requestId: 'r' }, { status: 400 }),
      ),
    },
  },
};

/** 390 px: each module is a card, controls 44 px tall. */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
