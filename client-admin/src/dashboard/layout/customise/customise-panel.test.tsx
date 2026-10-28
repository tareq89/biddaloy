import '@biddaloy/ui/test';

import { ROLE_DEFAULT_LAYOUTS, UserRole } from '@biddaloy/shared';
import { WIDGET_CATALOGUE } from '@biddaloy/shared';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveLayout } from '../resolve-layout';

import { customiseReducer } from './customise-draft';
import { CustomisePanel } from './customise-panel';

const onSave = vi.fn();
const onCancel = vi.fn();
const onReset = vi.fn();

function Harness({ error }: { error?: unknown }) {
  const [draft, dispatch] = React.useReducer(customiseReducer, undefined, () => {
    const { visible, hidden } = resolveLayout({
      role: UserRole.EXECUTIVE,
      pref: undefined,
      catalogue: WIDGET_CATALOGUE,
      defaults: ROLE_DEFAULT_LAYOUTS,
      can: () => true,
    });
    return { shown: visible, hidden };
  });
  return (
    <CustomisePanel
      draft={draft}
      role={UserRole.EXECUTIVE}
      onAction={dispatch}
      onSave={onSave}
      onCancel={onCancel}
      onReset={onReset}
      error={error}
    />
  );
}

const show = () => renderWithProviders(<Harness />, { locale: 'en', role: 'EXECUTIVE' });
const firstTitle = 'Student attendance today';
const secondTitle = 'Teachers and staff';

describe('CustomisePanel', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await cleanupTestState();
  });

  it('Space on a focused checkbox hides the widget and announces it', async () => {
    show();
    const box = await screen.findByRole('checkbox', { name: new RegExp(firstTitle) });
    box.focus();
    await userEvent.keyboard(' ');
    expect(screen.getByText(`${firstTitle} hidden`)).toBeTruthy();
    const hiddenList = screen.getAllByRole('list')[1]!;
    expect(within(hiddenList).getByRole('checkbox', { name: new RegExp(firstTitle) })).toBeTruthy();
  });

  it('Alt+ArrowDown moves the row and focus stays on it', async () => {
    show();
    const box = await screen.findByRole('checkbox', { name: new RegExp(firstTitle) });
    box.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    const moved = screen.getByRole('checkbox', { name: new RegExp(firstTitle) });
    expect(document.activeElement).toBe(moved);
    const rows = within(screen.getAllByRole('list')[0]!).getAllByRole('listitem');
    expect(rows[1]!.textContent).toContain(firstTitle);
    expect(rows[0]!.textContent).toContain(secondTitle);
    expect(screen.getByText(`${firstTitle} is now at position 2`)).toBeTruthy();
  });

  it('Alt+ArrowUp on the first row does nothing', async () => {
    show();
    const box = await screen.findByRole('checkbox', { name: new RegExp(firstTitle) });
    box.focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    const rows = within(screen.getAllByRole('list')[0]!).getAllByRole('listitem');
    expect(rows[0]!.textContent).toContain(firstTitle);
  });

  it('up/down buttons are disabled at the ends and on hidden rows', async () => {
    show();
    const up = await screen.findByRole('button', { name: `Move ${firstTitle} up` });
    expect((up as HTMLButtonElement).disabled).toBe(true);
    const shownRows = within(screen.getAllByRole('list')[0]!).getAllByRole('listitem');
    const last = shownRows.at(-1)!;
    const lastDown = within(last).getByRole('button', { name: /down$/ });
    expect((lastDown as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: new RegExp(firstTitle) }));
    const hiddenRow = within(screen.getAllByRole('list')[1]!).getAllByRole('listitem')[0]!;
    for (const b of within(hiddenRow).getAllByRole('button', { name: /^Move/ })) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('Enter on a checkbox saves; Escape cancels', async () => {
    show();
    const box = await screen.findByRole('checkbox', { name: new RegExp(firstTitle) });
    box.focus();
    await userEvent.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Enter on Cancel only cancels, it does not also save', async () => {
    show();
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    cancel.focus();
    await userEvent.keyboard('{Enter}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('the size select offers only the catalogue sizes and changes the size', async () => {
    show();
    const trigger = await screen.findByRole('combobox', { name: `Size of ${firstTitle}` });
    await userEvent.click(trigger);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Small', 'Medium']);
    await userEvent.click(screen.getByRole('option', { name: 'Medium' }));
    expect(trigger.textContent).toContain('Medium');
  });

  it('shows a mutation error above the footer', async () => {
    renderWithProviders(<Harness error={new Error('Too many widgets')} />, {
      locale: 'en',
      role: 'EXECUTIVE',
    });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
