/**
 * [24.3.5] `RoleCard` states: a tenant-wide role with a long permission
 * list, the narrowest staff role (COMMITTEE), a section-scoped role
 * (TEACHER), and Bangla.
 */
import { UserRole } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { RoleCard } from './-role-card';

const meta: Meta<typeof RoleCard> = {
  title: 'Staff/RoleCard',
  component: RoleCard,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof RoleCard>;

export const Admin: Story = { args: { role: UserRole.ADMIN } };
export const Committee: Story = { args: { role: UserRole.COMMITTEE } };
export const TeacherSectionScoped: Story = { args: { role: UserRole.TEACHER } };
export const OfficeStaff: Story = { args: { role: UserRole.OFFICE_STAFF } };
