import type { SmsCreditLedgerItem } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SmsCreditSectionView } from './SmsCreditSectionView';

function ledgerItem(overrides: Partial<SmsCreditLedgerItem> = {}): SmsCreditLedgerItem {
  return {
    id: crypto.randomUUID(),
    kind: 'GRANT',
    units: 500,
    reference_type: 'manual',
    reference_id: null,
    reason: 'Initial top-up',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const meta: Meta<typeof SmsCreditSectionView> = {
  component: SmsCreditSectionView,
  args: {
    loading: false,
    page: 1,
    pageSize: 10,
    onPageChange: () => undefined,
    onRetry: () => undefined,
  },
};
export default meta;

type Story = StoryObj<typeof SmsCreditSectionView>;

export const OffMode: Story = {
  args: {
    credits: {
      metering: 'OFF',
      available: 0,
      reserved: 0,
      ledger: { data: [], total: 0, page: 1, limit: 10, totalPages: 1 },
    },
  },
};

export const PlatformSufficient: Story = {
  args: {
    credits: {
      metering: 'PLATFORM',
      available: 488,
      reserved: 0,
      ledger: {
        data: [ledgerItem(), ledgerItem({ kind: 'DEBIT', units: -12, reason: null })],
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    },
  },
};

export const PlatformShort: Story = {
  args: {
    credits: {
      metering: 'PLATFORM',
      available: 3,
      reserved: 0,
      ledger: {
        data: [ledgerItem({ kind: 'DEBIT', units: -497, reason: null })],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    },
  },
};

export const LedgerPopulated: Story = {
  args: {
    credits: {
      metering: 'PLATFORM',
      available: 200,
      reserved: 10,
      ledger: {
        data: [
          ledgerItem(),
          ledgerItem({
            kind: 'RESERVE',
            units: -8,
            reference_type: 'batch',
            reference_id: crypto.randomUUID(),
            reason: null,
          }),
          ledgerItem({
            kind: 'DEBIT',
            units: -4,
            reference_type: 'batch',
            reference_id: crypto.randomUUID(),
            reason: null,
          }),
        ],
        total: 3,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    },
  },
};

export const LedgerEmpty: Story = {
  args: {
    credits: {
      metering: 'PLATFORM',
      available: 500,
      reserved: 0,
      ledger: { data: [], total: 0, page: 1, limit: 10, totalPages: 1 },
    },
  },
};

export const Loading: Story = {
  args: { loading: true },
};

export const LoadError: Story = {
  args: { loading: false, error: true },
};
