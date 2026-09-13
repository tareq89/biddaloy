/**
 * [16.3.5] `BatchTable` — column rendering (actions, status badge, source,
 * period type, "System" generated-by fallback), row click, and the
 * loading/error/empty states it forwards to `ListShell`/`DataTable`.
 */
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    page: 1,
    pageSize: 20,
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
  it('renders an actions cell when renderActions is provided', async () => {
    const { localeReady } = render({
      renderActions: (row) => <button>{`Actions for ${row.id}`}</button>,
    });
    await localeReady;
    expect(await screen.findByRole('button', { name: 'Actions for gen-1' })).toBeTruthy();
  });

  it('renders no actions cell content when renderActions is omitted', async () => {
    const { localeReady } = render();
    await localeReady;
    await screen.findByText('Period');
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('shows the error state when error is set', async () => {
    const { localeReady } = render({ error: 'Could not load batches' });
    await localeReady;
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not load batches',
    );
  });

  it('shows the empty message when data is empty', async () => {
    const { localeReady } = render({ data: [] });
    await localeReady;
    expect(await screen.findByText('No batches found')).toBeTruthy();
  });

  it('fires onRowClick with the clicked batch', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = render({ onRowClick });
    await localeReady;

    await user.click(await screen.findByRole('button', { name: /Month/ }));

    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'gen-1' }));
  });

  it('labels generated_by: null rows as System', async () => {
    const { localeReady } = render({ data: [generationFactory({ generated_by: null })] });
    await localeReady;
    expect(await screen.findByText('System')).toBeTruthy();
  });

  it('renders the fee-structure chips when structures are present', async () => {
    const { localeReady } = render({
      data: [
        generationFactory({
          structures: [{ id: 'fs-1', name: 'Monthly Tuition' } as never],
        }),
      ],
    });
    await localeReady;
    expect(await screen.findByText('Monthly Tuition')).toBeTruthy();
  });

  it('labels a named generator with their full name', async () => {
    const { localeReady } = render();
    await localeReady;
    expect(await screen.findByText('Karim Rahman')).toBeTruthy();
  });

  it.each([
    ['NONE', 'None'],
    ['PARTIAL', 'Partial'],
    ['FULL', 'Full'],
  ] as const)('renders the %s collection status badge as %s', async (status, label) => {
    const { localeReady } = render({ data: [generationFactory({ collection_status: status })] });
    await localeReady;
    expect(await screen.findByText(label)).toBeTruthy();
  });

  it.each([
    ['MANUAL', 'Manual'],
    ['SCHEDULE', 'Schedule'],
  ] as const)('renders the %s source as %s', async (source, label) => {
    const { localeReady } = render({ data: [generationFactory({ source })] });
    await localeReady;
    expect(await screen.findByText(label)).toBeTruthy();
  });

  it.each([
    ['MONTH', 'Month'],
    ['WEEK', 'Week'],
  ] as const)('renders the %s period type as %s', async (periodType, label) => {
    const { localeReady } = render({ data: [generationFactory({ period_type: periodType })] });
    await localeReady;
    expect(await screen.findByText(new RegExp(label))).toBeTruthy();
  });
});
