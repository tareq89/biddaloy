import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LessonStatusGroup, type LessonDeliveryStatus } from './lesson-status-group';

const labels = { TAUGHT: 'Taught', PARTLY: 'Partly', NOT_TAUGHT: 'Not taught' };

function setup(value: LessonDeliveryStatus | null, extra: { disabled?: boolean } = {}) {
  const onChange = vi.fn();
  render(
    <LessonStatusGroup
      value={value}
      onChange={onChange}
      labels={labels}
      groupLabel="Period 1 status"
      {...extra}
    />,
  );
  return onChange;
}

describe('LessonStatusGroup', () => {
  it('renders a named radiogroup with three named radios', () => {
    setup(null);
    expect(screen.getByRole('radiogroup', { name: 'Period 1 status' })).toBeTruthy();
    for (const l of Object.values(labels)) {
      expect(screen.getByRole('radio', { name: l })).toBeTruthy();
    }
  });

  it('reflects value via aria-checked; null checks none', () => {
    const { unmount } = render(
      <LessonStatusGroup value="TAUGHT" onChange={vi.fn()} labels={labels} groupLabel="g" />,
    );
    expect(screen.getByRole('radio', { name: 'Taught' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Partly' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    unmount();
    setup(null);
    for (const r of screen.getAllByRole('radio')) {
      expect(r.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('first radio is the tab stop when nothing is selected', async () => {
    setup(null);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Taught' }));
  });

  it('arrow keys move and select; click selects; onChange gets the enum value', async () => {
    const onChange = setup('TAUGHT');
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    // jsdom: arrows move focus (Radix roving); selection follows on Space.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Partly' })),
    );
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith('PARTLY');
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Taught' })),
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Not taught' }));
    expect(onChange).toHaveBeenLastCalledWith('NOT_TAUGHT');
  });

  it('space selects the focused radio', async () => {
    const onChange = setup(null);
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith('TAUGHT');
  });

  it('disabled blocks onChange', async () => {
    const onChange = setup(null, { disabled: true });
    await userEvent.click(screen.getByRole('radio', { name: 'Partly' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows an icon and the word on every option, at h-14 / md:h-11', () => {
    setup('PARTLY');
    for (const r of screen.getAllByRole('radio')) {
      expect(r.querySelector('svg')).toBeTruthy();
      expect(r.textContent?.trim()).toBeTruthy();
      expect(r.className).toContain('h-14');
      expect(r.className).toContain('md:h-11');
    }
  });
});
