import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NoticeBar } from './notice-bar';

describe('NoticeBar', () => {
  it.each(['info', 'warning', 'danger'] as const)(
    'renders the %s tone as a status',
    async (tone) => {
      const { container } = render(<NoticeBar tone={tone}>Trial ends soon</NoticeBar>);
      expect(screen.getByRole('status').getAttribute('data-tone')).toBe(tone);
      // Icon sits beside the text, so tone is not colour alone.
      expect(container.querySelector('svg')).not.toBeNull();
      await expect(container).toHaveNoViolations();
    },
  );

  it('renders the action', () => {
    render(
      <NoticeBar tone="info" action={<button type="button">Choose a plan</button>}>
        Trial
      </NoticeBar>,
    );
    expect(screen.getByRole('button', { name: 'Choose a plan' })).toBeTruthy();
  });

  it('calls onOpenDetails when activated by mouse and keyboard', async () => {
    const onOpenDetails = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <NoticeBar tone="warning" onOpenDetails={onOpenDetails}>
        Trial ends in 3 days
      </NoticeBar>,
    );
    const button = screen.getByRole('button', { name: 'Trial ends in 3 days' });
    await user.click(button);
    // Click focused it; tabbing away and back proves it is in the tab order.
    await user.tab();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(onOpenDetails).toHaveBeenCalledTimes(2);
    await expect(container).toHaveNoViolations();
  });

  it('has no button without onOpenDetails', () => {
    render(<NoticeBar tone="info">Trial</NoticeBar>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
