import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { RecordsTab } from './records-tab';

/**
 * [39.3.3] Student "Records" tab. Same "not globbed by Storybook yet" gap the
 * other `client-admin` stories document (only `ui/src/**` is globbed today).
 */
const student = {
  id: 's1',
  full_name: 'Rahim Uddin',
  religion: 'Islam',
  birth_reg_no: '1234',
  father_name: 'Karim',
  mother_name: 'Amina',
  health_notes: null,
  updated_at: '2026-01-01T00:00:00Z',
};

const meta: Meta<typeof RecordsTab> = {
  component: RecordsTab,
  args: { studentId: 's1' },
};
export default meta;

type Story = StoryObj<typeof RecordsTab>;

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/students/s1', () => HttpResponse.json(student)),
        http.get('*/students/s1/public-exams', () => HttpResponse.json([])),
        http.get('*/students/s1/lifecycle-events', () => HttpResponse.json([])),
      ],
    },
  },
};

export const Populated: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/students/s1', () => HttpResponse.json(student)),
        http.get('*/students/s1/public-exams', () =>
          HttpResponse.json([
            {
              id: 'e1',
              exam_type: 'SSC',
              board: 'Dhaka',
              roll_no: '123456',
              registration_no: '998877',
              gpa: '4.50',
              passing_year: 2024,
            },
          ]),
        ),
        http.get('*/students/s1/lifecycle-events', () =>
          HttpResponse.json([
            {
              id: 'l1',
              event_type: 'WITHDRAWN',
              occurred_on: '2026-03-01',
              reason: 'Family moved',
              destination: null,
              remark: null,
              created_at: '2026-03-01T10:00:00Z',
            },
          ]),
        ),
      ],
    },
  },
};

export const Loading: Story = {
  parameters: {
    msw: { handlers: [http.get('*/students/s1*', () => new Promise(() => {}))] },
  },
};

export const Forbidden: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('*/students/s1*', () =>
          HttpResponse.json({ message: 'Forbidden', statusCode: 403 }, { status: 403 }),
        ),
      ],
    },
  },
};
