import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdmissionPrintMenu, PrintListButton } from './AdmissionPrintMenu';

afterEach(async () => {
  await cleanupTestState();
  vi.restoreAllMocks();
});

const LIST_TITLE = 'Merit list';
const stage = {
  id: 's1',
  title: 'Written test',
  kind: 'WRITTEN',
  date: '2027-01-10',
  start_time: '10:00',
  venue: 'Hall',
};
const applicant = (id: string, roll: string | null, name: string) => ({
  id,
  roll_number: roll,
  applicant_name: name,
  reference_number: `ADM-${id}`,
});

const root = createRootRoute();
const tree = root.addChildren([
  createRoute({
    getParentRoute: () => root,
    path: '/rounds/$roundId',
    component: () => (
      <>
        <AdmissionPrintMenu roundId="r1" stage={stage} />
        <PrintListButton
          roundId="r1"
          title={LIST_TITLE}
          members={[{ position: 1, applicant_name: 'Rahim' }]}
        />
      </>
    ),
  }),
]);

function setup(rows: object[]) {
  const asked: URLSearchParams[] = [];
  server.use(
    http.get('/api/v1/admission-intakes/r1', () =>
      HttpResponse.json({ id: 'r1', title: 'Class 6 Admission 2027' }),
    ),
    http.get('/api/v1/admission/applicants', ({ request }) => {
      asked.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        data: rows,
        total: rows.length,
        page: 1,
        limit: 100,
        totalPages: 1,
      });
    }),
  );
  const print = vi.fn();
  window.print = print;
  renderWithRouter(tree, {
    initialEntries: ['/rounds/r1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return { asked, print };
}

describe('AdmissionPrintMenu', () => {
  it('prints an attendance sheet of applicants with a roll, in roll order, asked of this stage', async () => {
    const { asked, print } = setup([
      applicant('a2', '2', 'Karim'),
      applicant('a1', '1', 'Rahim'),
      applicant('a3', null, 'No Roll'),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Print attendance sheet' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(asked[0]!.get('stage_id')).toBe('s1');
    expect(asked[0]!.get('intakeId')).toBe('r1');
    expect(asked[0]!.get('sort')).toBe('roll');
    const sheet = document.querySelector('.print-sheet-root')!;
    expect(sheet.textContent).toContain('Attendance sheet');
    expect(sheet.textContent).toContain('Written test');
    expect(sheet.textContent).toContain('Hall');
    expect(sheet.textContent).toContain('Karim');
    expect(sheet.textContent).not.toContain('No Roll');
  });

  it('says so and prints nothing when nobody has a roll yet', async () => {
    const error = vi.spyOn(toast, 'error');
    const { print } = setup([applicant('a3', null, 'No Roll')]);
    await userEvent.click(await screen.findByRole('button', { name: 'Print attendance sheet' }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Nobody has a roll number yet')),
    );
    expect(print).not.toHaveBeenCalled();
  });

  it('prints a list with its members', async () => {
    const { print } = setup([]);
    await userEvent.click(await screen.findByRole('button', { name: 'Print list' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.print-sheet-root')!.textContent).toContain('Merit list');
    expect(document.querySelector('.print-sheet-root')!.textContent).toContain('Rahim');
  });
});
