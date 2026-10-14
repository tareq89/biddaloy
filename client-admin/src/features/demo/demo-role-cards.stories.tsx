import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { DemoRoleCards } from './demo-role-cards';
import type { DemoRoleCard } from './use-demo-mode';

const CARDS: DemoRoleCard[] = [
  ['admin', 'ADMIN', 'admin@bmsc.example', 'bmsc-high', 'dashboard'],
  ['principal', 'EXECUTIVE', 'principal@bmsc.example', 'bmsc-high', 'overview'],
  ['accountant', 'ACCOUNTANT', 'accountant@bmsc.example', 'bmsc-high', 'fees'],
  ['class-teacher-8a', 'TEACHER', 'teacher8a@bmsc.example', 'bmsc-high', 'attendance'],
  ['guardian', 'PARENT', 'guardian@bmsc.example', 'bmsc-primary', 'children'],
  ['student-9b', 'STUDENT', 'student9b@bmsc.example', 'bmsc-high', 'homework'],
].map(([key, role, email, branchSlug, tryKey]) => ({
  key: key!,
  role: role!,
  email: email!,
  branchSlug: branchSlug!,
  tryKey: tryKey!,
  nameEn: key!,
  nameBn: key!,
}));

const meta = {
  title: 'Demo/DemoRoleCards',
  component: DemoRoleCards,
  args: { cards: CARDS, onPick: fn() },
} satisfies Meta<typeof DemoRoleCards>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Admin card comes first, outlined, and holds keyboard focus. */
export const Default: Story = {};

/** A card was picked and the sign-in is running: every card is disabled. */
export const SigningIn: Story = { args: { disabled: true } };
