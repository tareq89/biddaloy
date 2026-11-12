import type { Meta, StoryObj } from '@storybook/react-vite';

import { OverviewTab } from './overview-tab';
import { PeopleTab } from './people-tab';

/** #3820 School 360 Overview and People tabs. Data comes from the default cockpit mock handlers. */
const meta: Meta = { title: 'Cockpit/School 360 shell' };
export default meta;
type Story = StoryObj;

const phone = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

export const Overview1440: Story = { render: () => <OverviewTab schoolId="s-1" /> };
export const Overview390: Story = { ...phone, render: () => <OverviewTab schoolId="s-1" /> };
export const People1440: Story = {
  render: () => <PeopleTab schoolId="s-1" onLoginAs={() => undefined} />,
};
export const People390: Story = {
  ...phone,
  render: () => <PeopleTab schoolId="s-1" onLoginAs={() => undefined} />,
};
