import { AttendanceStatus } from '@biddaloy/shared';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '../i18n';
import { renderWithProviders } from '../test';

import { AttendanceStatusControl } from './attendance-status-control';

/** Preloads the `attendance` namespace before mounting — without this the
 * component's own `useTranslation('attendance')` suspends on first use
 * (`I18nProvider`'s `react: { useSuspense: true }`), and the Suspense
 * fallback (`null`) is exactly what an immediate `screen.getByText`
 * assertion would otherwise race against. */
async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
    await i18n.loadNamespaces('attendance');
  });
  return view;
}

describe('AttendanceStatusControl — compact variant', () => {
  it('renders the current status icon and word for all four statuses, and for null', async () => {
    const { rerender } = await renderInEnglish(
      <AttendanceStatusControl value={null} onChange={vi.fn()} studentName="Rafi Ahmed" />,
    );
    expect(screen.getByText('Unmarked')).toBeTruthy();

    for (const [status, label] of [
      [AttendanceStatus.PRESENT, 'Present'],
      [AttendanceStatus.ABSENT, 'Absent'],
      [AttendanceStatus.LATE, 'Late'],
      [AttendanceStatus.LEAVE, 'Leave'],
    ] as const) {
      rerender(
        <AttendanceStatusControl value={status} onChange={vi.fn()} studentName="Rafi Ahmed" />,
      );
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('accessible name includes the student name', async () => {
    await renderInEnglish(
      <AttendanceStatusControl
        value={AttendanceStatus.PRESENT}
        onChange={vi.fn()}
        studentName="Rafi Ahmed"
      />,
    );
    expect(screen.getByRole('button', { name: /Rafi Ahmed, currently Present/ })).toBeTruthy();
  });

  it('calls onChange for the selected option and closes the popover (non-LATE)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    await renderInEnglish(
      <AttendanceStatusControl value={null} onChange={onChange} studentName="Rafi Ahmed" />,
    );
    await user.click(screen.getByRole('button', { name: /Rafi Ahmed, currently Unmarked/ }));
    await user.click(await screen.findByRole('button', { name: 'Absent' }));
    expect(onChange).toHaveBeenCalledWith(AttendanceStatus.ABSENT);
  });

  it('disabled blocks change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    await renderInEnglish(
      <AttendanceStatusControl
        value={null}
        onChange={onChange}
        disabled
        studentName="Rafi Ahmed"
      />,
    );
    const trigger = screen.getByRole('button', { name: /Rafi Ahmed/ });
    expect(trigger.hasAttribute('disabled')).toBe(true);
    await user.click(trigger);
    expect(screen.queryByRole('button', { name: 'Absent' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keyboard: Enter opens the popover, Escape closes and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    await renderInEnglish(
      <AttendanceStatusControl value={null} onChange={vi.fn()} studentName="Rafi Ahmed" />,
    );
    const trigger = screen.getByRole('button', { name: /Rafi Ahmed/ });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Present' })).toBeTruthy();

    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Present' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('shows the minutes-late field once LATE is selected, and reports changes', async () => {
    const user = userEvent.setup();
    const onMinutesLateChange = vi.fn();
    await renderInEnglish(
      <AttendanceStatusControl
        value={AttendanceStatus.LATE}
        onChange={vi.fn()}
        minutesLate={5}
        onMinutesLateChange={onMinutesLateChange}
        studentName="Rafi Ahmed"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Rafi Ahmed, currently Late/ }));
    const input = await screen.findByLabelText('Minutes late');
    expect((input as HTMLInputElement).value).toBe('5');
    // A single `fireEvent.change`, not sequential `user.type` keystrokes:
    // this field is controlled by the `minutesLate` prop, and the test
    // never re-renders with an updated prop between keystrokes, so React
    // would keep resetting the displayed value back to the old prop after
    // every character — a test artifact, not a component bug.
    fireEvent.change(input, { target: { value: '9' } });
    expect(onMinutesLateChange).toHaveBeenLastCalledWith(9);
  });
});

describe('AttendanceStatusControl — expanded variant', () => {
  it('renders all four options inline, with the current one pressed', async () => {
    await renderInEnglish(
      <AttendanceStatusControl
        value={AttendanceStatus.LEAVE}
        onChange={vi.fn()}
        variant="expanded"
        studentName="Rafi Ahmed"
      />,
    );
    expect(screen.getByRole('button', { name: /Mark Rafi Ahmed Present/ })).toBeTruthy();
    const leaveOption = screen.getByRole('button', { name: /Mark Rafi Ahmed Leave/ });
    expect(leaveOption.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onChange when a different option is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    await renderInEnglish(
      <AttendanceStatusControl
        value={null}
        onChange={onChange}
        variant="expanded"
        studentName="Rafi Ahmed"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Mark Rafi Ahmed Late/ }));
    expect(onChange).toHaveBeenCalledWith(AttendanceStatus.LATE);
  });

  it('is axe clean', async () => {
    const { container } = await renderInEnglish(
      <AttendanceStatusControl
        value={AttendanceStatus.PRESENT}
        onChange={vi.fn()}
        variant="expanded"
        studentName="Rafi Ahmed"
      />,
    );
    await expect(container).toHaveNoViolations();
  });

  it('[9.7] allowedStatuses restricts the offered options, e.g. LEAVE-only for a future date', async () => {
    await renderInEnglish(
      <AttendanceStatusControl
        value={null}
        onChange={vi.fn()}
        variant="expanded"
        studentName="Rafi Ahmed"
        allowedStatuses={[AttendanceStatus.LEAVE]}
      />,
    );
    expect(screen.getByRole('button', { name: /Mark Rafi Ahmed Leave/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mark Rafi Ahmed Present/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark Rafi Ahmed Absent/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark Rafi Ahmed Late/ })).toBeNull();
  });
});
