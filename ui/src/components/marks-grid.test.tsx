import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import { REGION_BD_BN, REGION_BD_EN } from '../i18n/region-config';
import { RegionConfigProvider } from '../i18n/region-config-provider';
import { renderWithProviders } from '../test';

import { MarksGrid, cellKey, type MarksGridCell } from './marks-grid';

async function renderInEnglish(ui: React.ReactElement) {
  // Region config is decoupled from locale; the default is Bangla digits, so pin Latin here.
  const en = (node: React.ReactNode) => (
    <RegionConfigProvider value={REGION_BD_EN}>{node}</RegionConfigProvider>
  );
  const view = renderWithProviders(en(ui), { locale: 'en' });
  const rerender = view.rerender;
  view.rerender = (node) => rerender(en(node));
  await act(async () => {
    await view.localeReady;
    await i18n.loadNamespaces(['exams', 'common']);
  });
  return view;
}

const students = [
  { id: 's1', roll_number: 1, full_name: 'Rafi Ahmed' },
  { id: 's2', roll_number: 2, full_name: 'Nadia Islam' },
];
const components = [
  { id: 'c1', name: 'Written', source: 'MANUAL' as const, full_marks: '100' },
  { id: 'c2', name: 'MCQ', source: 'MANUAL' as const, full_marks: '25' },
  { id: 'c3', name: 'Attendance', source: 'DERIVED' as const, full_marks: '10' },
];
const cells: MarksGridCell[] = [];

describe('MarksGrid keyboard model', () => {
  it('Enter moves focus down the SAME column, not to the next cell in reading order', async () => {
    const user = userEvent.setup();
    await renderInEnglish(
      <MarksGrid students={students} components={components} cells={cells} onStage={vi.fn()} />,
    );

    const s1c1 = screen.getByLabelText('Rafi Ahmed — Written');
    s1c1.focus();
    await user.keyboard('{Enter}');

    const s2c1 = screen.getByLabelText('Nadia Islam — Written');
    expect(document.activeElement).toBe(s2c1);
  });

  it('Tab moves across the row (native row-major DOM order)', async () => {
    const user = userEvent.setup();
    await renderInEnglish(
      <MarksGrid students={students} components={components} cells={cells} onStage={vi.fn()} />,
    );

    const s1c1 = screen.getByLabelText('Rafi Ahmed — Written');
    s1c1.focus();
    await user.tab();

    const s1c2 = screen.getByLabelText('Rafi Ahmed — MCQ');
    expect(document.activeElement).toBe(s1c2);
  });

  it('arrow keys navigate freely in all four directions', async () => {
    const user = userEvent.setup();
    await renderInEnglish(
      <MarksGrid students={students} components={components} cells={cells} onStage={vi.fn()} />,
    );

    const s1c1 = screen.getByLabelText('Rafi Ahmed — Written');
    s1c1.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByLabelText('Rafi Ahmed — MCQ'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByLabelText('Nadia Islam — MCQ'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByLabelText('Nadia Islam — Written'));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByLabelText('Rafi Ahmed — Written'));
  });

  it('"A" sets ABSENT and "E" sets EXEMPT without a numeric value', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksGrid students={students} components={components} cells={cells} onStage={onStage} />,
    );

    const cell = screen.getByLabelText('Rafi Ahmed — Written');
    cell.focus();
    await user.keyboard('a');
    expect(onStage).toHaveBeenCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ status: 'ABSENT', value: null }),
    );

    onStage.mockClear();
    await user.keyboard('e');
    expect(onStage).toHaveBeenCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ status: 'EXEMPT', value: null }),
    );
  });
});

describe('MarksGrid — number-in-progress staging', () => {
  // The server's `@IsNumberString` rejects "." and "5."; one such cell
  // would fail its whole autosave batch on every retry.
  it('stages "5." as "5" and a lone "." as blank, keeping the typed text in the cell', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksGrid students={students} components={components} cells={cells} onStage={onStage} />,
    );
    const cell = screen.getByLabelText<HTMLInputElement>('Rafi Ahmed — Written');

    await user.type(cell, '5.');
    expect(cell.value).toBe('5.');
    expect(onStage).toHaveBeenLastCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ value: '5', status: 'PRESENT' }),
    );

    await user.clear(cell);
    await user.type(cell, '.');
    expect(cell.value).toBe('.');
    expect(onStage).toHaveBeenLastCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ value: null, status: 'PRESENT' }),
    );
  });
});

describe('MarksGrid — over-max refusal', () => {
  it('refuses a value above full_marks at the cell, with the limit shown inline', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksGrid students={students} components={components} cells={cells} onStage={onStage} />,
    );

    const cell = screen.getByLabelText('Rafi Ahmed — MCQ');
    await user.click(cell);
    await user.type(cell, '30');

    // The final keystroke (30 > 25) is refused at the cell — never staged.
    expect(screen.getByText('max 25')).toBeTruthy();
    expect(onStage).not.toHaveBeenCalledWith(
      cellKey('s1', 'c2'),
      expect.objectContaining({ value: '30' }),
    );
  });
});

describe('MarksGrid — derived column', () => {
  it('renders the derived component read-only with its precomputed value', async () => {
    await renderInEnglish(
      <MarksGrid
        students={students}
        components={components}
        cells={cells}
        derived={{ c3: { values: { s1: '9', s2: '10' } } }}
        onStage={vi.fn()}
      />,
    );

    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    // No editable <input> renders for the derived column.
    expect(screen.queryByLabelText('Rafi Ahmed — Attendance')).toBeNull();
  });
});

describe('MarksGrid kit look and numerals', () => {
  const bn = (ui: React.ReactElement) => (
    <RegionConfigProvider value={REGION_BD_BN}>{ui}</RegionConfigProvider>
  );

  it('shows a stored Latin value in Bangla digits and stages typed Bangla digits as Latin', async () => {
    const onStage = vi.fn();
    const user = userEvent.setup();
    await renderInEnglish(
      bn(
        <MarksGrid
          students={students}
          components={components}
          cells={[{ student_id: 's1', component_id: 'c1', value: '52', status: 'PRESENT' }]}
          onStage={onStage}
        />,
      ),
    );
    const input = screen.getByLabelText<HTMLInputElement>('Rafi Ahmed — Written');
    expect(input.value).toBe('৫২');
    await user.clear(input);
    await user.type(input, '৬১');
    expect(onStage).toHaveBeenLastCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ value: '61', status: 'PRESENT' }),
    );
  });

  it('shows the over-max error with Bangla digits', async () => {
    const user = userEvent.setup();
    await renderInEnglish(
      bn(<MarksGrid students={students} components={components} cells={cells} onStage={vi.fn()} />),
    );
    await user.type(screen.getByLabelText('Rafi Ahmed — MCQ'), '30');
    expect(screen.getByText('max ২৫')).toBeTruthy();
  });

  it('renders the saved row as an icon with the rowSaved name', async () => {
    await renderInEnglish(
      <MarksGrid students={students} components={components} cells={cells} onStage={vi.fn()} />,
    );
    const icon = screen.getByTestId('row-saved-s1');
    expect(icon.tagName.toLowerCase()).toBe('svg');
    expect(icon.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders an h2 empty state with no students', async () => {
    await renderInEnglish(
      <MarksGrid students={[]} components={components} cells={cells} onStage={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No students' })).toBeTruthy();
  });
});
