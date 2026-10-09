import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ExamMarkerRow } from './exam-marker-row';

const renderRow = (edit: { onEdit: () => void; editLabel: string } | { onEdit?: undefined } = {}) =>
  render(
    <table>
      <tbody>
        <ExamMarkerRow
          colSpan={4}
          title="Half-yearly syllabus ends here"
          meta="Lessons 1-24"
          {...edit}
        />
      </tbody>
    </table>,
  );

describe('ExamMarkerRow', () => {
  it('is one row with one cell spanning colSpan', () => {
    renderRow();
    expect(screen.getAllByRole('row')).toHaveLength(1);
    const cells = screen.getAllByRole('cell');
    expect(cells).toHaveLength(1);
    expect(cells[0]?.getAttribute('colspan')).toBe('4');
  });

  it('shows title and meta, and no edit button without onEdit', () => {
    renderRow();
    expect(screen.getByText('Half-yearly syllabus ends here')).toBeTruthy();
    expect(screen.getByText('Lessons 1-24')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a named edit button that calls back', async () => {
    const onEdit = vi.fn();
    renderRow({ onEdit, editLabel: 'Edit marker' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit marker' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
