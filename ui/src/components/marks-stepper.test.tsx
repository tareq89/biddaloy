import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import { renderWithProviders } from '../test';

import { cellKey, type MarksGridCell } from './marks-grid';
import { MarksStepper } from './marks-stepper';

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
  { id: 'c3', name: 'Attendance', source: 'DERIVED' as const, full_marks: '10' },
];
const cells: MarksGridCell[] = [];

describe('MarksStepper', () => {
  it('renders one student per card, matching the grid semantics', async () => {
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={vi.fn()} />,
    );

    expect(screen.getByText('Rafi Ahmed')).toBeTruthy();
    expect(screen.queryByText('Nadia Islam')).toBeNull();
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('next/previous move between students', async () => {
    const user = userEvent.setup();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Nadia Islam')).toBeTruthy();
    expect(screen.getByText('2 of 2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('Rafi Ahmed')).toBeTruthy();
  });

  it('same A/E semantics as the grid: A/E buttons stage ABSENT/EXEMPT', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={onStage} />,
    );

    await user.click(screen.getByRole('button', { name: 'Abs' }));
    expect(onStage).toHaveBeenCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ status: 'ABSENT', value: null }),
    );

    onStage.mockClear();
    await user.click(screen.getByRole('button', { name: 'Exm' }));
    expect(onStage).toHaveBeenCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ status: 'EXEMPT', value: null }),
    );
  });

  it('renders the derived component read-only', async () => {
    await renderInEnglish(
      <MarksStepper
        students={students}
        components={components}
        cells={cells}
        derived={{ c3: { values: { s1: '9' } } }}
        onStage={vi.fn()}
      />,
    );

    expect(screen.getByText('9')).toBeTruthy();
  });
});
