import '@biddaloy/ui/test';

import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IssueCertificateModal } from './issue-certificate-modal';

// jsdom cannot open a print tab: the fake runs only the injected create call, like the real one's first step.
vi.mock('../preview/run-print', () => ({
  defaultRunPrintDeps: {},
  runPrint: vi.fn(
    async (
      args: {
        request: { kind: string; body: unknown; jobId?: string; itemIds?: string[] };
        onError: (e: Error) => void;
      },
      deps: {
        reprintPrintJob: (
          jobId: string,
          itemIds: string[],
        ) => ReturnType<
          typeof Promise.resolve<{
            job_id: string;
            items: Array<{ item_id: string; subject_id: string; label: string }>;
          }>
        >;
        createPrintJob: (b: unknown) => Promise<{
          job_id: string;
          items: Array<{ item_id: string; subject_id: string; label: string }>;
        }>;
      },
    ) => {
      try {
        const job =
          args.request.kind === 'reprint'
            ? await deps.reprintPrintJob(args.request.jobId ?? '', args.request.itemIds ?? [])
            : await deps.createPrintJob(args.request.body);
        return {
          jobId: job.job_id,
          items: job.items.map((i) => ({
            itemId: i.item_id,
            subjectId: i.subject_id,
            label: i.label,
          })),
        };
      } catch (e) {
        args.onError(e as Error);
        return undefined;
      }
    },
  ),
}));

const definition = (extra: object[] = []) => ({
  page: { widthMm: 210, heightMm: 297, sides: ['front'] },
  front: {
    elements: [
      {
        id: 'e1',
        type: 'TEXT',
        x: 1,
        y: 1,
        w: 100,
        h: 10,
        fontFamily: 'Biddaloy Sans',
        sizePt: 12,
        weight: 400,
        color: '#000000',
        align: 'left',
        overflow: 'CLIP',
        field: 'student.name',
      },
      ...extra,
    ],
  },
});
const conduct = {
  id: 'e2',
  type: 'TEXT',
  x: 1,
  y: 20,
  w: 100,
  h: 10,
  fontFamily: 'Biddaloy Sans',
  sizePt: 12,
  weight: 400,
  color: '#000000',
  align: 'left',
  overflow: 'CLIP',
  field: 'issue.conduct',
};

const student = {
  id: 's-1',
  full_name: 'Rafi Hasan',
  registration_number: 'REG-1',
  roll_number: 8,
  enrollment_status: 'ACTIVE',
  class_section_id: 'cs-1',
  class_section: { id: 'cs-1', class_id: 'c-10', section_name: 'A', class: { name: 'Class 10' } },
};

const posts: Array<{ url: string; body: unknown }> = [];

