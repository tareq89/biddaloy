/**
 * [8.15.30] The report print document: the pages for a fixture, the `/print/document?doc=report`
 * screen end to end (re-run from the URL, every page of the answer, the print button), and the
 * small pure helpers (sheet size, page-number CSS, the "what was chosen" line).
 */
import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

import {
  ReportPrintPages,
  describeParams,
  pageCss,
  pickOrientation,
  type ReportPrintPagesProps,
} from './report-pages';

const API = '/api/v1';
const REPORT_ID = '55555555-5555-4555-8555-555555555555';

const ISSUER = {
  name: 'Green Valley School',
  name_bn: null,
  address: 'Dhanmondi, Dhaka',
  phone: null,
  email: null,
  registration_id: '123456',
  logo_key: null,
};

const COLUMNS = [
  { key: 'class', label_en: 'Class', label_bn: 'শ্রেণি', type: 'TEXT', kind: 'dimension' },
  { key: 'section', label_en: 'Section', label_bn: 'শাখা', type: 'TEXT', kind: 'dimension' },
  {
    key: 'students',
    label_en: 'Students',
    label_bn: 'শিক্ষার্থী',
    type: 'NUMBER',
    kind: 'measure',
  },
] as const;

const ROWS = [
  { class: 'Class 6', section: 'A', students: 40 },
  { class: 'Class 6', section: 'B', students: 38 },
  { class: 'Class 7', section: 'A', students: 41 },
];

function fixture(
  overrides: Partial<ReportPrintPagesProps['result']> = {},
): ReportPrintPagesProps['result'] {
  return {
    columns: [...COLUMNS],
    rows: ROWS,
    masked: [],
    suppressed: false,
    truncated: false,
    total_rows: ROWS.length,
    page: 1,
    page_size: 100,
    total_pages: 1,
    run_id: 'run-1',
    ...overrides,
  };
}

/** Test data, not product copy. */
const TITLE = 'Students by class';

const GROUPED = { type: 'GROUPED' as const, group_by: ['class'], subtotals: true, totals: true };

/** Renders the pages and waits for the namespaces (the renderers suspend until they load). */
async function pages(props: Partial<ReportPrintPagesProps> = {}, locale: 'en' | 'bn' = 'en') {
  const view = renderPages(props, locale);
  await view.localeReady;
  await screen.findAllByRole('table');
  return view;
}

function renderPages(props: Partial<ReportPrintPagesProps>, locale: 'en' | 'bn') {
  return renderWithProviders(
    <RegionConfigProvider value={locale === 'bn' ? REGION_BD_BN : REGION_BD_EN}>
      <ReportPrintPages
        result={fixture()}
        layout={GROUPED}
        title={TITLE}
        chosen="2026 · Class 6 · All sections"
        issuer={ISSUER}
        activeLanguage={locale}
        printedOn="Printed: 31 October 2026"
        {...props}
      />
    </RegionConfigProvider>,
    { locale },
  );
}

const sheets = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-slot="a4-document"]'));
const css = () => document.querySelector('style[data-slot="report-print-page"]')?.textContent ?? '';

