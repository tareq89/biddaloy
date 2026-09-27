/**
 * [34.4.1], D9 — `Space` on an unticked row records, a ticked row's popover
 * offers Undo, and every row is reachable/operable via keyboard.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MilestoneChecklist, type MilestoneChecklistItem } from './milestone-checklist';

const ITEMS: MilestoneChecklistItem[] = [
  { id: 'm-1', name: 'Read 5 books', achievedOn: null, scoreGrade: null, remark: null },
  {
    id: 'm-2',
    name: 'Write a book report',
    achievedOn: '2026-02-01',
    scoreGrade: 'A',
    remark: 'Great work',
  },
];

describe('MilestoneChecklist', () => {
  it('renders nothing (or the empty message) with no items', () => {
    const { container } = render(
      <MilestoneChecklist
        items={[]}
        onRecord={vi.fn()}
        onUndo={vi.fn()}
        undoLabel="Undo"
        emptyMessage="No milestones yet"
      />,
    );
    expect(container.textContent).toBe('No milestones yet');
  });

  it('Space on an unticked row calls onRecord', async () => {
    const onRecord = vi.fn();
    const user = userEvent.setup();
    render(
      <MilestoneChecklist items={ITEMS} onRecord={onRecord} onUndo={vi.fn()} undoLabel="Undo" />,
    );

    const unticked = screen.getByRole('checkbox', { name: /Read 5 books/ });
    unticked.focus();
    await user.keyboard(' ');

    expect(onRecord).toHaveBeenCalledWith('m-1');
  });

  it('a ticked row opens a popover with Undo and the remark', async () => {
    const onUndo = vi.fn();
    const user = userEvent.setup();
    render(
      <MilestoneChecklist items={ITEMS} onRecord={vi.fn()} onUndo={onUndo} undoLabel="Undo" />,
    );

    await user.click(screen.getByRole('checkbox', { name: /Write a book report/ }));
    await screen.findByText('Great work');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledWith('m-2');
  });

  it('exposes checkbox roles with correct aria-checked for a11y', () => {
    render(
      <MilestoneChecklist items={ITEMS} onRecord={vi.fn()} onUndo={vi.fn()} undoLabel="Undo" />,
    );

    expect(
      screen.getByRole('checkbox', { name: /Read 5 books/ }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByRole('checkbox', { name: /Write a book report/ }).getAttribute('aria-checked'),
    ).toBe('true');
  });
});
