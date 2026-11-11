import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReasonChips } from './reason-chips';

const props = {
  chips: ['Parent request', 'Bug report'],
  textLabel: 'Reason',
  minLength: 10,
  error: 'Too short',
};

describe('ReasonChips', () => {
  it('chip fills the text and is a pressed button', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ReasonChips {...props} value="" onChange={onChange} />);
    const chip = screen.getByRole('button', { name: 'Bug report' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith('Bug report');
    rerender(<ReasonChips {...props} value="Bug report" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Bug report' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('typing reports edits', () => {
    const onChange = vi.fn();
    render(<ReasonChips {...props} value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'abc' } });
    expect(onChange).toHaveBeenCalledWith('abc');
  });

  it('shows the error under minLength only', () => {
    const { rerender } = render(<ReasonChips {...props} value="short" onChange={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('Too short');
    expect(screen.getByLabelText('Reason').getAttribute('aria-invalid')).toBe('true');
    rerender(<ReasonChips {...props} value="long enough text" onChange={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is axe clean', async () => {
    const { baseElement } = render(<ReasonChips {...props} value="x" onChange={vi.fn()} />);
    await expect(baseElement).toHaveNoViolations();
  });
});
