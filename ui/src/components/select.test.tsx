import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, i18n, whenReady } from '../i18n';

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

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: I18nProvider });

beforeEach(async () => {
  await whenReady(i18n);
  await i18n.changeLanguage('en');
});

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

  describe('empty trigger', () => {
    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    function Empty({ placeholder, className }: { placeholder?: string; className?: string }) {
      return (
        <Select>
          <SelectTrigger aria-label="Class" className={className}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="six">Six</SelectItem>
          </SelectContent>
        </Select>
      );
    }

    it('shows the translated default placeholder and is full width', async () => {
      render(<Empty />);
      const trigger = await screen.findByRole('combobox', { name: 'Class' });
      expect(await within(trigger).findByText('Select')).toBeTruthy();
      expect(trigger.className).toMatch(/(^| )w-full( |$)/);
      await i18n.changeLanguage('bn');
      expect(await screen.findByText('বাছুন')).toBeTruthy();
    });

    it('lets a caller placeholder and width win', () => {
      render(<Empty placeholder="Pick one" className="w-48" />);
      const trigger = screen.getByRole('combobox', { name: 'Class' });
      expect(trigger.textContent).toBe('Pick one');
      expect(trigger.className).toContain('w-48');
      expect(trigger.className).not.toMatch(/(^| )w-full( |$)/);
    });
  });
});
