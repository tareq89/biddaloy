import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { Button } from './button';
import { toast, Toaster } from './toast';

const meta: Meta<typeof Toaster> = {
  title: 'Components/Toast',
  tags: ['autodocs'],
  decorators: [
    (StoryFn) => (
      <>
        <StoryFn />
        <Toaster />
      </>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Toaster>;

export const Default: Story = {
  render: () => (
    <Button type="button" onClick={() => toast('Fee structure created')}>
      Show toast
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Show toast' }));
  },
};

export const SuccessVariant: Story = {
  render: () => (
    <Button type="button" onClick={() => toast.success('Payment recorded')}>
      Show success toast
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Show success toast' }));
  },
};

/** Stands in for this issue's "error" state category. */
export const ErrorVariant: Story = {
  render: () => (
    <Button type="button" onClick={() => toast.error('Failed to record payment')}>
      Show error toast
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Show error toast' }));
  },
};

/**
 * [8.12.2]'s update prompt as `client-admin` raises it (`src/pwa/update-
 * prompt.ts`): persistent rather than timed, because it waits for a
 * decision instead of expiring mid-payment, with a Reload action and the
 * `Toaster`'s own close button as the dismiss affordance.
 */
export const UpdateAvailable: Story = {
  render: () => (
    <Button
      type="button"
      onClick={() =>
        toast('A new version of the app is available.', {
          id: 'app-update',
          duration: Number.POSITIVE_INFINITY,
          action: { label: 'Reload', onClick: () => {} },
        })
      }
    >
      Show update prompt
    </Button>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Show update prompt' }));
  },
};
