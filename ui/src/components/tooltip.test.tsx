import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

function HelpTooltip() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button iconOnly aria-label="What is this?">
            ?
          </Button>
        </TooltipTrigger>
        <TooltipContent>Enrollment status for the current term</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe('Tooltip', () => {
  it('shows on keyboard focus, not just hover — a keyboard user must be able to see it', async () => {
    const user = userEvent.setup();
    render(<HelpTooltip />);
    expect(screen.queryByText('Enrollment status for the current term')).toBeNull();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'What is this?' }));
    expect(await screen.findByText('Enrollment status for the current term')).toBeTruthy();
  });

  it('hides on Escape', async () => {
    const user = userEvent.setup();
    render(<HelpTooltip />);
    await user.tab();
    await screen.findByText('Enrollment status for the current term');

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByText('Enrollment status for the current term')).toBeNull(),
    );
  });
});
