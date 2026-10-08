/** [13.6.1] Radio-group keyboard contract. */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChoiceCardGroup } from './choice-card-group';

const OPTIONS = [
  { value: 'a', title: 'Alpha', body: 'first', badge: 'Best' },
  { value: 'b', title: 'Beta', body: 'second' },
  { value: 'c', title: 'Gamma', body: 'third' },
] as const;

function Harness({ onEnter }: { onEnter?: () => void }) {
  const [value, setValue] = React.useState<'a' | 'b' | 'c'>('a');
  return (
    <ChoiceCardGroup
      label="Pick one"
      options={OPTIONS}
      value={value}
      onChange={setValue}
      {...(onEnter ? { onEnter } : {})}
    />
  );
}

describe('ChoiceCardGroup', () => {
  it('is one radiogroup with one tab stop on the selected card', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Pick one' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(screen.getByText('Best')).toBeTruthy();
  });

  it('arrow keys move focus and selection, wrapping around', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /Beta/ }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Beta/ }));
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('radio', { name: /Gamma/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('Space selects the focused card without moving', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('radio', { name: /Gamma/ }));
    await user.keyboard(' ');
    expect(screen.getByRole('radio', { name: /Gamma/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('Enter runs onEnter', async () => {
    const onEnter = vi.fn();
    const user = userEvent.setup();
    render(<Harness onEnter={onEnter} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
