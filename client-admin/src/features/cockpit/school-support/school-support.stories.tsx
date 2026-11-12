import type { Meta, StoryObj } from '@storybook/react-vite';

import { HealthTab } from './health-tab';
import { NotesTab } from './notes-tab';
import { SupportAccessTab } from './support-access-tab';

/** #3822 School 360 tabs at phone width (390 px). Data comes from the default cockpit mock handlers. */
const meta: Meta = {
  title: 'Cockpit/School 360 tabs',
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export default meta;
type Story = StoryObj;

export const SupportAccess: Story = {
  render: () => <SupportAccessTab schoolId="s-1" onLoginAs={() => undefined} />,
};
export const Notes: Story = {
  render: () => <NotesTab schoolId="s-1" currentUserId="me" />,
};
export const Health: Story = {
  render: () => <HealthTab schoolId="s-1" />,
};