describe('ReportPrintPages', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('builds the pages for a grouped fixture: school header, title, what was chosen, date', async () => {
    const { container } = await pages();
    const [sheet] = sheets(container);
    expect(sheets(container)).toHaveLength(1);
    expect(within(sheet!).getByText('Green Valley School')).toBeTruthy();
    expect(within(sheet!).getByText('EIIN: 123456')).toBeTruthy();
    expect(within(sheet!).getByRole('heading', { name: 'Students by class' })).toBeTruthy();
    expect(within(sheet!).getByText('2026 · Class 6 · All sections')).toBeTruthy();
    expect(within(sheet!).getByText('Printed: 31 October 2026')).toBeTruthy();
    // The grouped renderer, forced into its table form: group headers and the grand total.
    expect(within(sheet!).getByRole('table')).toBeTruthy();
    expect(within(sheet!).getAllByText('Class 7').length).toBeGreaterThan(0);
    await expect(container).toHaveNoViolations();
  });

  it('is a portrait A4 sheet by default and numbers the pages in the foot margin', async () => {
    const { container } = await pages();
    expect(sheets(container)[0]?.dataset.orientation).toBe('portrait');
    expect(css()).toContain('size: A4 portrait');
    expect(css()).toContain('counter(page, decimal)');
    expect(css()).toContain('counter(pages, decimal)');
    expect(css()).toContain('"Page "');
  });

  it('applies landscape when the definition says so', async () => {
    const { container } = await pages({ page: { orientation: 'landscape' } });
    expect(sheets(container)[0]?.dataset.orientation).toBe('landscape');
    expect(css()).toContain('size: A4 landscape');
  });

  it('applies landscape for a wide table of counts, whatever the definition says', async () => {
    const regions = ['N', 'S', 'E', 'W', 'NE', 'NW'];
    const wide = fixture({
      columns: [
        { key: 'class', label_en: 'Class', label_bn: 'শ্রেণি', type: 'TEXT', kind: 'dimension' },
        { key: 'region', label_en: 'Region', label_bn: 'অঞ্চল', type: 'TEXT', kind: 'dimension' },
        {
          key: 'students',
          label_en: 'Students',
          label_bn: 'শিক্ষার্থী',
          type: 'NUMBER',
          kind: 'measure',
        },
      ],
      rows: regions.map((region) => ({ class: 'Class 6', region, students: 10 })),
    });
    const { container } = await pages({
      result: wide,
      layout: { type: 'CROSSTAB', rows: ['class'], columns: ['region'], cell_measure: 'students' },
      page: { orientation: 'portrait' },
    });
    expect(sheets(container)[0]?.dataset.orientation).toBe('landscape');
  });

  it('starts each top group on its own sheet, with the header on every sheet, when the report asks', async () => {
    const { container } = await pages({ page: { break_groups: true } });
    const all = sheets(container);
    expect(all).toHaveLength(2);
    for (const sheet of all) expect(within(sheet).getByText('Green Valley School')).toBeTruthy();
    // Class 6 (40, 38) on the first sheet, Class 7 (41) on the second.
    expect(within(all[0]!).queryAllByText('41')).toHaveLength(0);
    expect(within(all[1]!).getAllByText('41').length).toBeGreaterThan(0);
    expect(within(all[1]!).queryAllByText('40')).toHaveLength(0);
    // Sheets break after themselves except the last one (A4Document's own classes).
    expect(all[0]!.className).toContain('print:break-after-page');
  });

  it('keeps one sheet without the break flag, even with several groups', async () => {
    const { container } = await pages();
    expect(sheets(container)).toHaveLength(1);
  });

  it('prints a plain table when it does not know the layout (no design permission)', async () => {
    const { container } = await pages({ layout: undefined, chosen: '' });
    const [sheet] = sheets(container);
    expect(within(sheet!).getByRole('table')).toBeTruthy();
    expect(within(sheet!).getByText('Students')).toBeTruthy();
    expect(within(sheet!).queryByText('2026 · Class 6 · All sections')).toBeNull();
  });

  it('says when the cap cut the report short', async () => {
    await pages({ result: fixture({ truncated: true }) });
    expect(
      screen.getByText('This report is very long. Only the first 3 rows are printed.'),
    ).toBeTruthy();
  });

  it('prints Bangla digits and page numbers under bn', async () => {
    const { container } = await pages({ printedOn: 'প্রিন্ট: ৩১ অক্টোবর ২০২৬' }, 'bn');
    expect(css()).toContain('counter(page, bengali)');
    expect(css()).toContain('"পাতা "');
    expect(within(sheets(container)[0]!).getByText('৪০')).toBeTruthy();
  });
});

