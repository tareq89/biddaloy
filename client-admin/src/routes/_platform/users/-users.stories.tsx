import type { PlatformUserItem } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { UserResults } from './-user-results';

/** Mockup "Users" at 1440 px (desktop) and 390 px (phone cards). */
const viewports = {
  desktop1440: { name: 'Desktop 1440', styles: { width: '1440px', height: '900px' } },
  phone390: { name: 'Phone 390', styles: { width: '390px', height: '844px' } },
};
const at = (defaultViewport: keyof typeof viewports) => ({
  parameters: { viewport: { viewports, defaultViewport } },
});

const meta: Meta<typeof UserResults> = {
  component: UserResults,
  args: {
    loading: false,
    error: false,
    onRetry: () => {},
    onLoginAs: () => {},
    onLogout: () => {},
  },
  ...at('desktop1440'),
};
export default meta;

type Story = StoryObj<typeof UserResults>;

const USERS: PlatformUserItem[] = [
  {
    userId: '00000000-0000-4000-8000-000000000001',
    fullName: 'Rahim Uddin',
    emailMasked: 'r***@example.test',
    phoneMasked: '017****001',
    status: 'ACTIVE',
    locked: false,
    lastLoginAt: '2026-11-10T00:00:00.000Z',
    memberships: [
      { memberId: 'm1', schoolId: 's1', schoolName: 'Green Valley', role: 'TEACHER' },
      { memberId: 'm2', schoolId: 's2', schoolName: 'Sunrise', role: 'PARENT' },
    ],
  },
  {
    userId: '00000000-0000-4000-8000-000000000002',
    fullName: 'Karim Hasan',
    emailMasked: null,
    phoneMasked: '018****002',
    status: 'SUSPENDED',
    locked: true,
    lastLoginAt: null,
    memberships: [{ memberId: 'm3', schoolId: 's1', schoolName: 'Green Valley', role: 'STUDENT' }],
  },
];

export const Populated: Story = { args: { users: USERS } };
export const PopulatedPhone: Story = { args: { users: USERS }, ...at('phone390') };
export const Empty: Story = { args: { users: [] } };
export const EmptyPhone: Story = { args: { users: [] }, ...at('phone390') };
export const Loading: Story = { args: { users: [], loading: true } };
export const ErrorState: Story = { args: { users: [], error: true } };
