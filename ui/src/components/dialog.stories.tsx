import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog';

const meta: Meta<typeof Dialog> = {
  title: 'Components/Dialog',
  component: Dialog,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Dialog>;

function RecordPaymentDialog({ loading = false }: { loading?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>Enter the amount received for this invoice.</DialogDescription>
        </DialogHeader>
        <input aria-label="Amount" placeholder="0.00" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button loading={loading}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const Default: Story = {
  render: () => <RecordPaymentDialog />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Record payment' }));
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog');
    await expect(
      within(dialog).getByRole('heading', { name: 'Record a payment' }),
    ).toBeInTheDocument();
  },
};

export const Loading: Story = {
  name: 'Loading (confirm in flight)',
  render: () => <RecordPaymentDialog loading />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Record payment' }));
  },
};

/** Stands in for this issue's "empty" state category — a dialog with no
 * description or secondary actions, the minimal real dialog shape. */
export const Empty: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Confirm sign out</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign out?</DialogTitle>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button variant="destructive">Sign out</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/** Stands in for this issue's "error" state category. */
export const ErrorState: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button>Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>Enter the amount received for this invoice.</DialogDescription>
        </DialogHeader>
        <input aria-label="Amount" aria-invalid defaultValue="-50" />
        <p role="alert" className="text-sm text-destructive">
          Amount must be greater than zero.
        </p>
        <DialogFooter>
          <Button>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

/** `Disabled` doesn't apply to a dialog itself (only to controls inside
 * it, already covered by `Button`'s own `Disabled` story) — a dialog is
 * either open or not, there's no third "disabled" state of the dialog as
 * a whole. This story instead shows the trigger disabled, which is the
 * realistic call site for "disabled dialog". */
export const TriggerDisabled: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled>Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  ),
};

export const RightToLeft: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button>পেমেন্ট রেকর্ড করুন</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>একটি পেমেন্ট রেকর্ড করুন</DialogTitle>
          <DialogDescription>প্রাপ্ত পরিমাণ লিখুন।</DialogDescription>
        </DialogHeader>
        <input aria-label="পরিমাণ" placeholder="০.০০" />
      </DialogContent>
    </Dialog>
  ),
  decorators: [rtlDecorator],
};
