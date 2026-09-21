import type { Meta, StoryObj } from '@storybook/react-vite';

import { OrganisationSection } from './OrganisationSection';

/**
 * [33.4.1]'s "Shift, version & group" settings section. Same
 * "client-admin isn't globbed into a running Storybook instance yet" gap
 * `CalendarSection.stories.tsx` notes — written anyway, following that
 * precedent.
 */
const meta: Meta<typeof OrganisationSection> = {
  component: OrganisationSection,
  args: {
    schoolId: 'school-1',
  },
};
export default meta;

type Story = StoryObj<typeof OrganisationSection>;

export const Empty: Story = {
  args: {
    organisation: { shifts: [], versions: [], groups: [] },
  },
};

export const Populated: Story = {
  args: {
    organisation: {
      shifts: ['Morning', 'Day'],
      versions: ['Bangla', 'English'],
      groups: ['Science', 'Commerce', 'Arts'],
    },
  },
};
