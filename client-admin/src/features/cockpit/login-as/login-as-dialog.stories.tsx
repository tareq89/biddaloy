import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { LoginAsDialog } from './login-as-dialog';
import { NoAdminState } from './no-admin-state';
import { WaitingState } from './waiting-state';

/**
 * [99.W5] Login as dialog. Each state at 390 px (phone width), the width the mockup calls out.
 * The people list is served by MSW so the stories need no server.
 */
const people = [
  {
    userId: 'a1',
    name: 'Rahim Uddin',
    role: 'ADMIN',
    email: 'rahim@example.test',
    phone: null,
    unavailableReason: null,
  },
  {
    userId: null,
    name: 'Rafi Hasan',
    role: 'ADMIN',
    email: null,
    phone: null,
    unavailableReason: 'NO_LOGIN_ACCOUNT',
  },
];
const candidates = (over: Record<string, unknown>) =>
  http.get('*/platform/schools/:id/login-as/candidates', () =>
    HttpResponse.json({
      candidates: people,
      noActiveAdmin: false,
      schoolStatus: 'ACTIVE',
      supportAccessMode: 'allowed',
      ...over,
    }),
  );

const meta: Meta<typeof LoginAsDialog> = {
  component: LoginAsDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    onInviteAdmin: () => {},
    schoolId: '00000000-0000-4000-8000-000000000001',
    schoolName: 'Green Valley',
  },
  parameters: { viewport: { defaultViewport: 'mobile1' }, msw: { handlers: [candidates({})] } },
};
export default meta;
type Story = StoryObj<typeof LoginAsDialog>;

export const Default: Story = {
  args: { schoolNote: 'Principal prefers calls after 4 pm' },
};

export const BlockedSchool: Story = {
  parameters: { msw: { handlers: [candidates({ supportAccessMode: 'blocked' })] } },
};

export const NoActiveAdmin: Story = {
  parameters: { msw: { handlers: [candidates({ noActiveAdmin: true, candidates: [] })] } },
};

export const PersonWithoutLogin: Story = {
  parameters: { msw: { handlers: [candidates({ candidates: [people[1]] })] } },
};

export const WaitingForApproval: StoryObj<typeof WaitingState> = {
  render: () => <WaitingState ownerWait={false} onCancel={() => {}} />,
};

export const WaitingForOtherOwner: StoryObj<typeof WaitingState> = {
  render: () => <WaitingState ownerWait onCancel={() => {}} />,
};

export const NoAdminCard: StoryObj<typeof NoAdminState> = {
  render: () => <NoAdminState onInvite={() => {}} />,
};
