/**
 * [31.4.marks-4a] Grading scales list: names instead of ids (B13), the "no
 * grades yet" badge, the edit action, the total, the labelled filter and a
 * create dialog that lands on the new scale's editor.
 */
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const band = (n: number) => ({
  id: `band-${n}`,
  percent_from: n,
  percent_to: n,
  grade: 'A',
  gpa: 5,
  is_fail: false,
  sequence: n,
  comment: null,
});

const scale = (
  id: string,
  name: string,
  yearId: string,
  classId: string | null,
  bands: number,
) => ({
  id,
  name,
  academic_year_id: yearId,
  class_id: classId,
  revision: 3,
  bands: Array.from({ length: bands }, (_, i) => band(i + 1)),
});

const paginated = <T,>(data: T[]) => ({
  data,
  total: data.length,
  page: 1,
  limit: 100,
  totalPages: 1,
});

const render = () =>
  renderWithRouter(routeTree, {
    initialEntries: ['/grading-scales'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });

describe('/grading-scales', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows year and class names (even the 12th year), never an id, and asks for limit=100', async () => {
    const years = Array.from({ length: 12 }, (_, i) =>
      academicYearFactory({ id: `ay-${i + 1}`, name: `Year ${i + 1}` }),
    );
    const klass = classFactory({ id: 'cls-1', name: 'Class Six' });
    let yearLimit: string | null = null;
    server.use(
      http.get('/api/v1/academic-years', ({ request }) => {
        yearLimit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json(paginated(years));
      }),
      http.get('/api/v1/classes', () => HttpResponse.json(paginated([klass]))),
      http.get('/api/v1/grading/scales', () =>
        HttpResponse.json([
          scale('scale-12', 'Late Scale', 'ay-12', 'cls-1', 7),
          scale('scale-1', 'Default Scale', 'ay-1', null, 0),
        ]),
      ),
    );
    render();

    await screen.findByText('Late Scale');
    expect(await screen.findByText('Year 12')).toBeTruthy();
    expect(screen.getByText('Class Six')).toBeTruthy();
    expect(screen.getByText('All classes')).toBeTruthy();
    expect(yearLimit).toBe('100');
    // No UUID-like id text anywhere in the table.
    expect(screen.queryByText(/ay-12|cls-1|scale-12/)).toBeNull();
  });

  it('flags a scale without grades, counts grades in tenant numerals and drops the revision column', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json(paginated([academicYearFactory({ id: 'ay-1', name: 'Year 1' })])),
      ),
      http.get('/api/v1/classes', () => HttpResponse.json(paginated([]))),
      http.get('/api/v1/grading/scales', () =>
        HttpResponse.json([
          scale('scale-a', 'Seven', 'ay-1', null, 7),
          scale('scale-b', 'Empty', 'ay-1', null, 0),
        ]),
      ),
    );
    render();

    await screen.findByText('Seven');
    expect(screen.getByText('No grades yet')).toBeTruthy();
    expect(screen.getByText(`${formatNumber(7, REGION_BD_BN)} grades`)).toBeTruthy();
    expect(screen.queryByText('Revision')).toBeNull();
    // The name is plain text; the pencil is the way into the editor.
    const edit = screen.getAllByRole('link', { name: 'Edit' });
    expect(edit.map((a) => a.getAttribute('href'))).toEqual([
      '/grading-scales/scale-a',
      '/grading-scales/scale-b',
    ]);
    expect(screen.getByText(`Total ${formatNumber(2, REGION_BD_BN)}`)).toBeTruthy();
  });

  it('labels the academic-year filter', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json(paginated([academicYearFactory({ id: 'ay-1', name: 'Year 1' })])),
      ),
      http.get('/api/v1/classes', () => HttpResponse.json(paginated([]))),
      http.get('/api/v1/grading/scales', () => HttpResponse.json([])),
    );
    render();

    await screen.findByText('No grading scales yet');
    expect(screen.getByLabelText('Academic year')).toBeTruthy();
  });

  it('creating a scale opens its editor', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json(paginated([academicYearFactory({ id: 'ay-1', name: 'Year 1' })])),
      ),
      http.get('/api/v1/classes', () => HttpResponse.json(paginated([]))),
      http.get('/api/v1/grading/scales', () => HttpResponse.json([])),
      http.post('/api/v1/grading/scales', () =>
        HttpResponse.json(scale('scale-new', 'Fresh', 'ay-1', null, 0)),
      ),
      http.get('/api/v1/grading/scales/scale-new', () =>
        HttpResponse.json(scale('scale-new', 'Fresh', 'ay-1', null, 0)),
      ),
    );
    const { router } = render();

    await user.click(await screen.findByRole('button', { name: 'Add grading scale' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(/^Name/), 'Fresh');
    await user.click(dialog.getByLabelText(/^Academic year/));
    await user.click(await screen.findByRole('option', { name: 'Year 1' }));
    expect(dialog.getByLabelText('Applies to')).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/grading-scales/scale-new'));
  });
});
