import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChoiceCards } from './choice-cards';

const options = [
  { value: 'scratch', title: 'From scratch', description: 'Blank plan' },
  { value: 'template', title: 'From template' },
  { value: 'copy', title: 'Copy last year' },
];

function setup(value = 'scratch') {
  const onValueChange = vi.fn();
  render(
    <ChoiceCards value={value} onValueChange={onValueChange} options={options} label="Start" />,
  );
  return onValueChange;
}

describe('ChoiceCards', () => {
  it('renders three radios in one named group', () => {
    setup();
    const group = screen.getByRole('radiogroup', { name: 'Start' });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(3);
  });

  it('aria-checked follows value', () => {
    setup('template');
    expect(screen.getByRole('radio', { name: /From template/ }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: /From scratch/ }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('the card itself is the click target', async () => {
    const onValueChange = setup();
    expect(screen.getByRole('radio', { name: /Copy last year/ }).tagName).toBe('BUTTON');
    await userEvent.click(screen.getByText('Copy last year'));
    expect(onValueChange).toHaveBeenCalledWith('copy');
  });

  it('arrow keys move between cards', async () => {
    const onValueChange = setup();
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    // jsdom: arrows move focus (Radix roving); selection follows on Space.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: /From template/ })),
    );
    await userEvent.keyboard(' ');
    expect(onValueChange).toHaveBeenLastCalledWith('template');
  });
});
