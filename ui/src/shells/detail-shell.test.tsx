import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test';

import { DetailShell, type DetailShellAction, type DetailShellTab } from './detail-shell';

/** `DEFAULT_LOCALE` is Bengali, not English — force `en` and await
 * `localeReady` before any synchronous assertion. */
async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
  });
  return view;
}

let overviewMounts = 0;
let paymentsMounts = 0;

// `useEffect` with an empty dependency array fires exactly once per true
// mount — unlike a counter in the component body, which increments on
// every re-render regardless of whether the component actually
// unmounted and remounted. That distinction is the whole point of this
// test: DetailShell keeps a visited panel *hidden*, not *unmounted*, so
// its parent (`Controlled`) re-rendering on every tab switch should not
// remount it.
function OverviewPanel() {
  useEffect(() => {
    overviewMounts += 1;
  }, []);
  return <p>Overview content</p>;
}

function PaymentsPanel() {
  useEffect(() => {
    paymentsMounts += 1;
  }, []);
  const [note, setNote] = useState('');
  return (
    <div>
      <p>Payments content</p>
      <input
        aria-label="Payment note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </div>
  );
}

function makeTabs(): DetailShellTab[] {
  return [
    { id: 'overview', label: 'Overview', content: <OverviewPanel /> },
    { id: 'payments', label: 'Payments', content: <PaymentsPanel /> },
    { id: 'documents', label: 'Documents', content: <p>Documents content</p> },
  ];
}

function Controlled({ actions = [] }: { actions?: DetailShellAction[] }) {
  const [activeTab, setActiveTab] = useState('overview');
  return (
    <DetailShell
      name="Rahim Uddin"
      identifiers={<span>ID: STU-1029 · Class Six</span>}
      statusBadge={<span>Active</span>}
      actions={actions}
      tabs={makeTabs()}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    />
  );
}

function panelOf(tabName: string): HTMLElement {
  const id = screen.getByRole('tab', { name: tabName }).getAttribute('aria-controls');
  return document.getElementById(id ?? '') as HTMLElement;
}

