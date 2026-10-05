import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { AdmissionReports } from './AdmissionReports';

/**
 * [39.4.1]'s admission lifecycle report. Same "client-admin isn't globbed
 * into a running Storybook yet" gap `OrganisationSection.stories.tsx`
 * notes — written anyway, following that precedent.
 */
const meta: Meta<typeof AdmissionReports> = { component: AdmissionReports };
export default meta;
type Story = StoryObj<typeof AdmissionReports>;

const years = http.get('/api/v1/academic-years', () =>
  HttpResponse.json({
    data: [{ id: 'y1', name: '2026', is_current: true }],
    total: 1,
    page: 1,
    limit: 100,
    totalPages: 1,
  }),
);
const classes = http.get('/api/v1/classes', () =>
  HttpResponse.json({
    data: [{ id: 'c1', name: 'Six' }],
    total: 1,
    page: 1,
    limit: 100,
    totalPages: 1,
  }),
);

const counts = { admitted: 1, withdrawn: 0, transferred_out: 1, graduated: 0, readmitted: 0 };
const rows = [
  {
    student_id: null,
    name: 'Nadia Akter',
    registration_number: null,
    class_name: 'Six',
    event_type: 'ADMITTED',
    occurred_on: '2026-01-05',
    reason: null,
    destination: null,
  },
  {
    student_id: 's2',
    name: 'Rahim Uddin',
    registration_number: 'R-102',
    class_name: 'Six',
    event_type: 'TRANSFERRED_OUT',
    occurred_on: '2026-03-01',
    reason: 'Family moved',
    destination: 'Dhaka Model School',
  },
];
const report = (body: object) =>
  http.get('/api/v1/admission/reports/lifecycle', () => HttpResponse.json(body));

export const Default: Story = {
  parameters: { msw: { handlers: [years, classes, report({ counts, rows, truncated: false })] } },
};
export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        years,
        classes,
        report({
          counts: { ...counts, admitted: 0, transferred_out: 0 },
          rows: [],
          truncated: false,
        }),
      ],
    },
  },
};
export const Truncated: Story = {
  parameters: { msw: { handlers: [years, classes, report({ counts, rows, truncated: true })] } },
};
/** The report never answers: tiles show skeletons and the table its loading state. */
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        years,
        classes,
        http.get('/api/v1/admission/reports/lifecycle', () => new Promise(() => {})),
      ],
    },
  },
};
