import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { Building2Icon, WalletIcon } from 'lucide-react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveSettingsCategory, type SettingsCategoryId } from './settings-categories';
import { SettingsLayout, SettingsSection } from './settings-layout';

const TITLE = 'Profile';
const BODY = 'sections';
const ALL = new Set<SettingsCategoryId>([
  'school',
  'academics',
  'finance',
  'communication',
  'printing',
  'security',
  'backup',
]);
const noPrinting = new Set([...ALL].filter((id) => id !== 'printing'));

describe('resolveSettingsCategory', () => {
  it('lets ?section win', () => {
    expect(
      resolveSettingsCategory({ section: 'finance', backup: 'x', hash: 'printers-section' }, ALL),
    ).toBe('finance');
  });
  it('maps ?backup to backup', () => {
    expect(resolveSettingsCategory({ backup: 'job-1' }, ALL)).toBe('backup');
  });
  it('maps known hashes to their category', () => {
    expect(resolveSettingsCategory({ hash: 'printers-section' }, ALL)).toBe('printing');
    expect(resolveSettingsCategory({ hash: 'attendance-section' }, ALL)).toBe('academics');
  });
  it('ignores a category the user may not see', () => {
    expect(resolveSettingsCategory({ section: 'printing' }, noPrinting)).toBeUndefined();
    expect(resolveSettingsCategory({ hash: 'printers-section' }, noPrinting)).toBeUndefined();
  });
  it('returns undefined when nothing is chosen', () => {
    expect(resolveSettingsCategory({}, ALL)).toBeUndefined();
  });
});

const categories = [
  { id: 'school', label: 'School', icon: Building2Icon },
  { id: 'finance', label: 'Finance', icon: WalletIcon },
] as const;

function Mount({ children }: { children: React.ReactNode }) {
  const [router] = React.useState(() =>
    createRouter({
      routeTree: createRootRoute({ component: () => <>{children}</> }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    }),
  );
  return <RouterProvider router={router} />;
}

describe('SettingsLayout', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('with an active category the nav is desktop-only and the content shows', async () => {
    renderWithProviders(
      <Mount>
        <SettingsLayout categories={categories} active="finance" fallback="school">
          <p>{BODY}</p>
        </SettingsLayout>
      </Mount>,
      { locale: 'en' },
    );
    const nav = await screen.findByRole('navigation', { name: 'Settings categories' });
    expect(nav.className).toContain('hidden');
    expect(screen.getByText('sections').parentElement?.className).not.toContain('hidden');
    expect(screen.getByRole('link', { name: 'Finance' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'School' }).getAttribute('aria-current')).toBeNull();
  });

  it('with no active category the list shows on phone, the fallback is current', async () => {
    renderWithProviders(
      <Mount>
        <SettingsLayout categories={categories} active={undefined} fallback="school">
          <p>{BODY}</p>
        </SettingsLayout>
      </Mount>,
      { locale: 'en' },
    );
    const nav = await screen.findByRole('navigation', { name: 'Settings categories' });
    expect(nav.className).not.toContain('hidden');
    expect(screen.getByText('sections').parentElement?.className).toContain('hidden');
    expect(screen.getByRole('link', { name: 'School' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('SettingsSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders an h2 and a Save button only with onSubmit', () => {
    const { rerender } = renderWithProviders(
      <SettingsSection title={TITLE}>{BODY}</SettingsSection>,
      { locale: 'en' },
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Profile' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    rerender(
      <SettingsSection title={TITLE} onSubmit={() => undefined}>
        {BODY}
      </SettingsSection>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('advancedOpen opens the details', () => {
    const { container } = renderWithProviders(
      <SettingsSection title={TITLE} advanced={<p>{BODY}</p>} advancedOpen>
        {BODY}
      </SettingsSection>,
      { locale: 'en' },
    );
    expect(container.querySelector('details')?.open).toBe(true);
  });

  it('puts a header action next to the title when given', () => {
    renderWithProviders(
      <SettingsSection title={TITLE} actions={<button type="button">{BODY}</button>}>
        {BODY}
      </SettingsSection>,
      { locale: 'en' },
    );
    const heading = screen.getByRole('heading', { level: 2, name: TITLE });
    const action = screen.getByRole('button', { name: BODY });
    // Same header row: one wrapper contains both.
    expect(heading.closest('div[class*="md:justify-between"]')?.contains(action)).toBe(true);
  });
});