function serve(
  opts: {
    kinds?: string[];
    defn?: object;
    latestSerial?: string | null;
    classIds?: string[];
    batchSize?: number;
    serialPrefix?: string;
    registerTotal?: number;
  } = {},
) {
  const kinds = opts.kinds ?? ['TESTIMONIAL'];
  server.use(
    http.get('/api/v1/schools/school-1/settings', () =>
      HttpResponse.json({
        version: 1,
        documents: opts.serialPrefix ? { serialPrefix: opts.serialPrefix } : {},
      }),
    ),
    http.get('/api/v1/students/s-1', () => HttpResponse.json(student)),
    http.get('/api/v1/students/s-1/lifecycle-events', () => HttpResponse.json([])),
    http.get('/api/v1/certificates/templates', ({ request }) => {
      const kind = new URL(request.url).searchParams.get('document_kind') ?? '';
      return HttpResponse.json(
        kinds.includes(kind)
          ? [{ id: `t-${kind}`, name: 'Classic', is_default: true, current_version_id: 'v-1' }]
          : [],
      );
    }),
    http.post('/api/v1/certificates/preview', async ({ request }) => {
      const body = (await request.json()) as { subject_ids: string[] };
      return HttpResponse.json({
        template: {
          id: 't-TESTIMONIAL',
          batch_size: opts.batchSize ?? 50,
          version: { id: 'v-1', version: 1, definition: opts.defn ?? definition([conduct]) },
        },
        items: body.subject_ids.map((id) => ({
          subject_id: id,
          label: 'Rafi Hasan',
          values: { 'student.name': 'Rafi Hasan' },
          photo_url: null,
        })),
      });
    }),
    http.get('/api/v1/certificates/printers', () =>
      HttpResponse.json([
        {
          id: 'p-1',
          name: 'Office',
          printer_type: 'OFFICE',
          margin_top_mm: 0,
          margin_right_mm: 0,
          margin_bottom_mm: 0,
          margin_left_mm: 0,
          offset_x_mm: 0,
          offset_y_mm: 0,
          scale: 1,
          duplex_order: 'INTERLEAVED',
          sheet_gap_mm: 0,
          archived_at: null,
        },
      ]),
    ),
    http.get('/api/v1/certificates/assets', () => HttpResponse.json([])),
    http.get('/api/v1/print-history/register', () => {
      const serial = opts.latestSerial === undefined ? 'TSM-2026-00009' : opts.latestSerial;
      const row = serial
        ? [
            {
              item_id: 'i',
              document_kind: 'TESTIMONIAL',
              serial,
              serial_year: 2026,
              serial_no: Number(serial.slice(-5)),
              copy_number: 1,
              subject_id: 'x',
              subject_label: 'x',
              class_name: null,
              issued_at: '2026-01-01T00:00:00Z',
              printed_by_name: null,
              revoked_at: null,
              revoke_reason: null,
            },
          ]
        : [];
      return HttpResponse.json({
        data: row,
        total: opts.registerTotal ?? row.length,
        page: 1,
        limit: 1,
        totalPages: 1,
      });
    }),
    http.get('/api/v1/students', ({ request }) => {
      const status = new URL(request.url).searchParams.get('enrollment_status');
      const ids = status === 'ACTIVE' ? (opts.classIds ?? ['s-3', 's-1', 's-2']) : [];
      const rolls: Record<string, number> = { 's-1': 1, 's-2': 2, 's-3': 3, 's-4': 4 };
      return HttpResponse.json({
        data: ids.map((id) => ({
          ...student,
          id,
          full_name: `Student ${id}`,
          roll_number: rolls[id] ?? 9,
        })),
        total: ids.length,
        page: 1,
        limit: 1000,
        totalPages: 1,
      });
    }),
    http.post('/api/v1/certificates', async ({ request }) => {
      const body = (await request.json()) as { subject_ids: string[] };
      posts.push({ url: '/certificates', body });
      return HttpResponse.json({
        job_id: 'job-1',
        version: { id: 'v-1', definition: definition() },
        items: body.subject_ids.map((id) => ({
          item_id: `i-${id}`,
          subject_id: id,
          label: `Student ${id}`,
          values: {},
          copy_number: 1,
          verify_url: '/v/x',
          photo_url: null,
          serial_no: `TSM-2026-0001${id.slice(-1)}`,
        })),
      });
    }),
    http.patch('/api/v1/certificates/jobs/job-1/confirm', () => {
      posts.push({ url: '/certificates/jobs/job-1/confirm', body: null });
      return HttpResponse.json({ job_id: 'job-1', status: 'CONFIRMED', failed_item_ids: [] });
    }),
  );
}

function setup(
  initialKind: 'TESTIMONIAL' | 'TRANSFER_CERTIFICATE' | undefined = 'TESTIMONIAL',
  url = '/',
) {
  const onClose = vi.fn();
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <RegionConfigProvider value={REGION_BD_EN}>
        <IssueCertificateModal
          studentId="s-1"
          initialKind={initialKind}
          onClose={onClose}
          onRecordLeaving={vi.fn()}
        />
      </RegionConfigProvider>
    ),
  });
  const view = renderWithRouter(root.addChildren([index]), {
    initialEntries: [url],
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
  });
  return { ...view, user: userEvent.setup(), onClose };
}

const next = async (user: { click: (e: Element) => Promise<void> }, name: RegExp) =>
  user.click(await screen.findByRole('button', { name }));

