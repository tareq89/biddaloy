import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';

import { withMemoryRouter } from '../../../../ui/.storybook/router-decorator';

import { AttendanceHeatmapCard } from './-attendance-heatmap-card';

const KIDS = [
  { id: 'kid-a', fullName: 'Fatima Rahman' },
  { id: 'kid-b', fullName: 'Imran Rahman' },
];

/** November 2026: 1-22 school days, absent on the 11th, the rest not yet marked. */
const month = Array.from({ length: 30 }, (_, i) => {
  const day = i + 1;
  return {
    date: `2026-11-${String(day).padStart(2, '0')}`,
    status: day <= 23 ? (day === 11 ? 'ABSENT' : day === 5 ? 'LATE' : 'PRESENT') : null,
    minutes_late: day === 5 ? 12 : null,
    remarks: null,
    is_working_day: day % 7 !== 5 && day % 7 !== 6,
    holiday_name: null,
    marked_at: null,
  };
});

function Card({ students }: { students: typeof KIDS }) {
  const [selectedId, setSelectedId] = useState('kid-a');
  return (
    <AttendanceHeatmapCard
      students={students}
      selectedId={selectedId}
      onSelect={setSelectedId}
      today="2026-11-23"
      month="2026-11"
    />
  );
}

const meta: Meta<typeof Card> = {
  title: 'Portal/AttendanceHeatmapCard',
  component: Card,
  decorators: [withMemoryRouter(['/portal'])],
  args: { students: KIDS },
  parameters: {
    msw: {
      handlers: [http.get('/api/v1/attendance/students/:id/days', () => HttpResponse.json(month))],
    },
  },
};
export default meta;
type Story = StoryObj<typeof Card>;

export const TwoChildren: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const OneChild: Story = { args: { students: [KIDS[0] as (typeof KIDS)[number]] } };
export const Phone: Story = {
  decorators: [
    (Story) => (
      <div className="w-[390px]">
        <Story />
      </div>
    ),
  ],
};
