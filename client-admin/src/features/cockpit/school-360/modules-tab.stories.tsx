import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse, delay } from 'msw';

import { GlobalModulesCard, ModulesTab } from './modules-tab';

/** #3934 Owner module screens: the school 360 lock card and the global card on Operations. */
const meta: Meta = {
  title: 'Cockpit/School 360 modules',
  decorators: [(Story) => <ApprovalModalHostProvider>{Story()}</ApprovalModalHostProvider>],
};
export default meta;
type Story = StoryObj;

const globalMap = (modules: Record<string, boolean>) =>
  http.get('*/platform/modules', () => HttpResponse.json({ modules }));
const schoolMap = (modules: object) =>
  http.get('*/platform/schools/:id/modules', () => HttpResponse.json({ modules }));
const failing = (method: 'put') =>
  http[method]('*/platform/*', () => HttpResponse.json({ statusCode: 500 }, { status: 500 }));

const lock = <ModulesTab schoolId="s-1" />;
const handlersOf = (...h: ReturnType<typeof globalMap>[]) => ({
  parameters: { msw: { handlers: h } },
});

export const LockNone: Story = { ...handlersOf(globalMap({}), schoolMap({})), render: () => lock };
export const LockedOn: Story = {
  ...handlersOf(globalMap({}), schoolMap({ fees: { on: false, lock: 'on' } })),
  render: () => lock,
};
export const LockPlatformOff: Story = {
  ...handlersOf(globalMap({ homework: false }), schoolMap({ homework: { on: true } })),
  render: () => lock,
};
export const LockSaving: Story = {
  ...handlersOf(
    globalMap({}),
    schoolMap({}),
    http.put('*/platform/schools/:id/modules/:key/lock', async () => {
      await delay('infinite');
      return HttpResponse.json({});
    }),
  ),
  render: () => lock,
};
export const LockError: Story = {
  ...handlersOf(globalMap({}), schoolMap({}), failing('put')),
  render: () => lock,
};
export const Lock390: Story = {
  ...handlersOf(globalMap({}), schoolMap({ fees: { lock: 'off' } })),
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    msw: { handlers: [globalMap({}), schoolMap({ fees: { lock: 'off' } })] },
  },
  render: () => lock,
};

export const GlobalAllOn: Story = {
  ...handlersOf(globalMap({})),
  render: () => <GlobalModulesCard />,
};
export const GlobalSomeOff: Story = {
  ...handlersOf(globalMap({ website: false, messaging: false })),
  render: () => <GlobalModulesCard />,
};
export const GlobalError: Story = {
  ...handlersOf(
    http.get('*/platform/modules', () => HttpResponse.json({ statusCode: 500 }, { status: 500 })),
  ),
  render: () => <GlobalModulesCard />,
};
