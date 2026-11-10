import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { RecoveryCodesCard } from './recovery-codes-card';

const meta: Meta<typeof RecoveryCodesCard> = {
  title: 'Components/RecoveryCodesCard',
  component: RecoveryCodesCard,
  tags: ['autodocs'],
  args: {
    codes: [
      'ABCD-EFGH-JKLM-NPQR',
      'STUV-WXYZ-2345-6789',
      'ABCD-2345-EFGH-6789',
      'JKLM-6789-NPQR-2345',
      'STUV-2345-WXYZ-6789',
      'ABCD-6789-JKLM-2345',
      'EFGH-2345-NPQR-6789',
      'WXYZ-6789-STUV-2345',
    ],
    labels: {
      title: 'Save your recovery codes',
      description: 'Keep these somewhere safe. Each code works once if you lose your phone.',
      copy: 'Copy codes',
      copied: 'Copied',
      download: 'Download .txt',
      acknowledge: 'I have saved these codes',
    },
    onAcknowledged: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof RecoveryCodesCard>;

export const Default: Story = {};

export const Rtl: Story = { decorators: [rtlDecorator] };
