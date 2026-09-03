import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Label } from './label';

describe('Label', () => {
  it('renders its text', () => {
    render(<Label htmlFor="school-name">School name</Label>);
    expect(screen.getByText('School name')).toBeTruthy();
  });

  it('associates with its control via htmlFor, giving the control an accessible name', () => {
    render(
      <>
        <Label htmlFor="school-name">School name</Label>
        <input id="school-name" />
      </>,
    );
    expect(screen.getByRole('textbox', { name: 'School name' })).toBeTruthy();
  });

  it('clicking the label focuses the associated control', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Label htmlFor="school-name">School name</Label>
        <input id="school-name" />
      </>,
    );
    await user.click(screen.getByText('School name'));
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('is axe clean', async () => {
    const { container } = render(
      <>
        <Label htmlFor="school-name">School name</Label>
        <input id="school-name" />
      </>,
    );
    await expect(container).toHaveNoViolations();
  });
});
