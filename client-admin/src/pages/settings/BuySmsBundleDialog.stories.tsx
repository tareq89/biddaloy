/** [100.4.02] The buy dialog: form, refusals, and the pay step. Package values are sample data. */
import type { SmsBundleOrder, SmsPackage } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { BuySmsBundleDialog } from './BuySmsBundleDialog';

const packages: SmsPackage[] = [
  ['Small', 500, 90, '50000'],
  ['Medium', 2000, 180, '180000'],
].map(([name, smsCount, validityDays, pricePaisa], i) => ({
  id: `00000000-0000-4000-8000-00000000010${i}`,
  name: String(name),
  smsCount: Number(smsCount),
  validityDays: Number(validityDays),
  pricePaisa: String(pricePaisa),
  priceTaka: String(Number(pricePaisa) / 100),
  active: true,
}));
const created: SmsBundleOrder = {
  id: '00000000-0000-4000-8000-0000000002aa',
  packageId: packages[1]!.id,
  name: 'Medium',
  smsCount: 2000,
  validityDays: 180,
  pricePaisa: '180000',
  costPaisaPerSms: null,
  status: 'PENDING_PAYMENT',
  createdAt: '2026-11-14T00:00:00Z',
  paidAt: null,
  cancelledAt: null,
};

const meta = {
  title: 'client-admin/settings/BuySmsBundleDialog',
  component: BuySmsBundleDialog,
  args: {
    open: true,
    onOpenChange: () => undefined,
    packages,
    selected: packages[1]!,
    onSelect: () => undefined,
    onSubmit: () => undefined,
    onPay: () => undefined,
  },
} satisfies Meta<typeof BuySmsBundleDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Form: Story = {};
export const Creating: Story = { args: { pending: true } };
export const CannotSellNow: Story = { args: { failure: 'paused' } };
export const TryAgain: Story = { args: { failure: 'other' } };
export const ReadyToPay: Story = { args: { created } };
export const PayFailed: Story = { args: { created, payFailed: true } };