describe('DetailShell', () => {
  it('shows exactly one panel after visiting another tab (B1)', async () => {
    const user = userEvent.setup();
    await renderInEnglish(<Controlled />);
    await user.click(screen.getByRole('tab', { name: 'Payments' }));
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    const panels = screen.getAllByRole('tabpanel');
    expect(panels).toHaveLength(1);
    expect(panels[0]).toBe(panelOf('Overview'));
    expect(panelOf('Payments').hidden).toBe(true);
  });

  it('renders facts as dt/dd pairs', async () => {
    await renderInEnglish(
      <DetailShell name="X" facts={[{ label: 'Class', value: 'Six' }]}>
        body
      </DetailShell>,
    );
    expect(screen.getByText('Class').tagName).toBe('DT');
    expect(screen.getByText('Six').tagName).toBe('DD');
  });

  it.each([undefined, []])('renders children and no tablist when tabs is %j', async (tabs) => {
    await renderInEnglish(
      <DetailShell name="Rahim" {...(tabs ? { tabs } : {})}>
        <p>Body</p>
      </DetailShell>,
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('Body')).toBeTruthy();
  });

  it('scrolls the active tab into view on mount and on change', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const user = userEvent.setup();
    await renderInEnglish(<Controlled />);
    expect(spy.mock.contexts.at(-1)).toBe(screen.getByRole('tab', { name: 'Overview' }));
    await user.click(screen.getByRole('tab', { name: 'Payments' }));
    expect(spy.mock.contexts.at(-1)).toBe(screen.getByRole('tab', { name: 'Payments' }));
    // @ts-expect-error restore jsdom's lack of it
    delete Element.prototype.scrollIntoView;
  });

  it('renders the header: name, identifiers and status badge', async () => {
    await renderInEnglish(<Controlled />);
    expect(screen.getByRole('heading', { name: 'Rahim Uddin' })).toBeTruthy();
    expect(screen.getByText('ID: STU-1029 · Class Six')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('renders a real WAI-ARIA tablist with three tabs, the first selected by default', async () => {
    await renderInEnglish(<Controlled />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Payments' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('gates header actions by the allowed prop — hidden, not just disabled', async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    await renderInEnglish(
      <Controlled
        actions={[
          { id: 'edit', label: 'Edit', onClick: onEdit, allowed: true, priority: 'primary' },
          {
            id: 'delete',
            label: 'Delete',
            onClick: onDelete,
            allowed: false,
            priority: 'destructive',
          },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('an action with no allowed prop defaults to shown', async () => {
    await renderInEnglish(
      <Controlled actions={[{ id: 'edit', label: 'Edit', onClick: vi.fn() }]} />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('clicking a tab activates it and shows its panel', async () => {
    const user = userEvent.setup();
    await renderInEnglish(<Controlled />);
    await user.click(screen.getByRole('tab', { name: 'Payments' }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Payments' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    expect(screen.getByText('Payments content')).toBeTruthy();
  });

  it('ArrowRight/ArrowLeft move between tabs, and Home/End jump to first/last', async () => {
    const user = userEvent.setup();
    await renderInEnglish(<Controlled />);
    screen.getByRole('tab', { name: 'Overview' }).focus();

    await user.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Payments' })),
    );

    await user.keyboard('{End}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Documents' })),
    );

    await user.keyboard('{Home}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Overview' })),
    );

    await user.keyboard('{ArrowLeft}');
    // Wraps around from the first tab to the last — Radix's own behaviour.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Documents' })),
    );
  });

  it('lazy-loads a panel on first activation, then keeps it mounted (cached) when switching away', async () => {
    overviewMounts = 0;
    paymentsMounts = 0;
    const user = userEvent.setup();
    await renderInEnglish(<Controlled />);

    expect(overviewMounts).toBe(1);
    expect(paymentsMounts).toBe(0); // never activated -> never mounted

    await user.click(screen.getByRole('tab', { name: 'Payments' }));
    await waitFor(() => expect(paymentsMounts).toBe(1));

    // Real local state, not just a render count — the strongest proof
    // "cached" actually means the component instance survives, not just
    // that its DOM happens to look the same.
    await user.type(
      screen.getByRole('textbox', { name: 'Payment note' }),
      'called about overdue fee',
    );

    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(panelOf('Payments').hidden).toBe(true);
    await user.click(screen.getByRole('tab', { name: 'Payments' }));

    // Still just the one mount from first activation — switching back
    // didn't remount it — and the typed note survived.
    expect(paymentsMounts).toBe(1);
    expect(panelOf('Payments').hidden).toBe(false);

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Payment note' }).value).toBe(
      'called about overdue fee',
    );
  });

  it('is axe clean', async () => {
    const { container } = await renderInEnglish(<Controlled />);
    await expect(container).toHaveNoViolations();
  });

  describe('action hierarchy', () => {
    function tierActions(): DetailShellAction[] {
      return [
        { id: 'edit', label: 'Edit', onClick: vi.fn(), priority: 'secondary' },
        { id: 'collect-fees', label: 'Collect fees', onClick: vi.fn(), priority: 'primary' },
        { id: 'send-reminder', label: 'Send reminder', onClick: vi.fn(), priority: 'tertiary' },
        {
          id: 'transfer-status',
          label: 'Transfer / change status',
          onClick: vi.fn(),
          priority: 'tertiary',
        },
        { id: 'delete', label: 'Delete', onClick: vi.fn(), priority: 'destructive' },
      ];
    }

    it('priority "primary" renders a default-variant button, "secondary" renders outline', async () => {
      await renderInEnglish(<Controlled actions={tierActions()} />);
      const primaryButton = screen.getByRole('button', { name: 'Collect fees' });
      const secondaryButton = screen.getByRole('button', { name: 'Edit' });
      expect(primaryButton.className).toMatch(/bg-primary/);
      expect(secondaryButton.className).not.toMatch(/bg-primary/);
    });

    it('an action with no priority renders as outline (the safe default)', async () => {
      await renderInEnglish(
        <Controlled actions={[{ id: 'edit', label: 'Edit', onClick: vi.fn() }]} />,
      );
      const button = screen.getByRole('button', { name: 'Edit' });
      expect(button.className).not.toMatch(/bg-primary/);
    });

    it('tertiary actions do not appear as buttons — only as menu items behind the overflow trigger', async () => {
      await renderInEnglish(<Controlled actions={tierActions()} />);
      expect(screen.queryByRole('button', { name: 'Send reminder' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Send reminder' })).toBeNull();

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'More actions' }));
      expect(await screen.findByRole('menuitem', { name: 'Send reminder' })).toBeTruthy();
    });

    it('with tertiary actions present, the destructive action renders as a menu item with a separator above it', async () => {
      const user = userEvent.setup();
      await renderInEnglish(<Controlled actions={tierActions()} />);
      await user.click(screen.getByRole('button', { name: 'More actions' }));
      const menu = await screen.findByRole('menu');
      const items = within(menu).getAllByRole('menuitem');
      const deleteIndex = items.findIndex((item) => item.textContent === 'Delete');
      expect(deleteIndex).toBeGreaterThan(0);
      expect(within(menu).getByRole('separator')).toBeTruthy();
    });

    it('with no tertiary actions, a lone destructive action renders inline and the overflow trigger is phone-only', async () => {
      await renderInEnglish(
        <Controlled
          actions={[
            { id: 'edit', label: 'Edit', onClick: vi.fn(), priority: 'primary' },
            { id: 'delete', label: 'Delete', onClick: vi.fn(), priority: 'destructive' },
          ]}
        />,
      );
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
      // Phone-only overflow trigger: hidden from md up.
      expect(screen.getByRole('button', { name: 'More actions' }).className).toContain('md:hidden');
    });

    it('renders the tab list as a scrolling line row, not a wrapping one', async () => {
      await renderInEnglish(<Controlled />);
      const list = screen.getByRole('tablist');
      expect(list.className).toContain('overflow-x-auto');
      expect(list.className).not.toContain('flex-wrap');
      expect(list.getAttribute('data-variant')).toBe('line');
    });

    it('renders secondaries before the primary, right-most', async () => {
      await renderInEnglish(<Controlled actions={tierActions()} />);
      const labels = screen
        .getAllByRole('button')
        .map((button) => button.textContent)
        .filter((label): label is string => label !== null && label !== 'More actions');
      expect(labels.indexOf('Edit')).toBeLessThan(labels.indexOf('Collect fees'));
    });

    it('the overflow menu is keyboard-operable: Enter opens it, ArrowDown moves focus, Escape closes it and returns focus to the trigger', async () => {
      const user = userEvent.setup();
      await renderInEnglish(<Controlled actions={tierActions()} />);
      const trigger = screen.getByRole('button', { name: 'More actions' });
      trigger.focus();

      await user.keyboard('{Enter}');
      const menu = await screen.findByRole('menu');
      await user.keyboard('{ArrowDown}');
      await waitFor(() => {
        const items = within(menu).getAllByRole('menuitem');
        expect(items).toContain(document.activeElement);
      });

      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    });

    it('warns in dev when two visible actions declare priority "primary"', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await renderInEnglish(
        <Controlled
          actions={[
            { id: 'edit', label: 'Edit', onClick: vi.fn(), priority: 'primary' },
            { id: 'collect-fees', label: 'Collect fees', onClick: vi.fn(), priority: 'primary' },
          ]}
        />,
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toContain('edit');
      expect(warnSpy.mock.calls[0]?.[0]).toContain('collect-fees');
      warnSpy.mockRestore();
    });

    it('is axe clean with the overflow menu open', async () => {
      const user = userEvent.setup();
      const { container } = await renderInEnglish(<Controlled actions={tierActions()} />);
      await user.click(screen.getByRole('button', { name: 'More actions' }));
      await screen.findByRole('menu');
      await expect(container).toHaveNoViolations();
    });
  });
});
