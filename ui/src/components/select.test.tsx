import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';

function ClassPicker() {
  return (
    <Select defaultValue="six">
      <SelectTrigger aria-label="Class">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="six">Six</SelectItem>
        <SelectItem value="seven">Seven</SelectItem>
        <SelectItem value="eight">Eight</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe('Select', () => {
  it('renders the default value on the trigger and is axe clean closed', async () => {
    const { container } = render(<ClassPicker />);
    expect(screen.getByRole('combobox', { name: 'Class' }).textContent).toBe('Six');
    await expect(container).toHaveNoViolations();
  });

  it('opens on click and selecting an option updates the trigger', async () => {
    const user = userEvent.setup();
    render(<ClassPicker />);
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Seven' }));
    expect(screen.getByRole('combobox', { name: 'Class' }).textContent).toBe('Seven');
  });

  it('opens with the keyboard (Enter) and is navigable with arrow keys', async () => {
    const user = userEvent.setup();
    render(<ClassPicker />);
    const trigger = screen.getByRole('combobox', { name: 'Class' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('listbox')).toBeTruthy();

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox', { name: 'Class' }).textContent).toBe('Seven');
  });

  it('shows a placeholder when nothing is selected, and supports grouped/labelled/separated options', async () => {
    const user = userEvent.setup();
    render(
      <Select>
        <SelectTrigger aria-label="Class">
          <SelectValue placeholder="Select a class" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Lower</SelectLabel>
            <SelectItem value="six">Six</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Upper</SelectLabel>
            <SelectItem value="seven">Seven</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole('combobox', { name: 'Class' }).textContent).toBe('Select a class');

    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    expect(await screen.findByText('Upper')).toBeTruthy();
    await user.click(screen.getByRole('option', { name: 'Seven' }));
    expect(screen.getByRole('combobox', { name: 'Class' }).textContent).toBe('Seven');
  });

  // [8.14.13]: disabled controls were near-invisible (grey text on a
  // barely-tinted background) — see `select.tsx`'s own disabled classes
  // for the fix. Asserts the opaque `bg-muted`/`text-muted-foreground`
  // pair replaced the old halve-everything `opacity-50` treatment, the
  // same direction [8.13.10] already took on `button.tsx`.
  it('gives a disabled trigger a deliberately visible treatment, not a halved-opacity one', () => {
    render(
      <Select disabled>
        <SelectTrigger aria-label="Class">
          <SelectValue placeholder="Select a class" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="six">Six</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Class' });
    expect(trigger.className).toContain('disabled:bg-muted');
    expect(trigger.className).toContain('disabled:text-muted-foreground');
    expect(trigger.className).toContain('disabled:opacity-100');
    expect(trigger.className).not.toContain('disabled:opacity-50');
  });
});
