import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { RadioGroup, RadioGroupItem } from './radio';

// `RadioGroupItem` renders a `<button role="radio">` under the hood, not a
// native `<input>` — a `<label>` wrapping a button doesn't create a real
// accessible-name association (jsx-a11y's `label-has-associated-control`
// correctly flags that), so each option gets its own `aria-label` instead,
// the same pattern `FormField` ([8.6.3]) will use for a real labelled group.
function ThreeOptions() {
  return (
    <RadioGroup aria-label="Preferred communication" defaultValue="sms">
      <span>
        <RadioGroupItem value="sms" aria-label="SMS" /> SMS
      </span>
      <span>
        <RadioGroupItem value="email" aria-label="Email" /> Email
      </span>
      <span>
        <RadioGroupItem value="call" aria-label="Call" /> Call
      </span>
    </RadioGroup>
  );
}

describe('RadioGroup', () => {
  it('renders with the default value checked and is axe clean', async () => {
    const { container } = render(<ThreeOptions />);
    expect(screen.getByRole('radio', { name: 'SMS' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Email' }).getAttribute('aria-checked')).toBe('false');
    await expect(container).toHaveNoViolations();
  });

  it('arrow keys move roving focus, and Space selects the focused option (WAI-ARIA radio-group pattern)', async () => {
    const user = userEvent.setup();
    render(<ThreeOptions />);
    screen.getByRole('radio', { name: 'SMS' }).focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Email' })),
    );

    await user.keyboard(' ');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Email' }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
  });
});
