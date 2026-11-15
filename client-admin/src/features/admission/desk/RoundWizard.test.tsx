import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ADMISSION_TEMPLATES, AdmissionTemplateKey } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { feeToPaisa, initialWizardState, MAX_SEATS, RoundWizard } from './RoundWizard';

afterEach(async () => {
  await cleanupTestState();
});

const YEARS = {
  data: [{ id: 'y1', name: '2027', is_current: true }],
  total: 1,
  page: 1,
  limit: 100,
  totalPages: 1,
};
const classes = (rows: { id: string; name: string }[]) =>
  http.get('/api/v1/classes', () =>
    HttpResponse.json({ data: rows, total: rows.length, page: 1, limit: 100, totalPages: 1 }),
  );
const tree = createRootRoute({ component: RoundWizard });
const render = () => {
  server.use(http.get('/api/v1/academic-years', () => HttpResponse.json(YEARS)));
  return renderWithRouter(tree, {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
};
const next = () => screen.getByRole('button', { name: 'Next' });

describe('RoundWizard', () => {
  it('each template pre-ticks its own fields', () => {
    for (const key of Object.values(AdmissionTemplateKey)) {
      expect(ADMISSION_TEMPLATES[key].fields.length).toBeGreaterThan(0);
    }
    // the default kind starts with exactly its template fields ticked
    expect(initialWizardState('2027-01-01').fields).toEqual(
      ADMISSION_TEMPLATES[AdmissionTemplateKey.WRITTEN].fields,
    );
  });

  it('picking another kind re-ticks that kind’s fields', async () => {
    server.use(classes([{ id: 'c1', name: 'One' }]));
    render();
    await userEvent.click(await screen.findByRole('radio', { name: 'GPA merit' }));
    await userEvent.click(next());
    await userEvent.click(next());
    const ssc = await screen.findByRole('checkbox', { name: /SSC GPA/i });
    expect(ssc.getAttribute('aria-checked')).toBe('true');
  });

  it('Next is enabled with the defaults', async () => {
    server.use(classes([{ id: 'c1', name: 'One' }]));
    render();
    await screen.findByText('One');
    expect((next() as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(next());
    expect((next() as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(next());
    expect((next() as HTMLButtonElement).disabled).toBe(false);
  });

  it('a missing class blocks step 1', async () => {
    server.use(classes([]));
    render();
    expect(await screen.findByText('Choose a class.')).toBeTruthy();
    expect((next() as HTMLButtonElement).disabled).toBe(true);
  });

  it('the fee refuses more than 2 decimals', async () => {
    expect(feeToPaisa('')).toBeNull();
    expect(feeToPaisa('250')).toBe(25000);
    expect(feeToPaisa('250.5')).toBe(25050);
    expect(feeToPaisa('250.55')).toBe(25055);
    expect(feeToPaisa('250.555')).toBeUndefined();
    server.use(classes([{ id: 'c1', name: 'One' }]));
    render();
    await screen.findByText('One');
    await userEvent.click(next());
    await userEvent.click(next());
    await userEvent.type(await screen.findByLabelText(/^Fee/), '250.555');
    expect(await screen.findByText(/at most 2 digits/)).toBeTruthy();
    expect((next() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('RoundWizard guards', () => {
  it('a fee needs at least one way to send it; fee 0 counts as no fee', async () => {
    expect(feeToPaisa('0')).toBe(0);
    server.use(classes([{ id: 'c1', name: 'One' }]));
    render();
    await screen.findByText('One');
    await userEvent.click(next());
    await userEvent.click(next());
    await userEvent.click(await screen.findByRole('checkbox', { name: 'bKash' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Nagad' }));
    expect((next() as HTMLButtonElement).disabled).toBe(false); // no fee yet, no method needed
    await userEvent.type(screen.getByLabelText(/^Fee/), '100');
    expect(await screen.findByText('Choose at least one way to send the fee.')).toBeTruthy();
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Rocket' }));
    expect((next() as HTMLButtonElement).disabled).toBe(false);
    await userEvent.clear(screen.getByLabelText(/^Fee/));
    await userEvent.type(screen.getByLabelText(/^Fee/), '0');
    expect((next() as HTMLButtonElement).disabled).toBe(false);
  });

  it('seats above the cap block step 2', async () => {
    server.use(classes([{ id: 'c1', name: 'One' }]));
    render();
    await screen.findByText('One');
    await userEvent.click(next());
    const seats = await screen.findByLabelText('Seats');
    await userEvent.clear(seats);
    await userEvent.type(seats, String(MAX_SEATS + 1));
    expect(await screen.findByText(/from 1 to 100,000/)).toBeTruthy();
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(seats);
    await userEvent.type(seats, String(MAX_SEATS));
    expect((next() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('glossary: words the bn screens never say [Epic 71]', () => {
  const NEVER = [
    'ইনটেক',
    'ব্যাচ',
    'পাইপলাইন',
    'ফেজ',
    'ওয়ার্কফ্লো',
    'র‍্যাঙ্ক',
    'ওয়েটলিস্ট',
    'স্ট্যান্ডবাই',
    'ক্যাপাসিটি',
    'স্লট',
    'রিকনসিলিয়েশন',
    'ভেরিফিকেশন',
    'এনরোল',
    'কনফার্ম',
    'অ্যাপ্রুভ',
    'রিজেক্ট',
    'সিরিয়াল',
    'পাবলিক ফর্ম',
    'স্কোর',
    'গ্রেডিং',
    'র‍্যান্ডমাইজ',
    'আউটরিচ',
    'এক্সপায়ারি',
    'আনপেইড',
    'ভর্তি পর্ব',
  ];
  const root = resolve(__dirname, '../../../../../ui/src/i18n/locales/bn');
  for (const file of ['admission-desk.json', 'admission-staff-intakes.json']) {
    it(`${file} has none`, () => {
      const text = readFileSync(resolve(root, file), 'utf8');
      expect(NEVER.filter((w) => text.includes(w))).toEqual([]);
    });
  }
});
