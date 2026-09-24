import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import { renderWithProviders } from '../test';

import { MarksGrid, cellKey, type MarksGridCell } from './marks-grid';

async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
    await i18n.loadNamespaces('exams');
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
