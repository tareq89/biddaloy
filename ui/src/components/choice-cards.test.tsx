import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChoiceCards } from './choice-cards';

const options = [
  { value: 'a', title: 'Testimonial', description: 'Plain' },
  { value: 'b', title: 'TC', disabled: true, disabledReason: 'Record a leaving event first' },
  { value: 'c', title: 'Character' },
];

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = React.useState<string | undefined>('a');
  return (
    <ChoiceCards
      label="Kind"
      value={v}
      onValueChange={(x) => {
        setV(x);
        onChange?.(x);
      }}
      options={options}
    />
  );
}

describe('ChoiceCards', () => {
  it('arrow-down moves focus past the disabled option; Space selects', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole('radio', { name: /Testimonial/ }).focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Character/ })),
    );
    await userEvent.keyboard(' ');
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('c'));
  });

  it('announces the disabled reason via aria-describedby', () => {
    render(<Harness />);
    const tc = screen.getByRole('radio', { name: /TC/ });
    expect((tc as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById(tc.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Record a leaving event first',
    );
  });

  it('names each card by its title only and repeats disabled reasons on the group', () => {
    render(<Harness />);
    const testimonial = screen.getByRole('radio', { name: 'Testimonial' });
    expect(testimonial.getAttribute('aria-describedby')).toBeTruthy();
    const group = screen.getByRole('radiogroup', { name: 'Kind' });
    expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'TC: Record a leaving event first',
    );
  });

  it('marks only the checked card with a check icon', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'Testimonial' }).querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'Character' }).querySelector('svg')).toBeNull();
  });

  it('is axe clean', async () => {
    const { container } = render(<Harness />);
    await expect(container).toHaveNoViolations();
  });
});
