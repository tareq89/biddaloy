/**
 * [20.3.1] `CopyScaleDialog` — defaults the target to the source scale's
 * own year/class, refuses an occupied target (existing scale with bands),
 * and otherwise creates the target scale (if missing) before copying into
 * it. Same hand-rolled provider stack as `-recompute-preview-dialog.test.tsx`.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyScaleDialog, type CopyScaleDialogProps } from './-copy-scale-dialog';

afterEach(async () => {
  await cleanupTestState();
});

const SOURCE_SCALE = {
  id: 'scale-source',
  academic_year_id: 'year-2026',
  class_id: null,
  name: 'BD NCTB',
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
  ],
};

function mockLists() {
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({ data: [{ id: 'year-2026', name: '2026-2027' }] }),
    ),
    http.get('/api/v1/classes', () => HttpResponse.json({ data: [] })),
  );
}

async function renderDialog(overrides: Partial<CopyScaleDialogProps> = {}, scales: unknown[] = []) {
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');
  await i18n.changeLanguage('en');
  mockLists();
  server.use(http.get('/api/v1/grading/scales', () => HttpResponse.json(scales)));
  const queryClient = createTestQueryClient();
  const onOpenChange = vi.fn();
  const onCopied = vi.fn();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <CopyScaleDialog
          open
          onOpenChange={onOpenChange}
          sourceScale={SOURCE_SCALE}
          onCopied={onCopied}
          {...overrides}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );

  return { ...view, onOpenChange, onCopied };
}

describe('CopyScaleDialog', () => {
  it('shows how many bands will be created and no error initially', async () => {
    await renderDialog();

    expect(await screen.findByText(/Creates 1 band/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses an occupied target — an existing scale for that year/class already has bands', async () => {
    const user = userEvent.setup();
    await renderDialog({}, [
      { id: 'scale-target', academic_year_id: 'year-2026', class_id: null, bands: [{ id: 'b' }] },
    ]);

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/already/i);
  });

  it('creates the target scale then copies into it when no target exists yet', async () => {
    let createBody: unknown;
    let copyBody: unknown;
    let copyTargetId = '';
    server.use(
      http.post('/api/v1/grading/scales', async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ id: 'scale-created', bands: [] }, { status: 201 });
      }),
      http.post('/api/v1/grading/scales/:id/copy', async ({ request, params }) => {
        copyBody = await request.json();
        copyTargetId = params.id as string;
        return HttpResponse.json([]);
      }),
    );

    const user = userEvent.setup();
    const { onCopied } = await renderDialog();

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(onCopied).toHaveBeenCalled());
    expect(createBody).toMatchObject({ academic_year_id: 'year-2026', class_id: null });
    expect(copyTargetId).toBe('scale-created');
    expect(copyBody).toEqual({ source_scale_id: 'scale-source' });
  });

  it('copies straight into an existing empty target without creating a new scale', async () => {
    let createCalled = false;
    let copyTargetId = '';
    server.use(
      http.post('/api/v1/grading/scales', () => {
        createCalled = true;
        return HttpResponse.json({ id: 'unused' }, { status: 201 });
      }),
      http.post('/api/v1/grading/scales/:id/copy', ({ params }) => {
        copyTargetId = params.id as string;
        return HttpResponse.json([]);
      }),
    );

    const user = userEvent.setup();
    const { onCopied } = await renderDialog({}, [
      { id: 'scale-existing-empty', academic_year_id: 'year-2026', class_id: null, bands: [] },
    ]);

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(onCopied).toHaveBeenCalled());
    expect(createCalled).toBe(false);
    expect(copyTargetId).toBe('scale-existing-empty');
  });

  it('shows a generic error message when the copy request fails', async () => {
    server.use(
      http.post('/api/v1/grading/scales', () => HttpResponse.json({ id: 'scale-created' })),
      http.post('/api/v1/grading/scales/:id/copy', () => HttpResponse.json({}, { status: 500 })),
    );

    const user = userEvent.setup();
    await renderDialog();

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/failed to copy/i);
  });
});
