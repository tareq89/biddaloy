import '@biddaloy/ui/test';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/schoolSupport.json';
import en from '../../../../../ui/src/i18n/locales/en/schoolSupport.json';

import { SupportAccessTab } from './support-access-tab';

const visit = (id: string, schoolId: string, who: string) => ({
  id,
  schoolId,
  schoolName: 'Rose Valley',
  platformAdminId: 'o-1',
  platformAdminName: who,
  userId: 'u-1',
  userName: 'Rahim',
  role: 'TEACHER',
  status: 'ENDED',
  kind: 'NORMAL',
  viewOnly: true,
  reason: 'Fee help',
  requestedAt: '2030-01-01T10:00:00.000Z',
  startedAt: '2030-01-01T10:00:00.000Z',
  endedAt: '2030-01-01T10:30:00.000Z',
  endedBy: null,
  expiresAt: null,
});
const serve = (mode: string, visits: unknown[]) =>
  server.use(
    http.get('*/platform/schools/:id/login-as/candidates', () =>
      HttpResponse.json({
        candidates: [],
        noActiveAdmin: false,
        schoolStatus: 'ACTIVE',
        supportAccessMode: mode,
      }),
    ),
    http.get('*/platform/impersonation', () => HttpResponse.json(visits)),
  );
const view = (onLoginAs?: () => void) =>
  renderWithProviders(<SupportAccessTab schoolId="s-1" {...(onLoginAs ? { onLoginAs } : {})} />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });

afterEach(async () => {
  await cleanupTestState();
});

describe('SupportAccessTab', () => {
  it('shows the setting read only and only this school visits, with Login as', async () => {
    serve('ask', [visit('a', 's-1', 'Owner One'), visit('b', 's-2', 'Other School Owner')]);
    const onLoginAs = vi.fn();
    const { container } = view(onLoginAs);
    expect(await screen.findByText('Ask each time')).toBeTruthy();
    expect(await screen.findByText('Owner One')).toBeTruthy();
    expect(screen.queryByText('Other School Owner')).toBeNull();
    expect(screen.getByText('Only a school admin can change this setting.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Login as' }));
    expect(onLoginAs).toHaveBeenCalled();
    await expect(container).toHaveNoViolations();
  });

  it('keeps 20 visits at most', async () => {
    serve(
      'allowed',
      Array.from({ length: 30 }, (_, i) => visit(`v${i}`, 's-1', `Owner ${i}`)),
    );
    view();
    await screen.findByText('Owner 0');
    const table = screen.getAllByRole('table')[0] as HTMLElement;
    expect(within(table).getAllByRole('row').length).toBeLessThanOrEqual(21);
  });

  it('empty state when nobody came in', async () => {
    serve('blocked', []);
    view();
    expect(await screen.findByText('Nobody has come into this school yet.')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
  });

  it('a failed load shows fixed sentences', async () => {
    server.use(
      http.get('*/platform/schools/:id/login-as/candidates', () =>
        HttpResponse.json({ message: 'leaky' }, { status: 500 }),
      ),
      http.get('*/platform/impersonation', () =>
        HttpResponse.json({ message: 'leaky' }, { status: 500 }),
      ),
    );
    view();
    expect(await screen.findByText("Could not load the school's setting.")).toBeTruthy();
    expect(await screen.findByText('Could not load the visits.')).toBeTruthy();
    expect(screen.queryByText(/leaky/)).toBeNull();
  });
});

describe('schoolSupport words (D14)', () => {
  const glossary = readFileSync(
    resolve(__dirname, '../../../../../docs/ux-research/tenant-control-glossary.md'),
    'utf8',
  );
  const NEVER =
    /\b(impersonate|impersonation|act as|acting as|break-glass|consent|session|sessions|revoke|kill|mode|policy|justification|user_id)\b|সেশন/i;
  const strings = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : Object.values(v as object).flatMap(strings);
  const keys = (v: unknown, p = ''): string[] =>
    typeof v === 'string'
      ? [p]
      : Object.entries(v as object).flatMap(([k, x]) => keys(x, `${p}.${k}`));

  it.each([
    ['en', en],
    ['bn', bn],
  ])('%s has no never-say word', (_lang, json) => {
    expect(strings(json).filter((s) => NEVER.test(s))).toEqual([]);
  });

  it('bn and en have the same keys', () => {
    expect(keys(bn)).toEqual(keys(en));
  });

  it('the glossary still lists the never-say words this test checks', () => {
    for (const w of ['impersonate', 'break-glass', 'consent', 'session', 'revoke']) {
      expect(glossary).toContain(w);
    }
  });
});
