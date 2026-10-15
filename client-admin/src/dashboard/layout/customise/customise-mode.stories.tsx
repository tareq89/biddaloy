import { UserRole } from '@biddaloy/shared';
import { setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { CustomiseMode } from './customise-mode';

setActiveRole('EXECUTIVE');

const user = http.get('/api/v1/users/me', () => HttpResponse.json({ id: 'u1', preferences: null }));

const meta: Meta<typeof CustomiseMode> = {
  title: 'Dashboard/CustomiseMode',
  component: CustomiseMode,
  args: { role: UserRole.EXECUTIVE, onDone: () => undefined },
  parameters: { msw: { handlers: [user] } },
};
export default meta;
type Story = StoryObj<typeof CustomiseMode>;

export const Desktop: Story = {};

/** Tab into the list: the focused row's preview card is outlined. */
export const RowFocused: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>('[role="checkbox"]')?.focus();
  },
};

export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };

export const SaveError: Story = {
  parameters: {
    msw: {
      handlers: [
        user,
        http.patch('/api/v1/users/me/preferences/dashboard', () =>
          HttpResponse.json({ message: 'Too many widgets' }, { status: 400 }),
        ),
      ],
    },
  },
  play: ({ canvasElement }) => {
    const save = [...canvasElement.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save',
    );
    save?.click();
  },
};