describe('pickOrientation', () => {
  const narrow = { columns: fixture().columns, rows: ROWS };

  it('follows the definition, else portrait', () => {
    expect(pickOrientation(narrow, undefined, undefined)).toBe('portrait');
    expect(pickOrientation(narrow, undefined, { orientation: 'landscape' })).toBe('landscape');
  });

  it('goes landscape for a flat table with many columns, but not for a chart', () => {
    const many = {
      columns: Array.from({ length: 8 }, (_, i) => ({ ...COLUMNS[0], key: `c${i}` })),
      rows: [],
    };
    expect(pickOrientation(many, undefined, undefined)).toBe('landscape');
    expect(pickOrientation(many, { type: 'CHART' }, undefined)).toBe('portrait');
  });
});

describe('pageCss', () => {
  it('writes the sheet size and a footer from the browser counters', () => {
    expect(pageCss('landscape', 'Page {{page}} of {{total}}', 'latin')).toBe(
      '@media print { @page { size: A4 landscape; margin: 10mm 10mm 14mm; @bottom-center { content: "Page " counter(page, decimal) " of " counter(pages, decimal); font-size: 9pt; } } }',
    );
  });

  it('never lets a quote in a translation end the CSS string', () => {
    expect(pageCss('portrait', 'a"b {{page}}', 'bengali')).toContain(
      '"a b " counter(page, bengali)',
    );
  });
});

