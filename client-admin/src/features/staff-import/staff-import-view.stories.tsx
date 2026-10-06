import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, userEvent, within } from 'storybook/test';

import { withMemoryRouter } from '../../../../ui/.storybook/router-decorator';

import { StaffImportView } from './staff-import-view';

/**
 * [13.5.1] Staff import. Guide is the first screen; the other stories upload a
 * file through the mocked validate / commit endpoints. Toolbar locale = Bangla.
 */
const preview = {
  staging_id: '11111111-1111-4111-8111-111111111111',
  expires_at: '2099-01-01T00:00:00.000Z',
  summary: { create: 2, restore: 1, skip: 1 },
  rows: [
    {
      action: 'create',
      row: 2,
      name: 'Rahim Uddin',
      mobile: '01712345678',
      role: 'TEACHER',
      notes: [],
    },
    {
      action: 'create',
      row: 3,
      name: 'Karim Hossain',
      email: 'karim@example.com',
      role: 'ACCOUNTANT',
      notes: [],
    },
    {
      action: 'restore',
      row: 4,
      name: 'Salma Akter',
      mobile: '01811111111',
      role: 'TEACHER',
      notes: [],
    },
    {
      action: 'skip',
      row: 5,
      name: 'Jamal Hasan',
      mobile: '01911111111',
      role: 'ADMIN',
      notes: [],
    },
  ],
  errors: [],
  hard_error_count: 0,
};

const withProblems = {
  ...preview,
  rows: [],
  errors: [
    {
      row: 2,
      column: 'mobile',
      message: 'Mobile was typed as a number',
      severity: 'error',
      value: '1712345678',
    },
    { row: 3, column: null, message: 'Give a mobile number or an email', severity: 'error' },
  ],
  hard_error_count: 2,
};

const done = {
  created: 2,
  restored: 1,
  skipped: 1,
  invited: 2,
  failed: [],
  invite_failed: [{ row: 3, reason: 'Could not send' }],
};

const upload = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  const input = await within(canvasElement).findByLabelText('Choose file');
  await userEvent.upload(input, new File(['x'], 'staff.csv', { type: 'text/csv' }));
};

const meta: Meta<typeof StaffImportView> = {
  title: 'Features/StaffImport/StaffImportView',
  component: StaffImportView,
  decorators: [withMemoryRouter(['/staff/import'])],
};
export default meta;
type Story = StoryObj<typeof StaffImportView>;

export const Guide: Story = {};

export const FromWelcome: Story = {
  decorators: [withMemoryRouter(['/staff/import?from=welcome'])],
};

export const Problems: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/users/bulk-upload/validate', () => HttpResponse.json(withProblems)),
      ],
    },
  },
  play: upload,
};

export const Preview: Story = {
  parameters: {
    msw: {
      handlers: [http.post('/api/v1/users/bulk-upload/validate', () => HttpResponse.json(preview))],
    },
  },
  play: upload,
};

export const Done: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/users/bulk-upload/validate', () => HttpResponse.json(preview)),
        http.post('/api/v1/users/bulk-upload/commit', () => HttpResponse.json(done)),
      ],
    },
  },
  play: async (context) => {
    await upload(context);
    await userEvent.click(
      await within(context.canvasElement).findByRole('button', { name: 'Confirm' }),
    );
    await expect(await within(context.canvasElement).findByText('Import finished')).toBeTruthy();
  },
};

export const Phone: Story = {
  ...Preview,
  parameters: { ...Preview.parameters, viewport: { defaultViewport: 'mobile1' } },
};
