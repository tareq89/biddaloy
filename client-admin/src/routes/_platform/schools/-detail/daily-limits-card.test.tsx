import '@biddaloy/ui/test';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { DailyLimitsCard } from './daily-limits-card';

const ID = 'school-1';
const URL = `*/platform/schools/${ID}/daily-limits`;
const view = (stored: object = {}) => ({
  stored,
  effective: { sms: 2000, email: 2000, whatsapp: 2000, showRemaining: false, ...stored },
  usedToday: { sms: 12, email: 3, whatsapp: 0 },
});
const render = (locale: 'en' | 'bn' = 'en') =>
  renderWithProviders(<DailyLimitsCard schoolId={ID} />, {
    locale,
    role: 'SUPER_ADMIN',
    tenantId: 'super-admin-own-tenant',
  });

afterEach(async () => {
  await cleanupTestState();
});

describe('DailyLimitsCard (school)', () => {
  it('shows the default hint and sent today', async () => {
    server.use(http.get(URL, () => HttpResponse.json(view())));
    render();
    expect((await screen.findAllByText('Platform default: ২,০০০')).length).toBe(3);
    expect(screen.getByText('Sent today: ১২')).toBeTruthy();
  });

  it('sends null for an empty box, the number for a filled one, and refreshes', async () => {
    let body: unknown;
    let gets = 0;
    server.use(
      http.get(URL, () => {
        gets += 1;
        return HttpResponse.json(view());
      }),
      http.put(URL, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(view({ sms: 500, showRemaining: true }));
      }),
    );
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText('SMS · Daily limit'), '500');
    await user.click(screen.getByRole('radio', { name: 'On' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(body).toEqual({ sms: 500, email: null, whatsapp: null, showRemaining: true }),
    );
    await waitFor(() => expect(gets).toBeGreaterThan(1));
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('shows a server refusal inline', async () => {
    server.use(
      http.get(URL, () => HttpResponse.json(view())),
      http.put(URL, () => HttpResponse.json({ message: 'bad' }, { status: 400 })),
    );
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't save");
  });

  it('refuses a non-number without calling the server', async () => {
    let puts = 0;
    server.use(
      http.get(URL, () => HttpResponse.json(view())),
      http.put(URL, () => {
        puts += 1;
        return HttpResponse.json(view());
      }),
    );
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByLabelText('SMS · Daily limit'), '12x');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toContain('whole number');
    expect(puts).toBe(0);
  });

  it('speaks Bangla', async () => {
    server.use(http.get(URL, () => HttpResponse.json(view())));
    render('bn');
    expect(await screen.findByRole('heading', { name: 'দিনের সীমা' })).toBeTruthy();
    expect(await screen.findByText('আজ পাঠানো হয়েছে: ১২')).toBeTruthy();
  });
});

describe('dailyLimits locale keys', () => {
  const load = (l: string) =>
    JSON.parse(
      readFileSync(
        resolve(__dirname, `../../../../../../ui/src/i18n/locales/${l}/platform.json`),
        'utf8',
      ),
    ).dailyLimits;
  const flat = (o: unknown, p = ''): Record<string, string> =>
    typeof o === 'string'
      ? { [p]: o }
      : Object.assign({}, ...Object.entries(o as object).map(([k, v]) => flat(v, `${p}.${k}`)));

  it('has the same keys in en and bn, and never says cap, quota, rate limit or throttle', () => {
    const en = flat(load('en'));
    const bn = flat(load('bn'));
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const v of [...Object.values(en), ...Object.values(bn)]) {
      expect(v).not.toMatch(/\b(cap|quota|rate limit|throttle)/i);
    }
  });
});
