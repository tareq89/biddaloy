import type { RegisterMatrix } from '@biddaloy/ui/hooks';
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, userEvent } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RegisterEditGrid, type Draft } from './-register-edit-grid';

// 01 working, 02 closed, 03 working, 04 working but after `today`, 05 future.
const matrix = {
  dates: [
    { date: '2026-01-01', is_working_day: true },
    { date: '2026-01-02', is_working_day: false },
    { date: '2026-01-03', is_working_day: true },
    { date: '2026-01-04', is_working_day: true },
  ],
  versions: {},
  rows: [
    { student_id: 's1', roll_number: 1, full_name: 'Karim', marks: { '2026-01-01': 'PRESENT' } },
    { student_id: 's2', roll_number: 2, full_name: 'Rina', marks: {} },
  ],
} as unknown as RegisterMatrix;

function Harness({ onCancel = () => {} }: { onCancel?: () => void }) {
  const [draft, setDraft] = React.useState<Draft>(new Map());
  return (
    <>
      <output data-testid="count">{draft.size}</output>
      <RegisterEditGrid
        matrix={matrix}
        draft={draft}
        onDraftChange={setDraft}
        today="2026-01-03"
        caption="Register"
        onCancel={onCancel}
      />
    </>
  );
}

function renderGrid(props: React.ComponentProps<typeof Harness> = {}) {
  return renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <Harness {...props} />
    </RegionConfigProvider>,
    { tenantId: 'tenant-1', locale: 'en' },
  );
}

const cell = (name: RegExp) => screen.getByRole('gridcell', { name });

describe('RegisterEditGrid', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('is a grid with column and row headers', async () => {
    renderGrid();
    expect(await screen.findByRole('grid', { name: 'Register' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0);
    expect(screen.getByRole('rowheader', { name: 'Karim' })).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = renderGrid();
    await screen.findByRole('grid');
    await expect(container).toHaveNoViolations();
  });

  it('arrow keys skip the closed day and the future day', async () => {
    const user = userEvent.setup();
    renderGrid();
    const first = await screen.findByRole('gridcell', { name: /Karim, .*: Present/ });
    first.focus();
    await user.keyboard('{ArrowRight}');
    // 02 is closed, so the next editable day is 03.
    expect(document.activeElement).toBe(cell(/Karim, .*3.*: Not marked/));
    await user.keyboard('{ArrowRight}');
    // 04 is after today: focus stays.
    expect(document.activeElement).toBe(cell(/Karim, .*3.*: Not marked/));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cell(/Rina, .*3.*: Not marked/));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(cell(/Rina, .*1.*: Not marked/));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(cell(/Rina, .*3.*: Not marked/));
  });

  it('P / A / L / E set the status and mark the cell changed', async () => {
    const user = userEvent.setup();
    renderGrid();
    cell(/Rina, .*1.*: Not marked/).focus();
    for (const [key, word] of [
      ['a', 'Absent'],
      ['l', 'Late'],
      ['e', 'Leave'],
      ['p', 'Present'],
    ] as const) {
      await user.keyboard(key);
      expect(cell(new RegExp(`Rina, .*1.*: ${word}, changed`))).toBeTruthy();
    }
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('reverting a cell to its loaded value removes it from the draft', async () => {
    const user = userEvent.setup();
    renderGrid();
    cell(/Karim, .*1.*: Present/).focus();
    await user.keyboard('a');
    expect(screen.getByTestId('count').textContent).toBe('1');
    await user.keyboard('p');
    expect(screen.getByTestId('count').textContent).toBe('0');
    expect(cell(/Karim, .*1.*: Present$/)).toBeTruthy();
  });

  it('Space flips present and absent; a click cycles through all four', async () => {
    const user = userEvent.setup();
    renderGrid();
    const rina = cell(/Rina, .*1.*: Not marked/);
    rina.focus();
    await user.keyboard(' ');
    expect(cell(/Rina, .*1.*: Present, changed/)).toBeTruthy();
    await user.keyboard(' ');
    expect(cell(/Rina, .*1.*: Absent, changed/)).toBeTruthy();
    await user.click(cell(/Rina, .*1.*: Absent, changed/));
    expect(cell(/Rina, .*1.*: Late, changed/)).toBeTruthy();
    await user.click(cell(/Rina, .*1.*: Late, changed/));
    expect(cell(/Rina, .*1.*: Leave, changed/)).toBeTruthy();
  });

  it('Esc cancels (Ctrl+S is the page\'s, see register.test.tsx)', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderGrid({ onCancel });
    cell(/Karim, .*1.*: Present/).focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });
});
