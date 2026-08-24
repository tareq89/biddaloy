import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

const ROWS = [
  { month: 'January 2026', amount: '৳500.00', status: 'Paid' },
  { month: 'February 2026', amount: '৳500.00', status: 'Pending' },
];

function Demo() {
  return (
    <Table>
      <TableCaption>A student&apos;s fee breakdown</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.month}>
            <TableCell>{row.month}</TableCell>
            <TableCell>{row.amount}</TableCell>
            <TableCell>{row.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const meta: Meta<typeof Demo> = {
  title: 'Components/Table',
  component: Demo,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Demo>;

export const Default: Story = {};

export const Empty: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell colSpan={3} className="text-center text-muted-foreground">
            No fees recorded yet.
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>মাস</TableHead>
          <TableHead>পরিমাণ</TableHead>
          <TableHead>অবস্থা</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>জানুয়ারি ২০২৬</TableCell>
          <TableCell>৳৫০০.০০</TableCell>
          <TableCell>পরিশোধিত</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};
