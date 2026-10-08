import type { Meta, StoryObj } from '@storybook/react-vite';

import type { IssuerSnapshot } from '../issuer-header';

import {
  InvigilatorSheet,
  SeatListSheet,
  SeatStickerSheet,
  type RoomSitting,
} from './seat-plan-sheets';

const meta: Meta = { title: 'Print/ExamDocuments/SeatPlanSheets', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: 'অনন্ত উচ্চ বিদ্যালয়',
  address: '123 Green Road, Dhaka-1205',
  phone: '01700000000',
  email: null,
  registration_id: '123456',
  logo_key: null,
};

const room = (name: string, n: number): RoomSitting => ({
  room: name,
  sitting: 'Sunday, 18 Oct · Bangla 1st paper · 10:00 – 1:00',
  note: `Sections A & B · ${n}`,
  invigilator: 'Mr Karim',
  rows: Array.from({ length: n }, (_, i) => ({
    seat: String(i + 1),
    roll: i + 1,
    name: `Student number ${i + 1}`,
    section: i % 2 ? 'B' : 'A',
  })),
});

const base = {
  issuer: ISSUER,
  examName: 'Half Yearly 2026',
  className: 'Class 6',
  printedOn: 'Printed: 8 Oct 2026',
};

const LIST = {
  room: 'Room',
  seats: 'Seats {{first}}–{{last}}',
  seat: 'Seat',
  roll: 'Roll',
  name: 'Name',
  section: 'Section',
  fromSeatPlan: 'Made from the seat plan',
  pageOf: 'Page {{page}} / {{total}}',
};

export const SeatList40: Story = {
  render: () => <SeatListSheet {...base} pages={[room('101', 40)]} labels={LIST} />,
};

export const SeatListTwoRooms: Story = {
  render: () => (
    <SeatListSheet {...base} pages={[room('101', 40), room('204', 28)]} labels={LIST} />
  ),
};

export const Invigilator: Story = {
  render: () => (
    <InvigilatorSheet
      {...base}
      pages={[room('101', 30)]}
      labels={{
        room: 'Room',
        seat: 'Seat',
        roll: 'Roll',
        name: 'Name',
        section: 'Section',
        present: 'Present',
        scriptNo: 'Script no.',
        signature: 'Signature',
        invigilator: 'Invigilator',
      }}
    />
  ),
};

export const Stickers45: Story = {
  render: () => (
    <SeatStickerSheet
      issuer={ISSUER}
      labels={{ roll: 'Roll', room: 'Room', seat: 'Seat' }}
      stickers={Array.from({ length: 45 }, (_, i) => ({
        seat: String(i + 1),
        roll: i + 1,
        name: `Student number ${i + 1}`,
        section: 'A',
        className: 'Class 6',
        room: '101',
      }))}
    />
  ),
};