describe('IssueCertificateModal', () => {
  beforeEach(() => {
    posts.length = 0;
    window.localStorage.clear();
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it('arrow keys move between kinds and skip the disabled TC; Next goes to the details', async () => {
    serve({ kinds: ['TESTIMONIAL', 'CHARACTER_CERTIFICATE'] });
    const { user } = setup(undefined);
    const group = await screen.findByRole('radiogroup', { name: /which certificate/i });
    await waitFor(() => expect(within(group).getAllByRole('radio').length).toBe(5));
    expect(
      within(group)
        .getByRole('radio', { name: /transfer certificate/i })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getAllByText(/record a transfer or withdrawal first/i).length).toBeGreaterThan(0);

    const testimonial = within(group).getByRole('radio', { name: /testimonial/i });
    testimonial.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(within(group).getByRole('radio', { name: /character/i }));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(within(group).getByRole('radio', { name: /testimonial/i }));
    await user.keyboard('{ArrowUp}'); // wraps past the disabled TC to the last enabled kind
    expect(document.activeElement).toBe(within(group).getByRole('radio', { name: /character/i }));
    await user.keyboard('{ArrowDown}');
    // Enter on Next advances (keyboard only).
    (await screen.findByRole('button', { name: /^next$/i })).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/certificate language/i)).toBeTruthy();
  });

  it('focus starts on the step heading, and Tab reaches the typed field', async () => {
    serve();
    const { user } = setup();
    await screen.findByRole('radiogroup', { name: /which certificate/i });
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'));
    expect(document.activeElement?.textContent).toMatch(/step 1/i);
    await next(user, /^next$/i);
    const field = await screen.findByLabelText(/conduct/i);
    await screen.findByRole('heading', { name: /step 2/i });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: /step 2/i })),
    );
    for (let i = 0; i < 20 && document.activeElement !== field; i += 1) await user.tab();
    expect(document.activeElement).toBe(field);
  });

  it('shows the bound field, blocks Next while empty, and flags 121 characters', async () => {
    serve();
    const { user } = setup();
    await next(user, /^next$/i);
    const field = await screen.findByLabelText(/conduct/i);
    await next(user, /see preview/i);
    expect((await screen.findAllByText(/is required/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/preview/i, { selector: 'h2' })).toBeNull();
    await user.click(field);
    await user.paste('x'.repeat(121));
    await next(user, /see preview/i);
    expect(await screen.findByText(/at most/i)).toBeTruthy();
  });

  it('prints through /certificates with the typed values, then confirms on /certificates/jobs/:id/confirm', async () => {
    serve();
    const { user } = setup();
    await next(user, /^next$/i);
    await user.type(await screen.findByLabelText(/conduct/i), 'Excellent');
    await next(user, /see preview/i);
    await next(user, /^next$/i);
    await next(user, /^print$/i);
    await waitFor(() => expect(posts[0]?.url).toBe('/certificates'));
    expect(posts[0]?.body).toMatchObject({
      template_id: 't-TESTIMONIAL',
      subject_ids: ['s-1'],
      issue_values: { 'issue.conduct': 'Excellent' },
    });
    await user.click(await screen.findByRole('button', { name: /yes, all printed/i }));
    await waitFor(() =>
      expect(posts.map((p) => p.url)).toContain('/certificates/jobs/job-1/confirm'),
    );
  });

  it('whole class: sends every id in roll order; a 409 lists who is left out and the retry sends the rest', async () => {
    serve();
    let calls = 0;
    server.use(
      http.post('/api/v1/certificates', async ({ request }) => {
        const body = (await request.json()) as { subject_ids: string[] };
        posts.push({ url: '/certificates', body });
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            {
              statusCode: 409,
              message: 'x',
              error: 'Conflict',
              path: '/',
              timestamp: '',
              requestId: 'r',
              details: {
                code: 'CERTIFICATE_NOT_ELIGIBLE',
                kind: 'TESTIMONIAL',
                students: [
                  { id: 's-2', reason: 'NOT_CURRENT_OR_GRADUATED' },
                  { id: 's-3', reason: 'NOT_CURRENT_OR_GRADUATED' },
                ],
              },
            },
            { status: 409 },
          );
        }
        return HttpResponse.json({
          job_id: 'job-1',
          version: { id: 'v', definition: definition() },
          items: body.subject_ids.map((id) => ({
            item_id: `i-${id}`,
            subject_id: id,
            label: id,
            values: {},
            copy_number: 1,
            verify_url: '/v',
            photo_url: null,
            serial_no: 'TSM-2026-00010',
          })),
        });
      }),
    );
    const { user } = setup();
    await next(user, /^next$/i);
    await user.type(await screen.findByLabelText(/conduct/i), 'Good');
    await user.click(await screen.findByRole('button', { name: /for all of class 10/i }));
    await screen.findByText(/3 students/i);
    await next(user, /see preview/i);
    await next(user, /^next$/i);
    await next(user, /^print$/i);
    await waitFor(() => expect(posts.length).toBe(1));
    expect((posts[0]?.body as { subject_ids: string[] }).subject_ids).toEqual([
      's-1',
      's-2',
      's-3',
    ]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/2 students cannot get this certificate/i);
    expect(alert.textContent).toContain('Student s-2');
    await next(user, /see preview/i);
    await next(user, /^next$/i);
    await next(user, /^print$/i);
    await waitFor(() => expect(posts.length).toBe(2));
    expect((posts[1]?.body as { subject_ids: string[] }).subject_ids).toEqual(['s-1']);
  });

  it('next-serial card: latest + 1, and number 1 with no rows', async () => {
    serve();
    const first = setup();
    await next(first.user, /^next$/i);
    expect((await screen.findByTestId('next-serial')).textContent).toBe('TSM-2026-00010');
    first.unmount();
    await cleanupTestState();

    serve({ latestSerial: null });
    const second = setup();
    await next(second.user, /^next$/i);
    expect((await screen.findByTestId('next-serial')).textContent).toBe('TSM-2026-00001');
  });

  it('next-serial card: the prefix comes from the settings, not the last serial', async () => {
    serve({ serialPrefix: 'DAHS' });
    const { user } = setup();
    await next(user, /^next$/i);
    await waitFor(() =>
      expect(screen.getByTestId('next-serial').textContent).toBe('DAHS-TSM-2026-00010'),
    );
  });

  it('issued-this-year counts serials, not reprinted copies', async () => {
    // Serial 9 is the newest; 12 register rows means 3 of them are reprints.
    serve({ registerTotal: 12 });
    const { user } = setup();
    await next(user, /^next$/i);
    expect(await screen.findByText(/9 issued in/i)).toBeTruthy();
  });

  it('the serial card links to the register tab', async () => {
    serve();
    const { user } = setup();
    await next(user, /^next$/i);
    const link = await screen.findByRole('link', { name: 'Open the register' });
    expect(link.getAttribute('href')).toContain('/reports/printables');
    expect(link.getAttribute('href')).toContain('tab=register');
  });

  const jobBody = (jobId: string, ids: string[]) => ({
    job_id: jobId,
    version: { id: 'v', definition: definition() },
    items: ids.map((id) => ({
      item_id: `i-${id}`,
      subject_id: id,
      label: id,
      values: {},
      copy_number: 1,
      verify_url: '/v',
      photo_url: null,
      serial_no: 'TSM-2026-00010',
    })),
  });

  it('reprint-failed keeps the batch uncounted and the result hidden until Continue', async () => {
    serve();
    server.use(
      http.post('/api/v1/certificates/jobs/job-1/reprint', () => {
        posts.push({ url: '/certificates/jobs/job-1/reprint', body: null });
        return HttpResponse.json(jobBody('job-2', ['s-1']));
      }),
      http.patch('/api/v1/certificates/jobs/job-2/confirm', () =>
        HttpResponse.json({ job_id: 'job-2', status: 'CONFIRMED', failed_item_ids: [] }),
      ),
    );
    const { user } = setup();
    await next(user, /^next$/i);
    await user.type(await screen.findByLabelText(/conduct/i), 'Good');
    await next(user, /see preview/i);
    await next(user, /^next$/i);
    await next(user, /^print$/i);
    await user.click(await screen.findByRole('button', { name: /some failed/i }));
    await user.click(await screen.findByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));
    await user.click(await screen.findByRole('button', { name: /reprint 1 failed/i }));
    // The reprint job is open and waiting for its answer: no result yet.
    await screen.findByRole('button', { name: /yes, all printed/i });
    expect(screen.queryByText(/certificate issued/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: /yes, all printed/i }));
    expect(screen.queryByText(/certificate issued/i)).toBeNull();
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    expect(await screen.findByText(/1 certificate issued/i)).toBeTruthy();
    expect(posts.filter((p) => p.url === '/certificates').length).toBe(1);
  });

  it('a 409 after finished batches never re-sends their ids', async () => {
    serve({ classIds: ['s-1', 's-2', 's-3', 's-4'], batchSize: 2 });
    let calls = 0;
    server.use(
      http.post('/api/v1/certificates', async ({ request }) => {
        const body = (await request.json()) as { subject_ids: string[] };
        posts.push({ url: '/certificates', body });
        calls += 1;
        if (calls === 2) {
          return HttpResponse.json(
            {
              statusCode: 409,
              message: 'x',
              error: 'Conflict',
              path: '/',
              timestamp: '',
              requestId: 'r',
              details: {
                code: 'CERTIFICATE_NOT_ELIGIBLE',
                kind: 'TESTIMONIAL',
                students: [{ id: 's-3', reason: 'NOT_CURRENT_OR_GRADUATED' }],
              },
            },
            { status: 409 },
          );
        }
        return HttpResponse.json(jobBody('job-1', body.subject_ids));
      }),
    );
    const { user } = setup();
    await next(user, /^next$/i);
    await user.type(await screen.findByLabelText(/conduct/i), 'Good');
    await user.click(await screen.findByRole('button', { name: /for all of class 10/i }));
    await screen.findByText(/4 students/i);
    await next(user, /see preview/i);
    await next(user, /^next$/i);
    await next(user, /^print$/i);
    await user.click(await screen.findByRole('button', { name: /yes, all printed/i }));
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    await next(user, /^print$/i); // batch 2 -> 409 on s-3
    await screen.findByRole('alert');
    await next(user, /see preview/i);
    await next(user, /^next$/i);
    await next(user, /^print$/i);
    await waitFor(() => expect(posts.filter((p) => p.url === '/certificates').length).toBe(3));
    const sent = posts
      .filter((p) => p.url === '/certificates')
      .map((p) => (p.body as { subject_ids: string[] }).subject_ids);
    expect(sent).toEqual([['s-1', 's-2'], ['s-3', 's-4'], ['s-4']]);
  });

  it('over the 1000-row cap, bulk is refused with visible text and See preview is disabled', async () => {
    serve();
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({
          data: [{ ...student, roll_number: 1 }],
          total: 1500,
          page: 1,
          limit: 1000,
          totalPages: 2,
        }),
      ),
    );
    const { user } = setup();
    await next(user, /^next$/i);
    await user.click(await screen.findByRole('button', { name: /for all of class 10/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/too big/i);
    expect(screen.getByRole('button', { name: /see preview/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('a ?step=print link with empty required details lands on the details step', async () => {
    serve();
    const { user } = setup('TESTIMONIAL', '/?step=print');
    const field = await screen.findByLabelText(/conduct/i);
    expect(screen.queryByRole('button', { name: /^print$/i })).toBeNull();
    // Typing a valid value must not jump ahead on its own.
    await user.type(field, 'Good');
    expect(screen.getByLabelText(/conduct/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^print$/i })).toBeNull();
  });

  it('whole class keeps the page’s student even when they are not an ACTIVE classmate', async () => {
    serve({ classIds: ['s-2', 's-3'] });
    const { user } = setup();
    await next(user, /^next$/i);
    await user.type(await screen.findByLabelText(/conduct/i), 'Good');
    await user.click(await screen.findByRole('button', { name: /for all of class 10/i }));
    await screen.findByText(/3 students/i);
    await next(user, /see preview/i);
    await next(user, /^next$/i);
    await next(user, /^print$/i);
    await waitFor(() => expect(posts.length).toBe(1));
    expect((posts[0]?.body as { subject_ids: string[] }).subject_ids).toEqual([
      's-1',
      's-2',
      's-3',
    ]);
  });

  it('a transfer certificate offers no whole-class switch', async () => {
    serve({ kinds: ['TRANSFER_CERTIFICATE'] });
    server.use(
      http.get('/api/v1/students/s-1', () =>
        HttpResponse.json({ ...student, enrollment_status: 'TRANSFERRED_OUT' }),
      ),
      http.get('/api/v1/students/s-1/lifecycle-events', () =>
        HttpResponse.json([
          {
            id: 'ev-1',
            event_type: 'TRANSFERRED_OUT',
            occurred_on: '2026-01-01',
            created_at: '2026-01-01T00:00:00Z',
          },
        ]),
      ),
    );
    const { user } = setup('TRANSFER_CERTIFICATE');
    await next(user, /^next$/i);
    await screen.findByLabelText(/conduct/i);
    expect(screen.queryByRole('button', { name: /for all of class 10/i })).toBeNull();
  });

  it('Close with a typed value asks before discarding', async () => {
    serve();
    const { user, onClose } = setup();
    await next(user, /^next$/i);
    await user.type(await screen.findByLabelText(/conduct/i), 'Good');
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });
});
