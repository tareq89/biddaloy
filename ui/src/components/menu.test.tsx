import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from './menu';

function RowActionsMenu({ onEdit }: { onEdit: () => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button iconOnly aria-label="Row actions">
          ⋮
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={onEdit}>Edit</MenuItem>
        <MenuItem>Delete</MenuItem>
      </MenuContent>
    </Menu>
  );
}

describe('Menu', () => {
  it('opens on trigger click and is axe clean', async () => {
    const user = userEvent.setup();
    const { container } = render(<RowActionsMenu onEdit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('opens with the keyboard, highlighting the first item, and ArrowDown moves to the next one', async () => {
    const user = userEvent.setup();
    render(<RowActionsMenu onEdit={vi.fn()} />);
    screen.getByRole('button', { name: 'Row actions' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' })),
    );

    await user.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' })),
    );
  });

  it('Enter on an item selects it', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<RowActionsMenu onEdit={onEdit} />);
    await user.click(screen.getByRole('button', { name: 'Row actions' }));
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<RowActionsMenu onEdit={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Row actions' });
    await user.click(trigger);
    await screen.findByRole('menu');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('renders checkbox items, radio items, labels, separators and submenus', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Menu defaultOpen>
        <MenuTrigger asChild>
          <Button iconOnly aria-label="Column options">
            ⋮
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>Columns</MenuLabel>
          <MenuGroup>
            <MenuCheckboxItem checked>Fee</MenuCheckboxItem>
            <MenuCheckboxItem>Payment date</MenuCheckboxItem>
          </MenuGroup>
          <MenuSeparator />
          <MenuRadioGroup value="asc">
            <MenuRadioItem value="asc">Ascending</MenuRadioItem>
            <MenuRadioItem value="desc">Descending</MenuRadioItem>
          </MenuRadioGroup>
          <MenuSub>
            <MenuSubTrigger>More</MenuSubTrigger>
            <MenuSubContent>
              <MenuItem>
                Export <MenuShortcut>⌘E</MenuShortcut>
              </MenuItem>
            </MenuSubContent>
          </MenuSub>
        </MenuContent>
      </Menu>,
    );

    expect(screen.getByRole('menuitemcheckbox', { name: 'Fee' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(
      screen.getByRole('menuitemradio', { name: 'Ascending' }).getAttribute('aria-checked'),
    ).toBe('true');
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Payment date' }));
    await expect(container).toHaveNoViolations();
  });
});
