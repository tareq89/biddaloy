import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, userEvent, within } from 'storybook/test';

import { ExcelSetup } from './excel-setup';

/**
 * [13.5.2] The Excel path of the welcome wizard's setup step. Each state past
 * the guide uploads a file in its play function against mocked endpoints.
 */
const validate = (over: object = {}, errors: object[] = []) =>
  http.post('/api/v1/backup/validate', () =>
    HttpResponse.json({
      staging_id: 's1',
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      meta: {
        schema_version: 1,
        kind: 'TEMPLATE',
        exported_at: '2026-10-06T00:00:00Z',
        app_version: '1',
        source_school_name: 'x',
        source_school_slug: 'x',
      },
      tabs: [
        { name: 'classes', present: true, creates: 4, updates: 0, unchanged: 0, deletes: 0 },
        { name: 'sections', present: true, creates: 8, updates: 0, unchanged: 0, deletes: 0 },
      ],
      totals: { creates: 12, updates: 0, unchanged: 0, deletes: 0 },
      errors,
      warnings: [],
      hard_error_count: errors.length,
      is_empty_tenant: true,
      ...over,
    }),
  );

const restore = http.post('/api/v1/backup/restore', () =>
  HttpResponse.json({ job_id: 'j1', snapshot_job_id: 's' }, { status: 202 }),
);
const job = (over: object) =>
  http.get('/api/v1/backup/jobs/j1', () =>
    HttpResponse.json({
      id: 'j1',
      kind: 'RESTORE',
      status: 'RUNNING',
      source: 'MANUAL',
      requested_by: { id: 'u', full_name: 'A' },
      size_bytes: null,
      row_counts: null,
      progress: { tab: 'classes', done: 2, total: 4 },
      failed_tab: null,
      snapshot_job_id: null,
      error: null,
      pinned: false,
      expires_at: null,
      created_at: '2026-10-06T00:00:00Z',
      finished_at: null,
      ...over,
    }),
  );

const upload = async (canvasElement: HTMLElement) => {
  const body = within(canvasElement.ownerDocument.body);
  const input = await body.findByLabelText('Choose file');
  await userEvent.upload(input, new File(['x'], 'starter.xlsx'));
  return body;
};

const confirm = async (canvasElement: HTMLElement) => {
  const body = await upload(canvasElement);
  const button = await body.findByRole('button', { name: 'Create these' });
  await expect(button).toBeEnabled();
  await userEvent.click(button);
};

const meta: Meta<typeof ExcelSetup> = {
  title: 'Features/Onboarding/ExcelSetup',
  component: ExcelSetup,
  parameters: { msw: { handlers: [validate()] } },
};
export default meta;
type Story = StoryObj<typeof ExcelSetup>;

export const Guide: Story = {};

export const GuidePhone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const Problems: Story = {
  parameters: {
    msw: {
      handlers: [
        validate({}, [
          {
            row: 3,
            tab: 'classes',
            column: 'name',
            value: '',
            message: 'Name is required',
            severity: 'error',
          },
        ]),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const body = await upload(canvasElement);
    await expect(await body.findByText('Name is required')).toBeInTheDocument();
  },
};

export const ProblemsPhone: Story = {
  ...Problems,
  parameters: { ...Problems.parameters, viewport: { defaultViewport: 'mobile1' } },
};

export const Preview: Story = {
  play: async ({ canvasElement }) => {
    const body = await upload(canvasElement);
    await expect(await body.findByText('This is what will be created')).toBeInTheDocument();
  },
};

export const PreviewPhone: Story = {
  ...Preview,
  parameters: { ...Preview.parameters, viewport: { defaultViewport: 'mobile1' } },
};

export const Running: Story = {
  parameters: { msw: { handlers: [validate(), restore, job({})] } },
  play: async ({ canvasElement }) => confirm(canvasElement),
};

export const Failed: Story = {
  parameters: {
    msw: {
      handlers: [validate(), restore, job({ status: 'FAILED', failed_tab: 'sections' })],
    },
  },
  play: async ({ canvasElement }) => confirm(canvasElement),
};
