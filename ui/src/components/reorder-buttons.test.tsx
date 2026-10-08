import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReorderButtons } from './reorder-buttons';

const setup = (index: number, count = 5) => {
  const onMove = vi.fn();
  render(
    <ReorderButtons
      index={index}
      count={count}
      onMove={onMove}
      upLabel="Up 4"
      downLabel="Down 4"
    />,
  );
  return onMove;
};

describe('ReorderButtons', () => {
  it('names both buttons from props and sizes them for touch', () => {
    setup(2);
    const up = screen.getByRole('button', { name: 'Up 4' });
    expect(up.className).toContain('size-11');
    expect(up.className).toContain('md:size-8');
    expect(screen.getByRole('button', { name: 'Down 4' })).toBeTruthy();
  });

  it('marks up aria-disabled at the first row; it stays focusable and does nothing', async () => {
    const onMove = setup(0);
    const up = screen.getByRole('button', { name: 'Up 4' });
    expect(up.getAttribute('aria-disabled')).toBe('true');
    // Not `disabled`: focus must not fall to <body> after a move to the top.
    expect(up).toHaveProperty('disabled', false);
    await userEvent.click(up);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Down 4' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('marks down aria-disabled at the last row', () => {
    setup(4);
    expect(screen.getByRole('button', { name: 'Down 4' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('moves up and down by one', async () => {
    const onMove = setup(3);
    await userEvent.click(screen.getByRole('button', { name: 'Up 4' }));
    expect(onMove).toHaveBeenCalledWith(3, 2);
    await userEvent.click(screen.getByRole('button', { name: 'Down 4' }));
    expect(onMove).toHaveBeenCalledWith(3, 4);
  });
});
