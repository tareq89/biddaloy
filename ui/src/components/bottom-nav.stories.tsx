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
import type { CSSProperties } from 'react';
import { expect, userEvent, within } from 'storybook/test';

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

// [8.14.3]: `more` included so the trailing cell's icon/label mirror flip
// (the same `dir="rtl"` concern every other cell in this bar already
// covers) gets checked too, not just the two `Link` cells.
export const RightToLeft: Story = {
  args: { more: { label: 'More' } },
  decorators: [rtlDecorator],
};

// [8.14.3] — staff shape: 4 destinations + a trailing `more` cell (5 cells
// total, the cap `bottom-nav.tsx`'s own header comment documents), rather
// than the portal's plain 2-3 item bar above.
const staffItems = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: <HomeIcon className="size-5" aria-hidden="true" />,
  },
  {
    to: '/students',
    label: 'Students',
    icon: <CreditCardIcon className="size-5" aria-hidden="true" />,
    permission: Permission.STUDENT_READ,
  },
  {
    to: '/fees/dues',
    label: 'Student Dues',
    icon: <CreditCardIcon className="size-5" aria-hidden="true" />,
    permission: Permission.FEE_COLLECT,
  },
  {
    to: '/payments/record',
    label: 'Record Payment',
    icon: <CreditCardIcon className="size-5" aria-hidden="true" />,
    permission: Permission.PAYMENT_RECORD,
  },
];

/** The staff shape this ticket adds: four permission-gated destinations
 * plus `more`, which opens `AppShell`'s own drawer (`useAppShellDrawer`) —
 * inert here since there is no `AppShell` ancestor in this story. */
export const StaffFiveItems: Story = {
  args: {
    items: staffItems,
    label: 'Quick navigation',
    more: { label: 'More' },
  },
  decorators: [withMemoryRouter(['/dashboard'])],
};

/** `more`'s pressed/expanded state — `aria-haspopup="dialog"` plus
 * `aria-expanded`, the same pattern any disclosure control in
 * `@biddaloy/ui` uses. Without a real `AppShell` ancestor here,
 * `useAppShellDrawer()` falls back to its inert default (`isOpen: false`),
 * so `open()` is a no-op and `aria-expanded` never flips true on its own —
 * the `play` function below documents that the click itself still fires
 * cleanly (no throw) even with no drawer to open. */
export const WithMoreAction: Story = {
  args: {
    items: staffItems,
    label: 'Quick navigation',
    more: { label: 'More' },
  },
  decorators: [withMemoryRouter(['/dashboard'])],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const more = canvas.getByRole('button', { name: 'More' });
    await expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    // No `AppShell` ancestor in this story — see the comment above — so
    // this pins the inert-context behavior, not a live open transition.
    await expect(more).toHaveAttribute('aria-expanded', 'false');
  },
};

/** Documents the `pb-(--safe-area-bottom)` token this bar always carries
 * (`ui/src/styles/globals.css`) by setting it to a non-zero value the way
 * an installed, `viewport-fit=cover` PWA on a gesture-nav device would —
 * `env()` itself can't be forced from a story, so this simulates its
 * resolved value instead. */
export const SafeAreaInset: Story = {
  args: { items: staffItems, label: 'Quick navigation', more: { label: 'More' } },
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div style={{ '--safe-area-bottom': '34px' } as CSSProperties}>
        <Story />
      </div>
    ),
  ],
};
