import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Popover, PopoverContent, PopoverTrigger } from './popover';

describe('Popover', () => {
  it('renders closed by default and is axe clean', async () => {
    const { container } = render(
      <Popover>
        <PopoverTrigger>Open filters</PopoverTrigger>
        <PopoverContent>Filter options</PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText('Filter options')).toBeNull();
    await expect(container).toHaveNoViolations();
  });

  it('trigger opens the content', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open filters</PopoverTrigger>
        <PopoverContent>Filter options</PopoverContent>
      </Popover>,
    );
    await user.click(screen.getByText('Open filters'));
    expect(within(document.body).getByText('Filter options')).toBeTruthy();
  });

  it('Escape closes the content and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open filters</PopoverTrigger>
        <PopoverContent>Filter options</PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByText('Open filters');
    await user.click(trigger);
    expect(within(document.body).getByText('Filter options')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(within(document.body).queryByText('Filter options')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
