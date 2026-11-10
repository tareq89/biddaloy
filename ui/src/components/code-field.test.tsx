import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CodeField } from './code-field';

function getInput(name: string): HTMLInputElement {
  return screen.getByRole('textbox', { name });
}

describe('CodeField (totp)', () => {
  it('is one labelled numeric one-time-code input', () => {
    render(<CodeField id="c" label="Code" />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    const input = getInput('Code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
  });

  it('strips spaces from a pasted "123 456" and completes once', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<CodeField id="c" label="Code" onComplete={onComplete} />);
    await user.click(getInput('Code'));
    await user.paste('123 456');
    expect(getInput('Code').value).toBe('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('normalises Bangla digits to Latin', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<CodeField id="c" label="Code" onComplete={onComplete} />);
    await user.type(getInput('Code'), '১২৩৪৫৬');
    expect(getInput('Code').value).toBe('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('does not complete on 5 digits', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<CodeField id="c" label="Code" onComplete={onComplete} />);
    await user.type(getInput('Code'), '12345');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('links the error to the input and marks it invalid', () => {
    render(<CodeField id="c" label="Code" error="Wrong code" />);
    const input = getInput('Code');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('c-error');
    expect(screen.getByRole('alert').textContent).toBe('Wrong code');
  });

  it('is axe clean', async () => {
    const { container } = render(<CodeField id="c" label="Code" hint="Six digits" error="Wrong" />);
    await expect(container).toHaveNoViolations();
  });
});

describe('CodeField (recovery)', () => {
  it('shows four groups of four and returns the code without dashes', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<CodeField id="r" label="Recovery" variant="recovery" onComplete={onComplete} />);
    await user.click(getInput('Recovery'));
    await user.paste('abcd-efgh ijkl-mnop');
    expect(getInput('Recovery').value).toBe('abcd-efgh-ijkl-mnop');
    expect(onComplete).toHaveBeenCalledWith('abcdefghijklmnop');
  });

  it('does not complete on 15 characters', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<CodeField id="r" label="Recovery" variant="recovery" onComplete={onComplete} />);
    await user.type(getInput('Recovery'), 'abcdefghijklmno');
    expect(onComplete).not.toHaveBeenCalled();
  });
});
