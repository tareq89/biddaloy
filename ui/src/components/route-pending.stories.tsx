import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { RoutePending } from './route-pending';

/** A slice of `AppShell`'s chrome — just enough sticky-header shape for a
 * reviewer to see the skeleton sitting where `#main-content` actually
 * renders, without pulling in the whole shell (session, sidebar state,
 * router) a real `AppShell` story would need. */
function MockShellFrame({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-3xl border border-border-subtle">
      <div className="flex h-14 items-center border-b border-border-subtle bg-surface px-4 text-sm text-muted-foreground">
        Biddaloy — sticky header (does not move or fade)
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

const meta: Meta<typeof RoutePending> = {
  title: 'Components/RoutePending',
  component: RoutePending,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <MockShellFrame>
        <Story />
      </MockShellFrame>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof RoutePending>;

/** `main.tsx`'s router-wide `defaultPendingComponent` fallback and every
 * `_staff/…/index.tsx` list route's own `pendingComponent` override. */
export const List: Story = {
  args: { variant: 'list', label: 'Loading' },
};

/** Every `_staff/…/$id.tsx` detail route's `pendingComponent`. */
export const Detail: Story = {
  args: { variant: 'detail', label: 'Loading' },
};

/** Every create/edit form route's `pendingComponent` (e.g.
 * `_staff/students/new.tsx`, `_staff/payments/record.tsx`). */
export const Form: Story = {
  args: { variant: 'form', label: 'Loading' },
};

/** Proves the visually-hidden status label is really translated —
 * switch the Storybook locale toolbar to `bn` and the announced text
 * (visible in the a11y addon, not on screen) changes with it. */
export const Bengali: Story = {
  args: { variant: 'list', label: 'লোড হচ্ছে' },
  globals: { locale: 'bn' },
};

export const Dark: Story = {
  args: { variant: 'detail', label: 'Loading' },
  decorators: [darkDecorator],
  parameters: darkDecoratorParameters,
};
