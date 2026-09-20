import '@biddaloy/ui/test';
import { CalendarEventType } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendarFilters } from './-filters';

afterEach(cleanupTestState);

const CLASS_OPTIONS = [
  { id: 'class-9', name: 'Class 9' },
  { id: 'class-10', name: 'Class 10' },
];

function renderFilters(overrides: Partial<Parameters<typeof CalendarFilters>[0]> = {}) {
  const onTypesChange = vi.fn();
  const onClassIdChange = vi.fn();
  const view = renderWithProviders(
    <CalendarFilters
      types={[]}
      onTypesChange={onTypesChange}
      classId={undefined}
      onClassIdChange={onClassIdChange}
      classOptions={CLASS_OPTIONS}
      {...overrides}
    />,
    { locale: 'en' },
  );
  return { ...view, onTypesChange, onClassIdChange };
}

describe('CalendarFilters', () => {
  it('defaults both selects to "all"', async () => {
    renderFilters();
    expect((await screen.findByLabelText('Event type')).textContent).toContain('All types');
    expect(screen.getByLabelText('Class').textContent).toContain('All classes');
  });

  it('shows the selected type and class when provided', async () => {
    renderFilters({ types: [CalendarEventType.EXAM], classId: 'class-10' });
    expect((await screen.findByLabelText('Event type')).textContent).toContain('Exam');
    expect(screen.getByLabelText('Class').textContent).toContain('Class 10');
  });

  it('calls onTypesChange with a single-element array when a type is picked', async () => {
    const { user, onTypesChange } = renderFilters();

    await user.click(await screen.findByLabelText('Event type'));
    await user.click(await screen.findByRole('option', { name: 'Exam' }));

    expect(onTypesChange).toHaveBeenCalledWith([CalendarEventType.EXAM]);
  });

  it('calls onTypesChange with an empty array when "all types" is re-picked', async () => {
    const { user, onTypesChange } = renderFilters({ types: [CalendarEventType.EXAM] });

    await user.click(await screen.findByLabelText('Event type'));
    await user.click(await screen.findByRole('option', { name: 'All types' }));

    expect(onTypesChange).toHaveBeenCalledWith([]);
  });

  it('calls onClassIdChange with the picked class id', async () => {
    const { user, onClassIdChange } = renderFilters();

    await user.click(await screen.findByLabelText('Class'));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));

    expect(onClassIdChange).toHaveBeenCalledWith('class-9');
  });

  it('calls onClassIdChange with undefined when "all classes" is re-picked', async () => {
    const { user, onClassIdChange } = renderFilters({ classId: 'class-9' });

    await user.click(await screen.findByLabelText('Class'));
    await user.click(await screen.findByRole('option', { name: 'All classes' }));

    expect(onClassIdChange).toHaveBeenCalledWith(undefined);
  });
});
