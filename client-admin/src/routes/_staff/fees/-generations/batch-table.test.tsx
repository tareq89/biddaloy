/**
 * [16.3.5] `BatchTable` — column rendering (view-bills action, status badge, source,
 * period, "System" generated-by fallback), and the error/empty states it forwards to
 * `ListShell`/`DataTable`.
 */
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The default test RegionConfig is Bangla; pin REGION_BD_EN so assertions read in Latin digits.
vi.mock('@biddaloy/ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/i18n')>();
  return { ...actual, useRegionConfig: () => actual.REGION_BD_EN };
});

import { BatchTable, type FeeGeneration } from './batch-table';

afterEach(async () => {
  await cleanupTestState();
});

function generationFactory(overrides: Partial<FeeGeneration> = {}): FeeGeneration {
  return {
    id: 'gen-1',
    academic_year_id: 'year-1',
    period_start: '2026-09-01T00:00:00.000Z',
    period_type: 'MONTH',
    source: 'MANUAL',
    duplicate_strategy: 'SKIP',
    notify_families: true,
    student_count: 40,
    generated_count: 38,
    skipped_count: 2,
    removed_count: 0,
    structures: [],
    created_at: '2026-09-01T08:00:00.000Z',
    billed_amount: 38000,
    collected_amount: 12000,
    collection_status: 'PARTIAL',
    generated_by: { id: 'user-1', full_name: 'Karim Rahman' },
    ...overrides,
  } as FeeGeneration;
}

function baseProps(overrides: Partial<React.ComponentProps<typeof BatchTable>> = {}) {
  return {
    title: 'Generated fees',
    filters: { fields: [], values: {}, onChange: () => {} } as unknown as React.ComponentProps<
      typeof BatchTable
    >['filters'],
    data: [generationFactory()],
    loading: false,
    emptyMessage: 'No batches found',
    emptyExplanation: 'Create the first round.',
    page: 1,
    pageSize: 25,
    totalCount: 1,
    onPageChange: () => {},
    onPageSizeChange: () => {},
    pageSizeLabel: 'Rows per page',
    onRowClick: () => {},
    ...overrides,
  };
}

function render(overrides: Partial<React.ComponentProps<typeof BatchTable>> = {}) {
  return renderWithProviders(<BatchTable {...baseProps(overrides)} />, {
    locale: 'en',
    tenantId: 'tenant-1',
  });
}

describe('BatchTable', () => {
  it('has one View bills action per row and fires onRowClick with the batch', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = render({ onRowClick });
    await localeReady;

    const buttons = await screen.findAllByRole('button', { name: 'View bills' });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]!);

    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'gen-1' }));
  });

  it('shows the error state when error is set', async () => {
    const { localeReady } = render({ error: 'Could not load batches' });
    await localeReady;
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not load batches',
    );
  });

  it('shows the empty title and explanation when data is empty', async () => {
    const { localeReady } = render({ data: [] });
    await localeReady;
    expect(await screen.findByText('No batches found')).toBeTruthy();
    expect(screen.getByText('Create the first round.')).toBeTruthy();
  });

  it('labels generated_by: null rows as System, under the source', async () => {
    const { localeReady } = render({ data: [generationFactory({ generated_by: null })] });
    await localeReady;
    expect(await screen.findByText('System')).toBeTruthy();
  });

  it('joins the fee-structure names with commas', async () => {
    const { localeReady } = render({
      data: [
        generationFactory({
          structures: [
            { id: 'fs-1', name: 'Monthly Tuition', fee_type: 'TUITION', amount: 4200 },
            { id: 'fs-2', name: 'Exam fee', fee_type: 'EXAM_FEE', amount: 500 },
          ],
        }),
      ],
    });
    await localeReady;
    expect(await screen.findByText('Monthly Tuition, Exam fee')).toBeTruthy();
  });

  it('labels a named generator with their full name', async () => {
    const { localeReady } = render();
    await localeReady;
    expect(await screen.findByText('Karim Rahman')).toBeTruthy();
  });

  it.each([
    ['NONE', 'Not collected'],
    ['PARTIAL', 'Partly collected'],
    ['FULL', 'Fully collected'],
  ] as const)('renders the %s collection status badge as %s', async (status, label) => {
    const { localeReady } = render({ data: [generationFactory({ collection_status: status })] });
    await localeReady;
    expect(await screen.findByText(label)).toBeTruthy();
  });

  it.each([
    ['MANUAL', 'Manual'],
    ['SCHEDULE', 'Automatic billing'],
    ['FINE_RULE', 'Fine rule'],
  ] as const)('renders the %s source as %s', async (source, label) => {
    const { localeReady } = render({ data: [generationFactory({ source })] });
    await localeReady;
    expect(await screen.findByText(label)).toBeTruthy();
  });

  it('renders a month round as a month name, not an ISO date', async () => {
    const { localeReady } = render();
    await localeReady;
    expect(await screen.findByText('September 2026')).toBeTruthy();
    expect(screen.queryByText(/2026-09-01/)).toBeNull();
  });

  it('renders a week round as a date range', async () => {
    const { localeReady } = render({
      data: [generationFactory({ period_type: 'WEEK', period_start: '2026-09-07T00:00:00.000Z' })],
    });
    await localeReady;
    expect(await screen.findByText('7th – 13th September')).toBeTruthy();
  });

  it('renders the students column as a plain number, not currency', async () => {
    const { localeReady } = render();
    await localeReady;
    // `findByText` is an exact match, so this only passes when the cell is the bare number.
    expect(await screen.findByText('40')).toBeTruthy();
  });
});
