import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImpersonationBanner } from './impersonation-banner';

const base = { message: 'Viewing as Rahim', endLabel: 'End', warningLabel: 'Under 5 minutes left' };

describe('ImpersonationBanner', () => {
  it('shows the time in whole minutes', () => {
    render(<ImpersonationBanner {...base} remainingSeconds={3601} onEnd={vi.fn()} />);
    expect(screen.getByText('1:01')).toBeTruthy();
  });

  it('announces the warning only once the threshold is crossed', () => {
    const { rerender } = render(
      <ImpersonationBanner {...base} remainingSeconds={301} onEnd={vi.fn()} />,
    );
    expect(screen.getByRole('status').textContent).toBe('');
    rerender(<ImpersonationBanner {...base} remainingSeconds={300} onEnd={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('Under 5 minutes left');
    rerender(<ImpersonationBanner {...base} remainingSeconds={240} onEnd={vi.fn()} />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('End calls onEnd', () => {
    const onEnd = vi.fn();
    render(<ImpersonationBanner {...base} remainingSeconds={600} onEnd={onEnd} />);
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('calls onEnd once at 0', () => {
    const onEnd = vi.fn();
    const { rerender } = render(
      <ImpersonationBanner {...base} remainingSeconds={1} onEnd={onEnd} />,
    );
    expect(onEnd).not.toHaveBeenCalled();
    rerender(<ImpersonationBanner {...base} remainingSeconds={0} onEnd={onEnd} />);
    rerender(<ImpersonationBanner {...base} remainingSeconds={0} onEnd={onEnd} />);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('is axe clean', async () => {
    const { baseElement } = render(
      <ImpersonationBanner
        {...base}
        remainingSeconds={120}
        onEnd={vi.fn()}
        viewOnlyLabel="View only"
      />,
    );
    await expect(baseElement).toHaveNoViolations();
  });
});
