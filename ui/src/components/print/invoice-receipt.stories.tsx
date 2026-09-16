import type { Meta, StoryObj } from '@storybook/react-vite';

import { REGION_BD_EN } from '../../i18n/region-config';

import { InvoiceReceipt, type InvoiceReceiptData } from './invoice-receipt';

const meta: Meta<typeof InvoiceReceipt> = {
  title: 'Print/InvoiceReceipt',
  component: InvoiceReceipt,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof InvoiceReceipt>;

const LABELS = {
  creditNote: 'Credit note',
  issuedDate: 'Issue date',
  billed: 'Billed',
  discount: 'Discount',
  paid: 'Paid',
  change: 'Change',
  paymentMethod: 'Payment method',
  paymentDate: 'Payment date',
};

const RECEIPT: InvoiceReceiptData = {
  invoice_number: 'INV-2026-000123',
  issued_date: '2026-09-01',
  school: {
    name: 'Ananta High School',
    address: '123 Green Road, Dhaka-1205',
    logo_url: 'https://placehold.co/56x56/png?text=Logo',
  },
  students: [
    {
      full_name: 'Rahim Ahmed',
      class_name: 'Class 5-A',
      lines: [
        {
          fee_name: 'Monthly Tuition',
          period_label: 'September 2026',
          amount: 5000,
          discount: 500,
          paid_this_time: 4500,
          balance_after: 0,
        },
      ],
    },
  ],
  totals: { billed: 5000, discount: 500, paid: 4500, change: 0 },
  payment: { method: 'CASH', reference_last4: null, payment_date: '2026-09-01' },
};

export const A4: Story = {
  args: { receipt: RECEIPT, width: 'a4', config: REGION_BD_EN, labels: LABELS },
};

export const Pos80: Story = {
  args: { receipt: RECEIPT, width: 'pos80', config: REGION_BD_EN, labels: LABELS },
};

export const Pos58: Story = {
  args: { receipt: RECEIPT, width: 'pos58', config: REGION_BD_EN, labels: LABELS },
};

export const CreditNote: Story = {
  args: {
    receipt: { ...RECEIPT, invoice_number: 'CN-2026-000045', kind: 'CREDIT_NOTE' },
    width: 'a4',
    config: REGION_BD_EN,
    labels: LABELS,
  },
};

export const NoLogo: Story = {
  args: {
    receipt: { ...RECEIPT, school: { ...RECEIPT.school, logo_url: null } },
    width: 'a4',
    config: REGION_BD_EN,
    labels: LABELS,
  },
};

/** Multi-student (sibling) checkout — every paying student gets their own
 * line group under one shared invoice. */
export const MultiStudent: Story = {
  args: {
    receipt: {
      ...RECEIPT,
      students: [
        ...RECEIPT.students,
        {
          full_name: 'Karim Ahmed',
          class_name: 'Class 3-B',
          lines: [
            {
              fee_name: 'Monthly Tuition',
              period_label: 'September 2026',
              amount: 4000,
              discount: 0,
              paid_this_time: 4000,
              balance_after: 0,
            },
          ],
        },
      ],
      totals: { billed: 9000, discount: 500, paid: 8500, change: 0 },
    },
    width: 'a4',
    config: REGION_BD_EN,
    labels: LABELS,
  },
};

/** Long names overflowing the narrow POS 58mm container — nothing in this
 * component truncates them, so this documents how the layout copes. */
export const LongNames: Story = {
  args: {
    receipt: {
      ...RECEIPT,
      students: [
        {
          ...RECEIPT.students[0]!,
          full_name: 'Mohammad Abdur Rahman Chowdhury Al-Hasan Miah',
        },
      ],
      school: {
        ...RECEIPT.school,
        name: 'The International Ananta Memorial Higher Secondary School and College',
      },
    },
    width: 'pos58',
    config: REGION_BD_EN,
    labels: LABELS,
  },
};
