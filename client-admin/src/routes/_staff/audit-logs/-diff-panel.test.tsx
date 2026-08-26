import { RegionConfigProvider, REGION_BD_BN, REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DiffPanel, type DiffPanelProps } from './-diff-panel';

function renderPanel(props: DiffPanelProps, locale: 'en' | 'bn' = 'en') {
  const element: ReactElement = (
    <RegionConfigProvider value={locale === 'bn' ? REGION_BD_BN : REGION_BD_EN}>
      <DiffPanel {...props} />
    </RegionConfigProvider>
  );
  return renderWithProviders(element, { locale, tenantId: 'tenant-1' });
}

/** The row a changed/unchanged field renders into, found by its field label. */
function rowFor(label: string) {
  return screen.getByRole('cell', { name: new RegExp(`^${label}\\b`) }).closest('tr');
}

describe('DiffPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders a before/after row for each changed field', async () => {
    renderPanel({
      oldValues: { full_name: 'Rahim' },
      newValues: { full_name: 'Rahim Uddin' },
    });

    expect(await screen.findByRole('cell', { name: /^Full name/ })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Rahim' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Rahim Uddin' })).toBeTruthy();
  });

  // The acceptance criterion this panel exists for: colour is never the
  // only signal. Every changed field carries the literal word "Changed".
  it('marks a changed field with a text marker, not colour alone', async () => {
    renderPanel({
      oldValues: { full_name: 'Rahim' },
      newValues: { full_name: 'Rahim Uddin' },
    });

    await screen.findByRole('cell', { name: /^Full name/ });
    const row = rowFor('Full name');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Changed')).toBeTruthy();
  });

  it('hides unchanged fields behind a disclosure and reveals them on click', async () => {
    renderPanel({
      oldValues: { full_name: 'Rahim', roll_number: 12, gender: 'M' },
      newValues: { full_name: 'Rahim Uddin', roll_number: 12, gender: 'M' },
    });

    const toggle = await screen.findByRole('button', { name: 'Show 2 unchanged fields' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('cell', { name: /^Roll number/ })).toBeNull();

    const user = userEvent.setup();
    await user.click(toggle);

    expect(await screen.findByRole('cell', { name: /^Roll number/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide 2 unchanged fields' })).toBeTruthy();
  });

  it('uses the singular disclosure label for exactly one unchanged field', async () => {
    renderPanel({
      oldValues: { full_name: 'Rahim', gender: 'M' },
      newValues: { full_name: 'Rahim Uddin', gender: 'M' },
    });

    expect(await screen.findByRole('button', { name: 'Show 1 unchanged field' })).toBeTruthy();
  });

  // LOGIN/LOGOUT and friends record an event, not an edit — the panel says
  // so rather than rendering an empty table.
  it('explains that an event row has no field changes', async () => {
    renderPanel({ oldValues: null, newValues: null });

    expect(
      await screen.findByText(
        'This entry records an event, not an edit, so no field values changed.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  // An UPDATE whose two snapshots turn out identical — a header-only
  // table with no rows would read as broken.
  it('explains itself when nothing in the snapshot actually changed', async () => {
    renderPanel({
      oldValues: { full_name: 'Rahim', roll_number: 12 },
      newValues: { full_name: 'Rahim', roll_number: 12 },
    });

    expect(
      await screen.findByText(
        'None of this record’s fields changed — only the unchanged values below were recorded.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show 2 unchanged fields' })).toBeTruthy();
  });

  it('renders a missing before value as an em dash, never as "null"', async () => {
    renderPanel({ oldValues: null, newValues: { name: 'Monthly Tuition' } });

    await screen.findByRole('cell', { name: /^Name/ });
    const row = rowFor('Name');
    expect(within(row!).getByText('—')).toBeTruthy();
    expect(screen.queryByText('null')).toBeNull();
  });

  it('renders booleans as Yes/No and dates through the region config', async () => {
    renderPanel({
      oldValues: { is_active: true, admission_date: '2026-01-05' },
      newValues: { is_active: false, admission_date: '2026-02-06' },
    });

    await screen.findByRole('cell', { name: /^Active/ });
    expect(screen.getByRole('cell', { name: 'Yes' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'No' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '2026-01-05' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '2026-02-06' })).toBeTruthy();
  });

  it('flattens a one-level nested object into labelled lines instead of JSON', async () => {
    renderPanel({
      oldValues: null,
      newValues: { meta: { created: 42, skipped: 3 } },
    });

    expect(await screen.findByText('Records created: 42')).toBeTruthy();
    expect(screen.getByText('Records skipped: 3')).toBeTruthy();
  });

  it('renders values in Bangla for a Bangla locale', async () => {
    const { localeReady } = renderPanel(
      { oldValues: { is_active: true }, newValues: { is_active: false } },
      'bn',
    );
    await localeReady;

    expect(await screen.findByRole('cell', { name: /^সক্রিয়/ })).toBeTruthy();
    expect(screen.getByText('পরিবর্তিত')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'হ্যাঁ' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'না' })).toBeTruthy();
  });

  it('is axe clean', async () => {
    const { container } = renderPanel({
      oldValues: { full_name: 'Rahim', roll_number: 12 },
      newValues: { full_name: 'Rahim Uddin', roll_number: 12 },
    });

    await screen.findByRole('cell', { name: /^Full name/ });
    await expect(container).toHaveNoViolations();
  });
});
