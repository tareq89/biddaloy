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

describe('MarksStepper — edge cases', () => {
  function writtenInput() {
    return screen.getByLabelText<HTMLInputElement>(/Written/);
  }

  it('shows the empty message when the section has no students', async () => {
    await renderInEnglish(
      <MarksStepper students={[]} components={components} cells={cells} onStage={vi.fn()} />,
    );

    expect(screen.getByText('No students in this section.')).toBeTruthy();
    expect(screen.queryByTestId('marks-stepper')).toBeNull();
  });

  it('disables Previous on the first student and Next on the last', async () => {
    const user = userEvent.setup();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={vi.fn()} />,
    );

    const previous = screen.getByRole<HTMLButtonElement>('button', { name: 'Previous' });
    const next = screen.getByRole<HTMLButtonElement>('button', { name: 'Next' });
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    await user.click(next);
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);
  });

  it('snaps back to the last student when the list shrinks under the current card', async () => {
    const user = userEvent.setup();
    const view = await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Nadia Islam')).toBeTruthy();

    view.rerender(
      <MarksStepper
        students={[students[0]!]}
        components={components}
        cells={cells}
        onStage={vi.fn()}
      />,
    );

    expect(screen.getByText('Rafi Ahmed')).toBeTruthy();
    expect(screen.getByText('1 of 1')).toBeTruthy();
  });

  it('shows the seeded value, or Abs/Exm for absent/exempt cells', async () => {
    const view = await renderInEnglish(
      <MarksStepper
        students={students}
        components={components}
        cells={[{ student_id: 's1', component_id: 'c1', value: '42', status: 'PRESENT' }]}
        onStage={vi.fn()}
      />,
    );
    expect(writtenInput().value).toBe('42');

    // A new `cells` array (e.g. after a refetch) re-seeds the card.
    view.rerender(
      <MarksStepper
        students={students}
        components={components}
        cells={[{ student_id: 's1', component_id: 'c1', value: null, status: 'ABSENT' }]}
        onStage={vi.fn()}
      />,
    );
    expect(writtenInput().value).toBe('Abs');

    view.rerender(
      <MarksStepper
        students={students}
        components={components}
        cells={[{ student_id: 's1', component_id: 'c1', value: null, status: 'EXEMPT' }]}
        onStage={vi.fn()}
      />,
    );
    expect(writtenInput().value).toBe('Exm');
  });

  it('stages each valid keystroke as a PRESENT value', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={onStage} />,
    );

    await user.type(writtenInput(), '75');

    expect(writtenInput().value).toBe('75');
    expect(onStage).toHaveBeenLastCalledWith(cellKey('s1', 'c1'), {
      student_id: 's1',
      component_id: 'c1',
      value: '75',
      status: 'PRESENT',
    });
  });

  it('ignores characters that are not part of a number', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={onStage} />,
    );

    await user.type(writtenInput(), 'x');

    expect(writtenInput().value).toBe('');
    expect(onStage).not.toHaveBeenCalled();
  });

  it('accepts a lone decimal point as an in-progress value', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={onStage} />,
    );

    await user.type(writtenInput(), '.');

    expect(writtenInput().value).toBe('.');
    expect(screen.queryByText('max 100')).toBeNull();
    // The server rejects "." — it is staged as a blank, never sent as-is.
    expect(onStage).toHaveBeenLastCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ value: null, status: 'PRESENT' }),
    );
  });

  it('stages "5." as "5" while the cell keeps showing what was typed', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={onStage} />,
    );

    await user.type(writtenInput(), '5.');

    expect(writtenInput().value).toBe('5.');
    expect(onStage).toHaveBeenLastCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ value: '5', status: 'PRESENT' }),
    );
  });

  it('refuses a mark above full marks and shows the max, then clears the error on a valid edit', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={onStage} />,
    );

    await user.type(writtenInput(), '101');

    // The third keystroke is refused: the input keeps "10" and nothing
    // over the max is staged.
    expect(writtenInput().value).toBe('10');
    expect(screen.getByText('max 100')).toBeTruthy();
    expect(onStage).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ value: '101' }),
    );

    await user.type(writtenInput(), '{Backspace}');

    expect(writtenInput().value).toBe('1');
    expect(screen.queryByText('max 100')).toBeNull();
  });

  it('clearing the input stages an empty PRESENT value and drops any over-max error', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={onStage} />,
    );

    await user.type(writtenInput(), '101');
    expect(screen.getByText('max 100')).toBeTruthy();

    await user.clear(writtenInput());

    expect(writtenInput().value).toBe('');
    expect(screen.queryByText('max 100')).toBeNull();
    expect(onStage).toHaveBeenLastCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ value: null, status: 'PRESENT' }),
    );
  });

  it('clearing an input that had no error still stages an empty value', async () => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={onStage} />,
    );

    await user.type(writtenInput(), '5');
    await user.clear(writtenInput());

    expect(onStage).toHaveBeenLastCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ value: null, status: 'PRESENT' }),
    );
  });

  it.each([
    ['a', 'ABSENT', 'Abs'],
    ['A', 'ABSENT', 'Abs'],
    ['e', 'EXEMPT', 'Exm'],
    ['E', 'EXEMPT', 'Exm'],
  ] as const)('pressing "%s" in the input marks the cell %s', async (key, status, shown) => {
    const user = userEvent.setup();
    const onStage = vi.fn();
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={onStage} />,
    );

    await user.type(writtenInput(), key);

    expect(onStage).toHaveBeenCalledWith(
      cellKey('s1', 'c1'),
      expect.objectContaining({ value: null, status }),
    );
    expect(writtenInput().value).toBe(shown);
  });

  it('read-only mode disables the input and the Abs/Exm buttons', async () => {
    await renderInEnglish(
      <MarksStepper
        students={students}
        components={components}
        cells={cells}
        readOnly
        onStage={vi.fn()}
      />,
    );

    expect(writtenInput().disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Abs' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Exm' }).disabled).toBe(true);
  });

  it('shows the saved tick only when no cell of the student is pending or failed', async () => {
    const view = await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={vi.fn()} />,
    );
    expect(screen.getByLabelText('Saved')).toBeTruthy();

    view.rerender(
      <MarksStepper
        students={students}
        components={components}
        cells={cells}
        pendingKeys={new Set([cellKey('s1', 'c1')])}
        onStage={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Saved')).toBeNull();
    expect(writtenInput().className).toContain('border-status-due-fg');
    expect(writtenInput().className).not.toContain('border-destructive');

    view.rerender(
      <MarksStepper
        students={students}
        components={components}
        cells={cells}
        failedKeys={new Set([cellKey('s1', 'c1')])}
        onStage={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText('Saved')).toBeNull();
    expect(writtenInput().className).toContain('border-destructive');
  });

  it('a failed cell shows as failed, not pending, even while it is still pending', async () => {
    const key = cellKey('s1', 'c1');
    await renderInEnglish(
      <MarksStepper
        students={students}
        components={components}
        cells={cells}
        pendingKeys={new Set([key])}
        failedKeys={new Set([key])}
        onStage={vi.fn()}
      />,
    );

    expect(writtenInput().className).toContain('border-destructive');
    expect(writtenInput().className).not.toContain('border-status-due-fg');
  });

  it('shows a dash for a derived component with no value for this student', async () => {
    const user = userEvent.setup();
    await renderInEnglish(
      <MarksStepper
        students={students}
        components={components}
        cells={cells}
        derived={{ c3: { values: { s1: '9' } } }}
        onStage={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows a dash when no derived values are passed at all', async () => {
    await renderInEnglish(
      <MarksStepper students={students} components={components} cells={cells} onStage={vi.fn()} />,
    );

    expect(screen.getByText('—')).toBeTruthy();
  });
});
