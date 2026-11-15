import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { createRootRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { CutoffPreview } from './CutoffPreview';

afterEach(async () => {
  await cleanupTestState();
});

/** The test region may print Bangla digits; compare in Latin digits. */
const latin = (re: RegExp | string) => (content: string) =>
  typeof re === 'string' ? toLatinDigits(content) === re : re.test(toLatinDigits(content));
const tree = createRootRoute({ component: () => <CutoffPreview stageId="s1" /> });
const row = (id: string, roll: string, name: string) => ({ applicant_id: id, roll, name });
const PREVIEW = {
  passing: ['a1'],
  failing: ['a2', 'a3'],
  passing_rows: [row('a1', 'R1', 'Anna')],
  failing_rows: [row('a2', 'R2', 'Bela'), row('a3', 'R3', 'Chitra')],
  passing_count: 1,
  failing_count: 2,
  boundary_score: 80,
  tied_at_boundary: 1,
};

function setup() {
  const commits: Record<string, unknown>[] = [];
  server.use(
    http.post('/api/v1/admission/stages/s1/cutoff/preview', () => HttpResponse.json(PREVIEW)),
    http.post('/api/v1/admission/stages/s1/cutoff/commit', async ({ request }) => {
      commits.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({
        passed: 2,
        failed: 1,
        passing_rows: [],
        failing_rows: [],
        cutoff_committed_at: '2027-01-10T00:00:00Z',
      });
    }),
  );
  renderWithRouter(tree, {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return commits;
}

async function show() {
  await userEvent.type(await screen.findByLabelText('Value'), '1');
  await userEvent.click(screen.getByRole('button', { name: 'Show result' }));
}

describe('CutoffPreview', () => {
  it('shows the server answer: counts and boundary', async () => {
    setup();
    await show();
    expect(await screen.findByText(latin('1 go on, 2 are left out'))).toBeTruthy();
    expect(screen.getByText(latin(/has 80 marks. 1 people have the same marks/))).toBeTruthy();
  });

  it('a manual add shows in the count and goes to the server on Confirm', async () => {
    const commits = setup();
    await show();
    await screen.findByText(latin('1 go on, 2 are left out'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    expect(await screen.findByText(latin('2 go on, 1 are left out'))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(commits.length).toBe(1));
    expect(commits[0]).toEqual({ mode: 'TOP_N', value: 1, add: ['a2'] });
  });

  it('a manual remove shows in the count', async () => {
    setup();
    await show();
    await screen.findByText(latin('1 go on, 2 are left out'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(latin('0 go on, 3 are left out'))).toBeTruthy();
  });

  it('an incomplete-results answer shows the plain message', async () => {
    setup();
    server.use(
      http.post('/api/v1/admission/stages/s1/cutoff/commit', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'x',
            requestId: 'r',
            path: '/',
            timestamp: 't',
            details: { code: 'ADMISSION_RESULTS_INCOMPLETE' },
          },
          { status: 409 },
        ),
      ),
    );
    await show();
    await screen.findByText(latin('1 go on, 2 are left out'));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/have no marks yet/)).toBeTruthy();
  });
});
