/**
 * No loading/error variants — `BottomNav` renders a fixed list of routes
 * and holds no data of its own.
 *
 * Rendered as SUPER_ADMIN by default in Storybook (no auth-state seeded),
 * so every permissioned item shows through `hasPermission`'s fail-open-
 * for-SUPER_ADMIN mapping. The two states a story therefore can't show —
 * an item hidden from a PARENT, and the bar rendering nothing at all when
 * the role can see none of its items — are covered in
 * `bottom-nav.test.tsx`, which seeds auth-state directly.
 */
import { Permission } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CreditCardIcon, HomeIcon } from 'lucide-react';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { BottomNav } from './bottom-nav';

const items = [
  {
    to: '/portal',
    label: 'Overview',
    icon: <HomeIcon className="size-5" aria-hidden="true" />,
    permission: Permission.FEE_READ,
  },
  {
    to: '/portal/fees',
    label: 'Fees and invoices',
    icon: <CreditCardIcon className="size-5" aria-hidden="true" />,
    permission: Permission.INVOICE_READ,
  },
];

const meta: Meta<typeof BottomNav> = {
  title: 'Components/BottomNav',
  component: BottomNav,
  tags: ['autodocs'],
  args: { items, label: 'Portal' },
  decorators: [withMemoryRouter(['/portal'])],
};

export default meta;
type Story = StoryObj<typeof BottomNav>;

/** Overview is the active route — `aria-current="page"` plus the primary
 * colour, so the state is never carried by colour alone. */
export const Default: Story = {};

export const FeesActive: Story = {
  decorators: [withMemoryRouter(['/portal/fees'])],
};

/** `viewport` narrows the canvas to the width this bar actually ships at —
 * it is `md:hidden` inside `AppShell`. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/** Icons are optional — the label alone is what carries meaning, so an
 * item without one is a supported, not degraded, state. */
export const WithoutIcons: Story = {
  args: {
    items: items.map((item) => ({ to: item.to, label: item.label, permission: item.permission })),
  },
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};
