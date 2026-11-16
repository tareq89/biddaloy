import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { StagePanel } from './StagePanel';
import { chunk } from './StageScoreGrid';

afterEach(async () => {
  await cleanupTestState();
});

const root = createRootRoute();
const tree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: '/rounds/$roundId', component: StagePanel }),
]);

const stage = (over: object = {}) => ({
  id: 's1',
  intake_id: 'r1',
  position: 1,
  kind: 'WRITTEN',
  title: null,
  config: {},
  date: '2027-01-10',
  start_time: '10:00',
  venue: 'Hall',
  max_score: 100,
  mode: 'SCORE',
  cutoff_committed_at: null,
  ...over,
});
const applicant = (id: string, roll: string, name: string) => ({
  id,
  applicant_name: name,
  roll_number: roll,
  status: 'PENDING',
});

function setup(stageOver: object = {}, count = 3, savedRows: object[] = []) {
  const puts: { results: Record<string, unknown>[] }[] = [];
  const rows = Array.from({ length: count }, (_, i) =>
    applicant(`a${i}`, `R${i + 1}`, `Name ${i}`),
  );
  server.use(
    http.get('/api/v1/admission-intakes/r1/stages', () => HttpResponse.json([stage(stageOver)])),
    http.get('/api/v1/admission/applicants', () =>
      HttpResponse.json({ data: rows, total: rows.length, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('/api/v1/admission/stages/s1/results', () =>
      HttpResponse.json({
        data: savedRows,
        total: savedRows.length,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.post('/api/v1/admission/stages/s1/cutoff/preview', () =>
      HttpResponse.json({
        passing: [],
        failing: [],
        passing_rows: [],
        failing_rows: [{ applicant_id: 'a0', roll: 'R1', name: 'Name 0' }],
        passing_count: 0,
        failing_count: 1,
        boundary_score: null,
        tied_at_boundary: 0,
      }),
    ),
    http.put('/api/v1/admission/stages/s1/results', async ({ request }) => {
      puts.push((await request.json()) as { results: Record<string, unknown>[] });
      return HttpResponse.json({ saved: 1 });
    }),
  );
  renderWithRouter(tree, {
    initialEntries: ['/rounds/r1?step=s1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return puts;
}
const cell = (n: number) => screen.findByLabelText(new RegExp(`^Marks of roll R${n}`));

describe('StagePanel', () => {
  it('Enter moves to the next roll', async () => {
    setup();
    const first = await cell(1);
    await userEvent.type(first, '55{Enter}');
    expect(document.activeElement).toBe(await cell(2));
  });

  it('refuses marks above the full marks and does not send them', async () => {
    const puts = setup();
    await userEvent.type(await cell(1), '101');
    expect(
      screen.getAllByText((c) => toLatinDigits(c) === 'Marks must be from 0 to 100.').length,
    ).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Save marks' }));
    expect(await screen.findByText('Fix the red cells first.')).toBeTruthy();
    expect(puts).toEqual([]);
  });

  it('absent saves as not attended, without a score', async () => {
    const puts = setup();
    await userEvent.type(await cell(1), 'a');
    await userEvent.type(await cell(2), '40');
    await userEvent.click(screen.getByRole('button', { name: 'Save marks' }));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]?.results).toEqual([
      { applicant_id: 'a0', attended: false },
      { applicant_id: 'a1', attended: true, score: 40 },
    ]);
  });

  it('splits 450 rows into chunks of 200, 200, 50', () => {
    const rows = Array.from({ length: 450 }, (_, k) => k);
    expect(chunk(rows).map((c) => c.length)).toEqual([200, 200, 50]);
  });

  it('clearing a saved mark is refused, not silently kept', async () => {
    const puts = setup({}, 2, [
      { applicant_id: 'a0', roll: 'R1', name: 'Name 0', attended: true, score: 70, passed: null },
    ]);
    const first = await cell(1);
    await waitFor(() => expect((first as HTMLInputElement).value).not.toBe(''));
    await userEvent.clear(first);
    await userEvent.click(screen.getByRole('button', { name: 'Save marks' }));
    expect(await screen.findByText(/saved mark cannot be erased/)).toBeTruthy();
    expect(puts).toEqual([]);
  });

  it('saving new marks closes an open cut-off preview', async () => {
    setup();
    await userEvent.type(await screen.findByLabelText('Value'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Show result' }));
    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeTruthy();
    await userEvent.type(await cell(1), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save marks' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull());
  });

  it('a pass/fail stage shows two buttons, not a number box', async () => {
    const puts = setup({ mode: 'PASS_FAIL' });
    const passed = (await screen.findAllByRole('button', { name: 'Passed' }))[0]!;
    expect(screen.queryByLabelText(/^Marks of roll/)).toBeNull();
    await userEvent.click(passed);
    await userEvent.click(screen.getByRole('button', { name: 'Save marks' }));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]?.results).toEqual([{ applicant_id: 'a0', attended: true, passed: true }]);
  });
});

describe('glossary: stage panel bn text never says the banned words', () => {
  it('admission-stages.json has none', () => {
    const NEVER = [
      'স্কোর',
      'র‍্যাঙ্ক',
      'কনফার্ম',
      'ভেরিফিকেশন',
      'রিজেক্ট',
      'ওয়েটলিস্ট',
      'সিরিয়াল',
      'ব্যাচ',
    ];
    const text = readFileSync(
      resolve(__dirname, '../../../../../ui/src/i18n/locales/bn/admission-stages.json'),
      'utf8',
    );
    expect(NEVER.filter((w) => text.includes(w))).toEqual([]);
  });
});
