import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { academicYearFactory, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { SaveAsReportDialog, type SaveAsReportDialogProps } from './save-as-report-dialog';

/** Test-host labels, not product copy. */
const TEXT = { reopen: 'reopen-dialog' } as const;

type Posted = { url: string; key: string | null; body: Record<string, unknown> | null };
let posted: Posted[] = [];

function mockApi(options: { publishFails?: number } = {}) {
  posted = [];
  let publishCalls = 0;
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [
          academicYearFactory({ name: '2025', is_current: false }),
          academicYearFactory({ name: '2026', is_current: true }),
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.post('/api/v1/reports/definitions', async ({ request }) => {
      posted.push({
        url: '/reports/definitions',
        key: request.headers.get('idempotency-key'),
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json({ id: 'def-1' });
    }),
    http.post('/api/v1/reports/definitions/:id/publish', ({ request }) => {
      publishCalls += 1;
      posted.push({
        url: new URL(request.url).pathname,
        key: request.headers.get('idempotency-key'),
        body: null,
      });
      if (publishCalls <= (options.publishFails ?? 0)) {
        return HttpResponse.json(
          {
            statusCode: 422,
            message: 'nope',
            error: 'Unprocessable',
            requestId: 'r',
            path: '/',
            timestamp: '',
          },
          { status: 422 },
        );
      }
      return HttpResponse.json({ id: 'v1', definition_id: 'def-1', version: 1 });
    }),
  );
}

type Props = Omit<SaveAsReportDialogProps, 'open' | 'onOpenChange'>;

function mount(props: Props, locale: 'en' | 'bn' = 'en') {
  function Host() {
    const [open, setOpen] = React.useState(true);
    return (
      <RegionConfigProvider value={locale === 'bn' ? REGION_BD_BN : REGION_BD_EN}>
        <button onClick={() => setOpen(true)}>{TEXT.reopen}</button>
        <SaveAsReportDialog open={open} onOpenChange={setOpen} {...props} />
      </RegionConfigProvider>
    );
  }
  const root = createRootRoute();
  const home = createRoute({ getParentRoute: () => root, path: '/', component: Host });
  return renderWithRouter(root.addChildren([home]), {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale,
  });
}

const STUDENTS: Props = {
  kind: 'students',
  filters: { class_id: 'c8', section_id: 's1', gender: 'FEMALE', search: 'rahim' },
  names: { className: 'Class 8', sectionName: 'A' },
  columns: ['roll', 'name', 'class', 'status', 'address'],
};

describe('SaveAsReportDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('opens with a name made from the filters, says what will not go in, and is axe clean', async () => {
    mockApi();
    const { baseElement } = mount(STUDENTS);
    const name = await screen.findByRole<HTMLInputElement>('textbox', { name: /Report name/ });
    expect(name.value).toBe('Class 8 · A — Students');
    expect(
      screen.getByText('This filter will not go into the report: What you typed in search'),
    ).toBeTruthy();
    expect(screen.getByText('This column will not go into the report: Address')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Keep as report' }).disabled,
      ).toBe(false),
    );
    await expect(baseElement).toHaveNoViolations();
  });

  it('creates the draft, then publishes it, each with its own Idempotency-Key', async () => {
    mockApi();
    mount(STUDENTS);
    const user = userEvent.setup();
    const save = await screen.findByRole('button', { name: 'Keep as report' });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.click(save);
    await waitFor(() => expect(posted).toHaveLength(2));
    const [create, publish] = posted;
    expect(create?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(publish?.url).toBe('/api/v1/reports/definitions/def-1/publish');
    expect(publish?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(publish?.key).not.toBe(create?.key);
    const body = create?.body as {
      key: string;
      name_en: string;
      name_bn: string;
      visible_roles: string[];
      definition: { subjectArea: string; parameters: { key: string }[] };
    };
    expect(body.key).toMatch(/^students-[0-9a-f]{8}$/);
    expect(body.name_en).toBe('Class 8 · A — Students');
    expect(body.name_bn).toBe(body.name_en);
    expect(body.visible_roles).toEqual(['ADMIN']);
    expect(body.definition.subjectArea).toBe('STUDENTS');
    expect(body.definition.parameters.map((p) => p.key)).toEqual(['academic_year']);
    // The dialog closes once the report is kept.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('fixes the year in the report when its question is switched off', async () => {
    mockApi();
    mount(STUDENTS);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('switch', { name: /Academic year: ask when running/ }),
    );
    expect(screen.getByText('It stays 2026.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep as report' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    const definition = (
      posted[0]?.body as {
        definition: {
          parameters: unknown[];
          dataset: { filters: { field: string; value: unknown }[] };
        };
      }
    ).definition;
    expect(definition.parameters).toEqual([]);
    expect(definition.dataset.filters.find((f) => f.field === 'academic_year')?.value).toBe('2026');
  });

  it('shares the report with the roles ticked, and keeps Admin on', async () => {
    mockApi();
    mount(STUDENTS);
    const user = userEvent.setup();
    const admin = await screen.findByRole('checkbox', { name: 'Admin' });
    expect(admin.getAttribute('aria-checked')).toBe('true');
    expect((admin as HTMLButtonElement).disabled).toBe(true);
    const group = screen.getByRole('group', { name: 'Who can see it' });
    await user.click(within(group).getByRole('checkbox', { name: 'Accountant' }));
    await user.click(screen.getByRole('button', { name: 'Keep as report' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect((posted[0]?.body as { visible_roles: string[] }).visible_roles).toEqual([
      'ADMIN',
      'ACCOUNTANT',
    ]);
  });

  it('asks for a name before sending anything', async () => {
    mockApi();
    mount(STUDENTS);
    const user = userEvent.setup();
    const name = await screen.findByRole('textbox', { name: /Report name/ });
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Keep as report' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Give the report a name.');
    expect(posted).toHaveLength(0);
  });

  it('a failed publish locks the form and a retry only publishes, never a second draft', async () => {
    mockApi({ publishFails: 1 });
    mount(STUDENTS);
    const user = userEvent.setup();
    const save = await screen.findByRole('button', { name: 'Keep as report' });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.click(save);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The report was saved but could not be switched on. Try again.',
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Report name/ }).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Keep as report' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted.filter((p) => p.url === '/reports/definitions')).toHaveLength(1);
    expect(posted.filter((p) => p.url.endsWith('/publish'))).toHaveLength(2);
  });

  it('sends one request however fast it is double-clicked', async () => {
    mockApi();
    mount(STUDENTS);
    const user = userEvent.setup();
    const save = await screen.findByRole('button', { name: 'Keep as report' });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    await user.dblClick(save);
    await waitFor(() => expect(posted.length).toBeGreaterThanOrEqual(2));
    expect(posted.filter((p) => p.url === '/reports/definitions')).toHaveLength(1);
  });

  it('does not ask the server about years for a dues list, and names it after the class', async () => {
    mockApi();
    let yearCalls = 0;
    server.use(
      http.get('/api/v1/academic-years', () => {
        yearCalls += 1;
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 });
      }),
    );
    mount({
      kind: 'dues',
      filters: { class_id: 'c8', flagged: 'true' },
      names: { className: 'Class 8' },
      columns: ['student', 'due'],
    });
    const name = await screen.findByRole<HTMLInputElement>('textbox', { name: /Report name/ });
    expect(name.value).toBe('Class 8 — Overdue dues');
    expect(yearCalls).toBe(0);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('says it in Bangla under bn, with Bangla digits for the date range', async () => {
    mockApi();
    mount(
      {
        kind: 'payments',
        filters: { date_from: '2026-10-01', date_to: '2026-10-31' },
      },
      'bn',
    );
    expect(await screen.findByRole('heading', { name: 'রিপোর্ট হিসেবে রাখুন' })).toBeTruthy();
    const name = screen.getByRole<HTMLInputElement>('textbox', { name: /রিপোর্টের নাম/ });
    expect(name.value).toBe('জমা');
    expect(screen.getByText('তারিখ: চালানোর সময় জিজ্ঞেস করবেন')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'রিপোর্টে রাখুন' })).toBeTruthy();
  });
});
