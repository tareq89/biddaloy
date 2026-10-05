/**
 * [20.3.1] scale editor route — save blocked while the server's preview
 * reports coverage problems, and proceeds to the recompute preview dialog
 * once the preview is valid. Same `renderWithRouter` + real route tree
 * pattern as `classes/$classId.test.tsx`.
 */
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const SCALE = {
  id: 'scale-1',
  academic_year_id: 'ay-1',
  class_id: null,
  name: 'Class 6 Scale',
  revision: 1,
  bands: [
    {
      id: 'band-1',
      percent_from: 80,
      percent_to: 100,
      grade: 'A+',
      gpa: 5,
      is_fail: false,
      sequence: 1,
      comment: null,
    },
    {
      id: 'band-2',
      percent_from: 0,
      percent_to: 79,
      grade: 'F',
      gpa: 0,
      is_fail: true,
      sequence: 2,
      comment: null,
    },
  ],
};

describe('/grading-scales/$scaleId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const renderScale = () =>
    renderWithRouter(routeTree, {
      initialEntries: ['/grading-scales/scale-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

  const mockLookups = () =>
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [{ id: 'ay-1', name: '2026' }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

  const previewWith = (problems: unknown[], valid = false) =>
    http.post('/api/v1/grading/scales/:id/bands/preview', () =>
      HttpResponse.json({
        valid,
        problems,
        bands_changed: true,
        affected_result_count: 0,
      }),
    );

  /** Make one edit so the Save button enables. */
  async function makeEdit(user: ReturnType<typeof userEvent.setup>) {
    const grade = (await screen.findAllByLabelText(/— Grade$/))[0]!;
    await user.type(grade, 'x');
  }

  it('names the academic year and class as facts in the header', async () => {
    mockLookups();
    server.use(http.get('/api/v1/grading/scales/:id', () => HttpResponse.json(SCALE)));
    renderScale();

    await screen.findByText('2026');
    expect(screen.getByText('All classes')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Class 6 Scale' })).toBeTruthy();
  });

  it('keeps Save disabled until something changed', async () => {
    const user = userEvent.setup();
    mockLookups();
    server.use(http.get('/api/v1/grading/scales/:id', () => HttpResponse.json(SCALE)));
    renderScale();

    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(true);
    await makeEdit(user);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('save stays blocked and renders a translated sentence, not the server message', async () => {
    const user = userEvent.setup();
    mockLookups();
    server.use(
      http.get('/api/v1/grading/scales/:id', () => HttpResponse.json(SCALE)),
      previewWith([
        { type: 'gap', message: 'Gap between 80% and 100%' },
        { type: 'inverted', message: 'Band 2 inverted', index: 2 },
      ]),
    );
    renderScale();

    await makeEdit(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Some marks have no grade — see the red part of the bar.'),
    ).toBeTruthy();
    expect(
      screen.getByText(`Row ${formatNumber(3, REGION_BD_BN)}: “from” is larger than “to”.`),
    ).toBeTruthy();
    expect(screen.queryByText(/Gap between/)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a failed preview shows our own line, and editing clears stale problems', async () => {
    const user = userEvent.setup();
    mockLookups();
    server.use(
      http.get('/api/v1/grading/scales/:id', () => HttpResponse.json(SCALE)),
      http.post('/api/v1/grading/scales/:id/bands/preview', () =>
        HttpResponse.json({ message: 'raw server text' }, { status: 500 }),
      ),
    );
    renderScale();

    await makeEdit(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("Couldn't check the grades. Please try again.")).toBeTruthy();
    expect(screen.queryByText(/raw server text/)).toBeNull();

    await makeEdit(user);
    expect(screen.queryByText("Couldn't check the grades. Please try again.")).toBeNull();
  });

  it('save proceeds to the recompute preview dialog once the preview is valid', async () => {
    const user = userEvent.setup();
    mockLookups();
    server.use(
      http.get('/api/v1/grading/scales/:id', () => HttpResponse.json(SCALE)),
      http.post('/api/v1/grading/scales/:id/bands/preview', () =>
        HttpResponse.json({
          valid: true,
          problems: [],
          bands_changed: true,
          affected_result_count: 3,
        }),
      ),
    );
    renderScale();

    await makeEdit(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(
      screen.getByText(
        `${formatNumber(3, REGION_BD_BN)} students' results will be recalculated against the new grades.`,
      ),
    ).toBeTruthy();
  });

  it('an empty scale offers the NCTB grades, which fill seven rows', async () => {
    const user = userEvent.setup();
    mockLookups();
    server.use(
      http.get('/api/v1/grading/scales/:id', () => HttpResponse.json({ ...SCALE, bands: [] })),
    );
    renderScale();

    await screen.findByText('No grades yet');
    await user.click(screen.getByRole('button', { name: 'Use NCTB grades' }));
    expect(await screen.findAllByLabelText(/— Grade$/)).toHaveLength(7);
  });

  it('asks before leaving with unsaved rows', async () => {
    const user = userEvent.setup();
    mockLookups();
    server.use(http.get('/api/v1/grading/scales/:id', () => HttpResponse.json(SCALE)));
    renderScale();

    await makeEdit(user);
    await user.click(screen.getAllByRole('link', { name: 'Grading scales' })[0]!);

    await screen.findByRole('heading', { name: 'Leave without saving?' });
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('heading', { name: 'Leave without saving?' })).toBeNull();
  });

  describe('preset warning banner [35.5.2]', () => {
    function mount(role: string, state: 'APPLIED' | 'AVAILABLE') {
      let statusCalls = 0;
      server.use(
        http.get('/api/v1/grading/scales/:id', () => HttpResponse.json(SCALE)),
        http.get('/api/v1/presets/status', () => {
          statusCalls += 1;
          return HttpResponse.json({ state });
        }),
      );
      renderWithRouter(routeTree, {
        initialEntries: ['/grading-scales/scale-1'],
        tenantId: 'tenant-1',
        role,
        locale: 'en',
      });
      return () => statusCalls;
    }

    it('shows with APPLIED for a viewer holding CURRICULUM_PRESET_APPLY', async () => {
      mount('ADMIN', 'APPLIED');
      expect(await screen.findByText(/This comes from your ready-made curriculum/)).toBeTruthy();
    });

    it('is absent with AVAILABLE', async () => {
      const calls = mount('ADMIN', 'AVAILABLE');
      expect(await screen.findAllByText('Class 6 Scale')).toHaveLength(2);
      await waitFor(() => expect(calls()).toBe(1));
      expect(screen.queryByText(/This comes from your ready-made curriculum/)).toBeNull();
    });
  });
});
