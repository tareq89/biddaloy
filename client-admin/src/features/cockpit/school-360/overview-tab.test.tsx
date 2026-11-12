import '@biddaloy/ui/test';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/school360.json';
import en from '../../../../../ui/src/i18n/locales/en/school360.json';

import { formatFileSize, OverviewTab } from './overview-tab';

const view = () =>
  renderWithProviders(<OverviewTab schoolId="s-1" />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });

describe('OverviewTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the numbers from the overview', async () => {
    server.use(
      http.get('*/platform/schools/:id/overview', () =>
        HttpResponse.json({
          schoolId: 's-1',
          admins: [
            {
              userId: 'u1',
              name: 'Nabil Karim',
              email: null,
              phone: null,
              membershipStatus: 'ACTIVE',
            },
          ],
          peopleByRole: [{ role: 'TEACHER', count: 12 }],
          smsBalance: { available: 100, reserved: 5 },
          filesBytes: 2048,
          openAlerts: [{ severity: 'critical', count: 2 }],
          recentAudit: [
            {
              id: 'a1',
              action: 'UPDATE',
              entityType: 'fee_head',
              createdAt: '2029-12-30T00:00:00.000Z',
              actorName: 'Rahim',
              viaLoginAs: true,
            },
          ],
          lastActivityAt: '2029-12-30T00:00:00.000Z',
          notesCount: 0,
        }),
      ),
    );
    view();
    expect(await screen.findByText('Nabil Karim')).toBeTruthy();
    expect(screen.getByText(/Teacher: /)).toBeTruthy();
    expect(screen.getByText(/available, .* held/)).toBeTruthy();
    expect(screen.getByText(/KB/)).toBeTruthy();
    expect(screen.getByText(/via Login as/)).toBeTruthy();
  });

  it('shows empty states', async () => {
    server.use(
      http.get('*/platform/schools/:id/overview', () =>
        HttpResponse.json({
          schoolId: 's-1',
          admins: [],
          peopleByRole: [],
          openAlerts: [],
          recentAudit: [],
          lastActivityAt: null,
        }),
      ),
    );
    view();
    expect(await screen.findByText('This school has no admin yet.')).toBeTruthy();
    expect(screen.getByText('No open alerts.')).toBeTruthy();
    expect(screen.getByText('Never')).toBeTruthy();
  });

  it('shows a retry on error', async () => {
    server.use(
      http.get('*/platform/schools/:id/overview', () => HttpResponse.json({}, { status: 500 })),
    );
    view();
    expect(await screen.findByText('Could not load the overview.')).toBeTruthy();
  });

  it('formats file sizes', () => {
    expect(formatFileSize(500, String)).toBe('500 B');
    expect(formatFileSize(1536, String)).toBe('1.5 KB');
  });
});

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Object.values(v as object).flatMap(strings);
const keys = (v: unknown, p = ''): string[] =>
  typeof v === 'string'
    ? [p]
    : Object.entries(v as object).flatMap(([k, x]) => keys(x, `${p}.${k}`));

// Never-say words come from the glossary file itself (column 3) plus the D14 list.
const glossary = readFileSync(
  join(__dirname, '../../../../../docs/ux-research/tenant-control-glossary.md'),
  'utf8',
);
const never = glossary
  .split('\n')
  .filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('Never say'))
  .flatMap((l) => (l.split('|')[3] ?? '').split(','))
  .concat([
    'impersonate',
    'act as',
    'break-glass',
    'consent',
    'session',
    'revoke',
    'kill',
    'mode',
    'policy',
    'justification',
    'user_id',
  ])
  .map((w) => w.trim().toLowerCase())
  .filter((w) => /^[a-z_ -]{3,}$/.test(w));

describe('School 360 words', () => {
  it.each([
    ['en', en],
    ['bn', bn],
  ])('%s has no never-say word', (_lang, json) => {
    const hits = strings(json).filter((s) =>
      never.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(s)),
    );
    expect(hits).toEqual([]);
  });

  it('bn and en have the same keys', () => {
    expect(keys(bn)).toEqual(keys(en));
  });
});
