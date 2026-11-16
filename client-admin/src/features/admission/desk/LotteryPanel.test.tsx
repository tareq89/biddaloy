import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LotteryPanel } from './LotteryPanel';

afterEach(async () => {
  await cleanupTestState();
});

const root = createRootRoute();
const tree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: '/rounds/$roundId', component: LotteryPanel }),
]);
const page = (data: object[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 100,
  totalPages: 1,
});
const latin = (s: string) => (c: string) => toLatinDigits(c).includes(s);

function setup(drawn: object[] = [], draw409 = false) {
  const state = { rows: drawn, draws: 0 };
  server.use(
    http.get('/api/v1/admission-intakes/r1/stages', () =>
      HttpResponse.json([
        { id: 's1', intake_id: 'r1', position: 1, kind: 'LOTTERY', title: null, config: {} },
      ]),
    ),
    http.get('/api/v1/admission/applicants', () =>
      HttpResponse.json(page([{ id: 'a0' }, { id: 'a1' }, { id: 'a2' }])),
    ),
    http.get('/api/v1/admission/stages/s1/results', () => HttpResponse.json(page(state.rows))),
    http.post('/api/v1/admission/stages/s1/lottery/draw', () => {
      state.draws += 1;
      if (draw409) {
        state.rows = [
          { applicant_id: 'a0', roll: 'R1', name: 'Anna', attended: true, score: 1, passed: null },
        ];
        return HttpResponse.json(
          {
            statusCode: 409,
            message: 'x',
            requestId: 'r',
            path: '/',
            timestamp: 't',
            details: { code: 'LOTTERY_ALREADY_DRAWN' },
          },
          { status: 409 },
        );
      }
      state.rows = [
        { applicant_id: 'a1', roll: 'R2', name: 'Bela', attended: true, score: 2, passed: null },
        { applicant_id: 'a0', roll: 'R1', name: 'Anna', attended: true, score: 1, passed: null },
      ];
      return HttpResponse.json({ drawn: 2 });
    }),
  );
  renderWithRouter(tree, {
    initialEntries: ['/rounds/r1?step=s1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return state;
}

describe('LotteryPanel', () => {
  it('the confirm dialog says once-only and shows the applicant count; the draw then shows ranks and no draw button', async () => {
    const state = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Draw the lottery' }));
    expect(
      await screen.findByText(
        latin('There are 3 applicants. This can be done once, and cannot be done again.'),
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Draw now' }));
    expect(await screen.findByText('The lottery is done')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Draw the lottery' })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Upload a list' })).toBeNull();
    const cells = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    expect(toLatinDigits(cells[1] ?? '')).toContain('1R2Bela');
    expect(state.draws).toBe(1);
  });

  it('an already-drawn lottery shows the result and no buttons', async () => {
    setup([
      { applicant_id: 'a0', roll: 'R1', name: 'Anna', attended: true, score: 1, passed: null },
    ]);
    expect(await screen.findByText('The lottery is done')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Draw the lottery' })).toBeNull();
  });

  it('import shows row errors that name the row, never the cell value', async () => {
    setup();
    server.use(
      http.post('/api/v1/admission/stages/s1/lottery/import/validate', () =>
        HttpResponse.json({
          staging_id: null,
          expires_at: null,
          rows: 2,
          errors: [
            {
              row: 3,
              column: 'rank',
              code: 'INVALID_RANK',
              message: 'x',
              severity: 'error',
              value: 'SECRET-VALUE',
            },
            { row: 0, column: null, code: 'MISSING_APPLICANTS', message: 'x', severity: 'error' },
          ],
        }),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Upload a list' }));
    const input = await screen.findByLabelText('Choose the file');
    await userEvent.upload(input, new File(['x'], 'list.xlsx'));
    await userEvent.click(screen.getByRole('button', { name: 'Check the file' }));
    expect(await screen.findByText(latin('Row 3'))).toBeTruthy();
    expect(screen.getByText(/whole file/i, { exact: false })).toBeTruthy();
    expect(document.body.textContent).not.toContain('SECRET-VALUE');
    expect(screen.getByRole('button', { name: 'Save the list' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('a 409 on draw refreshes to the drawn view, with no draw button', async () => {
    setup([], true);
    await userEvent.click(await screen.findByRole('button', { name: 'Draw the lottery' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Draw now' }));
    expect(await screen.findByText('The lottery is done')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Draw the lottery' })).toBeNull();
  });

  it('warning rows do not block saving and are not listed under the fix heading', async () => {
    setup();
    server.use(
      http.post('/api/v1/admission/stages/s1/lottery/import/validate', () =>
        HttpResponse.json({
          staging_id: 'st1',
          expires_at: 't',
          rows: 2,
          errors: [{ row: 2, column: null, code: 'X', message: 'x', severity: 'warning' }],
        }),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Upload a list' }));
    await userEvent.upload(
      await screen.findByLabelText('Choose the file'),
      new File(['x'], 'l.xlsx'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Check the file' }));
    await screen.findByText(latin('2 rows read.'));
    expect(screen.queryByText('Fix these and upload again')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save the list' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});

describe('LotteryPanel on a phone', () => {
  it('shows the note and no buttons before the draw; ranks still show after', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      setup();
      expect(await screen.findByText(/Open this on a computer/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Draw the lottery' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Upload a list' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a drawn lottery still shows its ranks table on a phone', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      setup([
        { applicant_id: 'a0', roll: 'R1', name: 'Anna', attended: true, score: 1, passed: null },
      ]);
      expect(await screen.findByText('The lottery is done')).toBeTruthy();
      expect(screen.getByText('Anna')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
