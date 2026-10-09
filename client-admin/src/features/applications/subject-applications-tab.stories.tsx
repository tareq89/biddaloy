import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse, delay } from 'msw';

import { SubjectApplicationsTab } from './subject-applications-tab';

/**
 * [52.5.2] The "আবেদন" tab body of the student and staff detail pages. Fake person:
 * রহিম উদ্দিন. Same "client-admin isn't globbed into a running Storybook yet" gap as
 * `application-forms.stories.tsx`.
 */
const list = (data: unknown[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 100,
  totalPages: 1,
});

const applications = [
  {
    id: 'a1',
    serial: '2026/0045',
    type: 'STUDENT_LEAVE',
    status: 'PENDING',
    source: 'APP',
    applicant_name: 'করিম হোসেন',
    applicant_role: 'PARENT',
    payload: { reason: 'জ্বর' },
    ref_names: {},
    start_date: '2026-10-08',
    end_date: '2026-10-09',
    created_at: '2026-10-07T04:00:00.000Z',
  },
  {
    id: 'a2',
    serial: '2026/0031',
    type: 'TESTIMONIAL',
    status: 'APPROVED',
    source: 'PAPER',
    applicant_name: 'করিম হোসেন',
    applicant_role: null,
    payload: { purpose: 'বৃত্তির জন্য' },
    ref_names: {},
    start_date: null,
    end_date: null,
    created_at: '2026-09-20T04:00:00.000Z',
  },
];

const meta: Meta<typeof SubjectApplicationsTab> = {
  component: SubjectApplicationsTab,
  args: {
    subject: { kind: 'STUDENT', studentId: 'stu-rahim' },
    subjectName: 'রহিম উদ্দিন',
    ns: 'students',
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/v1/applications', () => HttpResponse.json(list(applications)))],
    },
  },
};

export default meta;
type Story = StoryObj<typeof SubjectApplicationsTab>;

export const Populated: Story = {};

export const Empty: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/v1/applications', () => HttpResponse.json(list([])))] },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/applications', async () => {
          await delay('infinite');
        }),
      ],
    },
  },
};

export const Forbidden: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/applications', () =>
          HttpResponse.json({ message: 'Forbidden', statusCode: 403 }, { status: 403 }),
        ),
      ],
    },
  },
};
