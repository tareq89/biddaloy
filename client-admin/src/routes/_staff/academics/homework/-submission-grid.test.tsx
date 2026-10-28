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

    expect(onSave).toHaveBeenCalledWith([
      { id: 'sub-1', marks: null, status: HomeworkSubmissionStatus.NOT_SUBMITTED },
    ]);
  });

  it('does not call onSave when nothing changed', async () => {
    const onSave = vi.fn();
    await renderInEnglish(
      <SubmissionGrid gradingMode={HomeworkGradingMode.TICK} rows={[row()]} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('TICK: ticking then un-ticking a SUBMITTED row leaves nothing to save', async () => {
    const onSave = vi.fn();
    await renderInEnglish(
      <SubmissionGrid
        gradingMode={HomeworkGradingMode.TICK}
        rows={[row({ status: HomeworkSubmissionStatus.SUBMITTED })]}
        onSave={onSave}
      />,
    );
    const box = screen.getByRole('checkbox', { name: /mark karim rahman done/i });
    fireEvent.click(box);
    fireEvent.click(box);
    const save = screen.getByRole<HTMLButtonElement>('button', { name: /save/i });
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('TICK: un-ticking a DONE row sends NOT_SUBMITTED', async () => {
    const onSave = vi.fn().mockResolvedValue([]);
    await renderInEnglish(
      <SubmissionGrid
        gradingMode={HomeworkGradingMode.TICK}
        rows={[row({ status: HomeworkSubmissionStatus.DONE })]}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /mark karim rahman done/i }));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith([
      { id: 'sub-1', status: HomeworkSubmissionStatus.NOT_SUBMITTED },
    ]);
  });

  it('PARTIAL: a SUBMITTED row shows Not done selected; Partial then Not done saves nothing', async () => {
    const onSave = vi.fn();
    await renderInEnglish(
      <SubmissionGrid
        gradingMode={HomeworkGradingMode.PARTIAL}
        rows={[row({ status: HomeworkSubmissionStatus.SUBMITTED })]}
        onSave={onSave}
      />,
    );
    const notDone = screen.getByRole('radio', { name: /not done/i });
    expect(notDone.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /^partial/i }));
    fireEvent.click(notDone);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /save/i }).disabled).toBe(true);
  });

  it('MARKS: 10000 shows the row error and does not call onSave', async () => {
    const onSave = vi.fn();
    await renderInEnglish(
      <SubmissionGrid gradingMode={HomeworkGradingMode.MARKS} rows={[row()]} onSave={onSave} />,
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: /marks/i }), {
      target: { value: '10000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    // The test region renders Bengali numerals; the number follows the school's region.
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Marks must be a whole number from 0 to ৯,৯৯৯.',
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reports dirty after an edit and clean again when fresh rows arrive', async () => {
    const onDirtyChange = vi.fn();
    const onSave = vi.fn();
    const view = await renderInEnglish(
      <SubmissionGrid
        gradingMode={HomeworkGradingMode.TICK}
        rows={[row()]}
        onSave={onSave}
        onDirtyChange={onDirtyChange}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /mark karim rahman done/i }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    view.rerender(
      <SubmissionGrid
        gradingMode={HomeworkGradingMode.TICK}
        rows={[row()]}
        onSave={onSave}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('a double click saves once', async () => {
    const onSave = vi.fn(() => new Promise<never>(() => undefined));
    await renderInEnglish(
      <SubmissionGrid gradingMode={HomeworkGradingMode.TICK} rows={[row()]} onSave={onSave} />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /mark karim rahman done/i }));
    const save = screen.getByRole('button', { name: /save/i });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows the status as a badge', async () => {
    await renderInEnglish(
      <SubmissionGrid
        gradingMode={HomeworkGradingMode.TICK}
        rows={[row({ status: HomeworkSubmissionStatus.SUBMITTED })]}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText('Submitted')).toBeTruthy();
  });
});
