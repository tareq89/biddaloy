import type { Meta, StoryObj } from '@storybook/react-vite';

import { A4Document } from './a4-document';
import type { IssuerSnapshot } from './issuer-header';

const meta: Meta<typeof A4Document> = {
  title: 'Print/A4Document',
  component: A4Document,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof A4Document>;

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: 'অনন্ত উচ্চ বিদ্যালয়',
  address: '123 Green Road, Dhaka-1205',
  phone: '01700000000',
  email: null,
  registration_id: '123456',
  logo_key: null,
};

const rows = Array.from({ length: 40 }, (_, i) => i + 1);
const table = (
  <table className="w-full border-collapse">
    <thead>
      <tr className="border-b text-text-secondary">
        <th className="py-1 text-start">Roll</th>
        <th className="py-1 text-start">Name</th>
        <th className="py-1 text-start">Seat</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((n) => (
        <tr key={n} className="border-b border-border-subtle">
          <td className="py-1">{n}</td>
          <td className="py-1">Student {n}</td>
          <td className="py-1">A-{n}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

export const SeatList: Story = {
  args: {
    issuer: ISSUER,
    title: 'Seat plan — First Term 2026',
    subtitle: 'Class 8 · Room 204',
    signatures: ['Class teacher', 'Head teacher'],
    printedOn: '8 October 2026',
    children: table,
  },
};
export const Landscape: Story = { args: { ...SeatList.args, orientation: 'landscape' } };
