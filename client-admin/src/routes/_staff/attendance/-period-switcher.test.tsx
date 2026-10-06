import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PeriodSwitcher } from './-period-switcher';

function period(no: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    period_no: no,
    name: null,
    starts_at: `0${7 + no}:00`,
    ends_at: `0${7 + no}:45`,
    subject_id: `sub-${no}`,
    subject_name: `Subject ${no}`,
    teacher_names: [],
    state: null,
    ...over,
  };
}

function mockPeriods(body: unknown[]) {
  server.use(
    http.get('/api/v1/attendance/sections/section-1/periods', () => HttpResponse.json(body)),
  );
}

function renderSwitcher(
  props: Partial<React.ComponentProps<typeof PeriodSwitcher>> = {},
  onChange = vi.fn(),
) {
  renderWithProviders(
    <PeriodSwitcher
      sectionId="section-1"
      date="2026-09-04"
      period={undefined}
      onChange={onChange}
      {...props}
    />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  return onChange;
}

describe('PeriodSwitcher', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('renders nothing for an empty list', async () => {
    mockPeriods([]);
    renderSwitcher();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shows Whole day then the periods in the order the server sent them', async () => {
    mockPeriods([period(1, { name: 'P1' }), period(2)]);
    renderSwitcher();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Whole day',
      expect.stringContaining('P1 · Subject 1'),
      // name falls back to the period number
      expect.stringContaining('2 · Subject 2'),
    ]);
    expect(screen.getByRole('tablist', { name: 'Whole day or a period' })).toBeTruthy();
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('marks FINALIZED and DRAFT periods with a badge', async () => {
    mockPeriods([period(1, { state: 'FINALIZED' }), period(2, { state: 'DRAFT' })]);
    renderSwitcher();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs[1]!.textContent).toContain('Submitted');
    expect(tabs[2]!.textContent).toContain('Draft');
  });

  it('moves with the arrow keys; focusing a tab selects it, Enter keeps it', async () => {
    mockPeriods([period(1), period(2)]);
    const onChange = renderSwitcher();
    const user = userEvent.setup();
    const [whole] = await screen.findAllByRole('tab');
    whole!.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement?.textContent).toContain('Subject 1');
    expect(onChange).toHaveBeenLastCalledWith(1);
    await user.keyboard('{ArrowRight}{Enter}');
    expect(document.activeElement?.textContent).toContain('Subject 2');
    expect(onChange).toHaveBeenLastCalledWith(2);
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('falls back to Whole day when the selected period is not in the list', async () => {
    mockPeriods([period(1)]);
    const onChange = renderSwitcher({ period: 5 });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined, { replace: true }));
  });
});
