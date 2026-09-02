/**
 * `UserMenu` is presentational only — the loading/error split its caller
 * (`client-admin/src/components/staff-user-menu.tsx`) makes off a real
 * `/users/me` query collapses, in this component's own props, to a single
 * `name === undefined` boolean (`Loading` story). `WithProfileItem` shows
 * what `staff-user-menu.tsx` actually renders in the `profileItem` slot
 * today — a disabled "coming soon" placeholder, per the ticket's
 * user-approved deviation from its own published plan (see that file's
 * own header comment).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { MenuItem } from './menu';
import { UserMenu } from './user-menu';

const meta: Meta<typeof UserMenu> = {
  title: 'Components/UserMenu',
  component: UserMenu,
  tags: ['autodocs'],
  args: {
    name: 'Rahim Uddin',
    roleLabel: 'Accountant',
    onSignOut: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof UserMenu>;

async function openMenu({ canvasElement }: { canvasElement: HTMLElement }) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button'));
}

export const Default: Story = {
  play: openMenu,
};

/** `name` is `undefined` while the caller's `/users/me` query is in
 * flight (or failed) — the trigger and menu label both fall back rather
 * than blocking on the fetch, so a signed-in user never loses their only
 * sign-out control to a slow or failed name lookup. */
export const Loading: Story = {
  args: { name: undefined },
  play: openMenu,
};

/** What `staff-user-menu.tsx` renders in the `profileItem` slot today — a
 * disabled placeholder communicating "not built yet" rather than a real
 * destination, since no staff profile route exists on `main` (see the
 * published plan's "Plan corrections" #2 and this ticket's user-approved
 * deviation). */
export const WithProfileItem: Story = {
  args: {
    profileItem: (
      <MenuItem disabled>
        Profile <span className="text-muted-foreground">(coming soon)</span>
      </MenuItem>
    ),
  },
  play: openMenu,
};

export const SigningOut: Story = {
  args: { signingOut: true },
  play: openMenu,
};

export const LongName: Story = {
  args: { name: 'Mohammad Abdul Karim Chowdhury Rahman', roleLabel: 'Executive' },
  play: openMenu,
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
  play: openMenu,
};
