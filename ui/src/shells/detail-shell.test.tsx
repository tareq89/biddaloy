import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DetailShell, type DetailShellAction, type DetailShellTab } from './detail-shell';

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

describe('DetailShell', () => {
  it('renders the header: name, identifiers and status badge', () => {
    render(<Controlled />);
    expect(screen.getByRole('heading', { name: 'Rahim Uddin' })).toBeTruthy();
    expect(screen.getByText('ID: STU-1029 · Class Six')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('renders a real WAI-ARIA tablist with three tabs, the first selected by default', () => {
    render(<Controlled />);
    expect(screen.getByRole('tablist')).toBeTruthy();
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Payments' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('gates header actions by the allowed prop — hidden, not just disabled', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <Controlled
        actions={[
          { id: 'edit', label: 'Edit', onClick: onEdit, allowed: true },
          { id: 'delete', label: 'Delete', onClick: onDelete, allowed: false },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('an action with no allowed prop defaults to shown', () => {
    render(<Controlled actions={[{ id: 'edit', label: 'Edit', onClick: vi.fn() }]} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('clicking a tab activates it and shows its panel', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
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
    render(<Controlled />);
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
    render(<Controlled />);

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
    await user.click(screen.getByRole('tab', { name: 'Payments' }));

    // Still just the one mount from first activation — switching back
    // didn't remount it — and the typed note survived.
    expect(paymentsMounts).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc disagrees with eslint's type resolution here; the cast is required for `.value` to typecheck under `tsc --noEmit`.
    expect((screen.getByRole('textbox', { name: 'Payment note' }) as HTMLInputElement).value).toBe(
      'called about overdue fee',
    );
  });

  it('is axe clean', async () => {
    const { container } = render(<Controlled />);
    await expect(container).toHaveNoViolations();
  });
});