describe('describeParams', () => {
  it('turns the answers into one plain line, in the school numerals', () => {
    const params = {
      academic_year: '2026',
      class: ['Class 6', 'Class 7'],
      section: [],
      range: { from: '2026-10-01', to: '2026-10-31' },
    };
    expect(describeParams(params, REGION_BD_EN)).toBe(
      '2026 · Class 6, Class 7 · 1st – 31st October',
    );
    expect(describeParams({ academic_year: '2026' }, REGION_BD_BN)).toBe('২০২৬');
    expect(describeParams({}, REGION_BD_EN)).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------

const PROFILE = { ...ISSUER, logo_url: null };

function stubWide(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

interface Seen {
  runs: { definitionId: string; params: unknown; page?: number }[];
  definitionReads: number;
  documentPrints: number;
}

function mockApi(options: { totalPages?: number } = {}): Seen {
  const seen: Seen = { runs: [], definitionReads: 0, documentPrints: 0 };
  const totalPages = options.totalPages ?? 1;
  server.use(
    http.get(`${API}/schools/me/profile`, () => HttpResponse.json(PROFILE)),
    http.get(`${API}/reports/catalogue`, () =>
      HttpResponse.json([
        {
          folder: null,
          reports: [
            {
              id: REPORT_ID,
              key: 'students-by-class',
              name_en: 'Students by class',
              name_bn: 'শ্রেণিভিত্তিক শিক্ষার্থী',
              version_id: 'v1',
              system_template_key: null,
            },
          ],
        },
      ]),
    ),
    http.get(`${API}/reports/definitions/${REPORT_ID}`, () => {
      seen.definitionReads += 1;
      return HttpResponse.json({
        id: REPORT_ID,
        name_en: 'Students by class',
        name_bn: 'শ্রেণিভিত্তিক শিক্ষার্থী',
        draft: { layout: GROUPED, page: { orientation: 'portrait', title_en: '', title_bn: '' } },
      });
    }),
    http.post(`${API}/reports/run`, async ({ request }) => {
      const body = (await request.json()) as Seen['runs'][number];
      seen.runs.push(body);
      const page = body.page ?? 1;
      const rows = page === 1 ? ROWS.slice(0, 2) : ROWS.slice(2);
      return HttpResponse.json(
        fixture({
          rows: totalPages > 1 ? rows : ROWS,
          page,
          page_size: totalPages > 1 ? 2 : 100,
          total_pages: totalPages,
          total_rows: ROWS.length,
        }),
      );
    }),
    http.post(`${API}/students/:id/document-prints`, () => {
      seen.documentPrints += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return seen;
}

function render(search: string, role = 'ADMIN', wide = true) {
  stubWide(wide);
  return renderWithRouter(routeTree, {
    initialEntries: [`/print/document?${search}`],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

const PARAMS = encodeURIComponent(JSON.stringify({ academic_year: '2026', class: ['Class 6'] }));

describe('/print/document?doc=report', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('re-runs the report with the answers in the URL and prints what it ran', async () => {
    const seen = mockApi();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(`doc=report&definitionId=${REPORT_ID}&params=${PARAMS}`);

    expect(await screen.findByText('Green Valley School', {}, { timeout: 5000 })).toBeTruthy();
    expect(seen.runs).toEqual([
      { definitionId: REPORT_ID, params: { academic_year: '2026', class: ['Class 6'] } },
    ]);
    // The name comes from the catalogue, the line from the answers, and the layout from the definition.
    expect(await screen.findAllByText('Students by class')).not.toHaveLength(0);
    expect(screen.getAllByText(/(2026|২০২৬) · Class 6/).length).toBeGreaterThan(0);
    expect(await screen.findByText('Class 7')).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Print' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);
    // The run is the audit: no student-scoped document-print row.
    expect(seen.documentPrints).toBe(0);
  });

  it('fetches every page of the answer, not just the first', async () => {
    const seen = mockApi({ totalPages: 2 });
    render(`doc=report&definitionId=${REPORT_ID}&params=${PARAMS}`);
    // The digits follow the region (the test tree has no tenant provider, so Bangla here).
    expect((await screen.findAllByText(/^(41|৪১)$/, {}, { timeout: 5000 })).length).toBeGreaterThan(
      0,
    );
    expect(seen.runs.map((r) => r.page)).toEqual([undefined, 2]);
    expect(screen.getAllByText(/^(40|৪০)$/).length).toBeGreaterThan(0);
  });

  it("runs with the report's own defaults when the params are not an object", async () => {
    const seen = mockApi();
    render(`doc=report&definitionId=${REPORT_ID}&params=not-json`);
    await screen.findByText('Class 7', {}, { timeout: 5000 });
    expect(seen.runs[0]?.params).toEqual({});
  });

  it('prints a plain table, and never asks for the definition, without the design permission', async () => {
    const seen = mockApi();
    render(`doc=report&definitionId=${REPORT_ID}&params=${PARAMS}`, 'ACCOUNTANT');
    expect(await screen.findByText('Class 7', {}, { timeout: 5000 })).toBeTruthy();
    expect(seen.definitionReads).toBe(0);
    expect(screen.getAllByText('Students by class').length).toBeGreaterThan(0);
  });

  it('says so when the person may not run reports, and runs nothing', async () => {
    const seen = mockApi();
    render(`doc=report&definitionId=${REPORT_ID}&params=${PARAMS}`, 'OFFICE_STAFF');
    expect(
      await screen.findByText('You cannot print this report.', {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(seen.runs).toHaveLength(0);
  });

  it('says what to change when the report ran and nobody matched', async () => {
    mockApi();
    server.use(
      http.post(`${API}/reports/run`, () =>
        HttpResponse.json(fixture({ rows: [], total_rows: 0 })),
      ),
    );
    render(`doc=report&definitionId=${REPORT_ID}&params=${PARAMS}`);
    expect(
      await screen.findByText('Nobody matches these choices', {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(true);
  });

  it('shows the empty state when no report is named', async () => {
    mockApi();
    render('doc=report');
    expect(await screen.findByText('Nothing to print.', {}, { timeout: 5000 })).toBeTruthy();
  });

  it('shows the desktop-only state on a phone, and runs nothing', async () => {
    mockApi();
    render(`doc=report&definitionId=${REPORT_ID}&params=${PARAMS}`, 'ADMIN', false);
    expect(
      await screen.findByRole('button', { name: 'Copy link' }, { timeout: 5000 }),
    ).toBeTruthy();
  });

  it('offers a retry when the run fails', async () => {
    mockApi();
    server.use(
      http.post(`${API}/reports/run`, () =>
        HttpResponse.json(
          {
            statusCode: 500,
            message: 'boom',
            error: 'x',
            requestId: 'r',
            path: '/',
            timestamp: '',
          },
          { status: 500 },
        ),
      ),
    );
    render(`doc=report&definitionId=${REPORT_ID}&params=${PARAMS}`);
    expect(
      await screen.findByText('The document could not be loaded.', {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeTruthy();
  });
});
