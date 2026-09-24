import { HomeworkGradingMode, HomeworkSubmissionStatus } from '@biddaloy/shared';
import { i18n } from '@biddaloy/ui/i18n';
import { renderWithProviders } from '@biddaloy/ui/test';
import { act, fireEvent, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SubmissionGrid, type SubmissionRow } from './-submission-grid';

/** See `file-upload-widget.test.tsx` for why the namespace is preloaded
 * before mounting (`useTranslation('homework')` suspends otherwise). */
async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
    await i18n.loadNamespaces('homework');
  });
  return view;
}

function row(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    id: 'sub-1',
    student_id: 'student-1',
    student_name: 'Karim Rahman',
    roll_number: 4,
    status: HomeworkSubmissionStatus.NOT_SUBMITTED,
    marks: null,
    ...overrides,
  };
}

describe('SubmissionGrid', () => {
  it('renders a checkbox for TICK grading mode', async () => {
    await renderInEnglish(
      <SubmissionGrid gradingMode={HomeworkGradingMode.TICK} rows={[row()]} onSave={vi.fn()} />,
    );
    expect(screen.getByRole('checkbox', { name: /mark karim rahman done/i })).toBeTruthy();
  });

  it('renders a 3-state radio group for PARTIAL grading mode', async () => {
    await renderInEnglish(
      <SubmissionGrid gradingMode={HomeworkGradingMode.PARTIAL} rows={[row()]} onSave={vi.fn()} />,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('renders a numeric input for MARKS grading mode', async () => {
    await renderInEnglish(
      <SubmissionGrid gradingMode={HomeworkGradingMode.MARKS} rows={[row()]} onSave={vi.fn()} />,
    );
    expect(screen.getByRole('spinbutton', { name: /karim rahman's marks/i })).toBeTruthy();
  });

  it('bulk-saves dirty rows and surfaces a per-row error', async () => {
    const onSave = vi.fn().mockResolvedValue([{ id: 'sub-1', error: 'Marks out of range' }]);
    await renderInEnglish(
      <SubmissionGrid gradingMode={HomeworkGradingMode.MARKS} rows={[row()]} onSave={onSave} />,
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: /marks/i }), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith([
      { id: 'sub-1', status: HomeworkSubmissionStatus.DONE, marks: 8 },
    ]);
    expect((await screen.findByRole('alert')).textContent).toBe('Marks out of range');
  });

  it('persists clearing marks back to null on a MARKS row', async () => {
    const onSave = vi.fn().mockResolvedValue([{ id: 'sub-1' }]);
    await renderInEnglish(
      <SubmissionGrid
        gradingMode={HomeworkGradingMode.MARKS}
        rows={[row({ status: HomeworkSubmissionStatus.DONE, marks: 8 })]}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: /marks/i }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith([{ id: 'sub-1', marks: null }]);
  });

  it('does not call onSave when nothing changed', async () => {
    const onSave = vi.fn();
    await renderInEnglish(
      <SubmissionGrid gradingMode={HomeworkGradingMode.TICK} rows={[row()]} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
