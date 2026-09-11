import type { Meta, StoryObj } from '@storybook/react-vite';
import type * as React from 'react';
import { userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { type BulkImportError, type PreviewResult } from '../hooks/use-bulk-upload-preview';

import { BulkUploadPreview, type BulkUploadPreviewProps } from './bulk-upload-preview';

// `BulkUploadPreview` is generic in `<S, C>`, and Storybook's `Meta<typeof
// Component>`/`StoryObj` helpers can't carry that through — they'd collapse
// every story's `args` to `PreviewResult<unknown>`. Fixing `S`/`C` to this
// file's own `Summary`/`CommitResult` via an explicit props type sidesteps
// that; `component` is omitted from `meta` for the same reason (it drives
// the same generic inference `argTypes` would use).
const meta: Meta = {
  title: 'Components/BulkUploadPreview',
  tags: ['autodocs'],
};

export default meta;

interface Summary {
  totalRows: number;
  skippedRows: number;
}

interface CommitResult {
  processedCount: number;
}

type Story = StoryObj<(props: BulkUploadPreviewProps<Summary, CommitResult>) => React.ReactNode>;

function renderSummary(result: PreviewResult<Summary>) {
  return (
    <p>
      {result.summary.totalRows} rows, {result.summary.skippedRows} will be skipped
    </p>
  );
}

function renderDone(result: CommitResult, reset: () => void) {
  return (
    <div className="flex flex-col gap-2">
      <p>{result.processedCount} rows processed</p>
      <button type="button" onClick={reset}>
        Start over
      </button>
    </div>
  );
}

function makeFile(name = 'upload.csv'): File {
  return new File(['content'], name, { type: 'text/csv' });
}

const CLEAN_RESULT: PreviewResult<Summary> = {
  staging_id: 'staging-1',
  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  errors: [],
  hard_error_count: 0,
  summary: { totalRows: 142, skippedRows: 0 },
};

const ERRORS: BulkImportError[] = [
  { row: 3, column: 'phone', message: 'Not a valid phone number', severity: 'error', value: 'abc' },
  { row: 5, column: null, message: 'Row is missing a required column', severity: 'error' },
  {
    row: 9,
    column: 'email',
    message: 'Email looks unusual — double-check it',
    severity: 'warning',
    value: 'x@',
    tab: 'Sheet2',
  },
];

const WITH_ERRORS_RESULT: PreviewResult<Summary> = {
  staging_id: 'staging-2',
  expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  errors: ERRORS,
  hard_error_count: 2,
  summary: { totalRows: 142, skippedRows: 3 },
};

const EXPIRED_RESULT: PreviewResult<Summary> = {
  ...CLEAN_RESULT,
  staging_id: 'staging-3',
  expires_at: new Date(Date.now() - 1000).toISOString(),
};

async function selectAFile(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const input = canvas.getByLabelText('Choose file', { exact: false, selector: 'input' });
  await userEvent.upload(input, makeFile());
}

/** No file chosen yet — delegates entirely to `FileUpload`. */
export const Idle: Story = {
  args: {
    accept: '.csv,.xlsx',
    validate: () => new Promise(() => {}),
    commit: () => new Promise(() => {}),
    renderSummary,
    renderDone,
  },
  render: (args) => <BulkUploadPreview<Summary, CommitResult> {...args} />,
};

/** A preview with a mix of hard errors and warnings, one carrying a `tab` —
 * Confirm stays disabled because `hard_error_count > 0`. */
export const PreviewWithErrors: Story = {
  args: {
    accept: '.csv,.xlsx',
    validate: () => Promise.resolve(WITH_ERRORS_RESULT),
    commit: () => new Promise(() => {}),
    renderSummary,
    renderDone,
  },
  render: (args) => <BulkUploadPreview<Summary, CommitResult> {...args} />,
  play: async ({ canvasElement }) => {
    await selectAFile(canvasElement);
    await within(canvasElement).findByText('142 rows, 3 will be skipped');
  },
};

/** A clean preview — zero errors, Confirm enabled. */
export const PreviewClean: Story = {
  args: {
    accept: '.csv,.xlsx',
    validate: () => Promise.resolve(CLEAN_RESULT),
    commit: () => new Promise(() => {}),
    renderSummary,
    renderDone,
  },
  render: (args) => <BulkUploadPreview<Summary, CommitResult> {...args} />,
  play: async ({ canvasElement }) => {
    await selectAFile(canvasElement);
    await within(canvasElement).findByText('142 rows, 0 will be skipped');
  },
};

/** `expires_at` already in the past — countdown reads the expired copy,
 * Confirm disabled. */
export const Expired: Story = {
  args: {
    accept: '.csv,.xlsx',
    validate: () => Promise.resolve(EXPIRED_RESULT),
    commit: () => new Promise(() => {}),
    renderSummary,
    renderDone,
  },
  render: (args) => <BulkUploadPreview<Summary, CommitResult> {...args} />,
  play: async ({ canvasElement }) => {
    await selectAFile(canvasElement);
    await within(canvasElement).findByText('142 rows, 0 will be skipped');
  },
};

/** Commit in flight — Confirm shows a busy/disabled state. */
export const Committing: Story = {
  args: {
    accept: '.csv,.xlsx',
    validate: () => Promise.resolve(CLEAN_RESULT),
    commit: () => new Promise(() => {}),
    renderSummary,
    renderDone,
  },
  render: (args) => <BulkUploadPreview<Summary, CommitResult> {...args} />,
  play: async ({ canvasElement }) => {
    await selectAFile(canvasElement);
    const canvas = within(canvasElement);
    await canvas.findByText('142 rows, 0 will be skipped');
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm' }));
  },
};

/** Commit finished — `renderDone` takes over. */
export const Done: Story = {
  args: {
    accept: '.csv,.xlsx',
    validate: () => Promise.resolve(CLEAN_RESULT),
    commit: () => Promise.resolve({ processedCount: 142 }),
    renderSummary,
    renderDone,
  },
  render: (args) => <BulkUploadPreview<Summary, CommitResult> {...args} />,
  play: async ({ canvasElement }) => {
    await selectAFile(canvasElement);
    const canvas = within(canvasElement);
    await canvas.findByText('142 rows, 0 will be skipped');
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm' }));
    await canvas.findByText('142 rows processed');
  },
};

export const RightToLeft: Story = {
  args: {
    accept: '.csv,.xlsx',
    validate: () => Promise.resolve(WITH_ERRORS_RESULT),
    commit: () => new Promise(() => {}),
    renderSummary,
    renderDone,
  },
  render: (args) => <BulkUploadPreview<Summary, CommitResult> {...args} />,
  decorators: [rtlDecorator],
};
