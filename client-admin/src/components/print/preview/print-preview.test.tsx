import '@biddaloy/ui/test';

import type { PrinterRow, PrintTemplateRow } from '@biddaloy/ui/hooks';
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrintPreview } from './print-preview';
import { runPrint } from './run-print';

// jsdom can't open a print tab, so only `runPrint` is faked; everything else is real.
vi.mock('./run-print', () => ({ runPrint: vi.fn() }));

const template = (over: Partial<PrintTemplateRow> = {}): PrintTemplateRow => ({
  id: 't-1',
  name: 'Classic',
  document_kind: 'STUDENT_ID_CARD',
  layout_kind: 'FIXED',
  is_default: true,
  batch_size: 50,
  current_version_id: 'v-1',
  archived_at: null,
  created_at: '2027-01-01T00:00:00.000Z',
  updated_at: '2027-01-01T00:00:00.000Z',
  ...over,
});

const printer = (over: Partial<PrinterRow> = {}): PrinterRow => ({
  id: 'p-1',
  name: 'Front office',
  printer_type: 'CARD',
  margin_top_mm: 0,
  margin_right_mm: 0,
  margin_bottom_mm: 0,
  margin_left_mm: 0,
  offset_x_mm: 0,
  offset_y_mm: 0,
  scale: 1,
  duplex_order: 'INTERLEAVED',
  sheet_gap_mm: 2,
  archived_at: null,
  ...over,
});

const element = (extra: object) => ({
  id: 'e1',
  type: 'TEXT',
  x: 1,
  y: 1,
  w: 40,
  h: 6,
  fontFamily: 'Biddaloy Sans',
  sizePt: 10,
  weight: 400,
  color: '#000000',
  align: 'left',
  overflow: 'CLIP',
  ...extra,
});

const definition = (elements: object[]) => ({
  page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
  front: { elements },
});

/** Serves a preview whose items mirror the subject ids the page asks for. */
function servePreview(
  defn = definition([element({ field: 'student.name' })]),
  photoUrl: string | null = null,
) {
  server.use(
    http.post('/api/v1/print-jobs/preview', async ({ request }) => {
      const body = (await request.json()) as { subject_ids: string[] };
      return HttpResponse.json({
        template: {
          id: 't-1',
          batch_size: 50,
          version: { id: 'v-1', version: 1, definition: defn },
        },
        items: body.subject_ids.map((id) => ({
          subject_id: id,
          label: `Student ${id}`,
          values: { 'student.name': `Student ${id}` },
          photo_url: photoUrl,
        })),
      });
    }),
  );
}

function serveLists(templates: PrintTemplateRow[], printers: PrinterRow[]) {
  server.use(
    http.get('/api/v1/print-templates', () => HttpResponse.json(templates)),
    http.get('/api/v1/printers', () => HttpResponse.json(printers)),
    http.get('/api/v1/print-assets', () => HttpResponse.json([])),
  );
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s-${i + 1}`);

function setup(subjectIds = ids(3), withBack = false) {
  const onCreateTemplate = vi.fn();
  const onAddPrinter = vi.fn();
  const onDone = vi.fn();
  const onClose = vi.fn();
  const onBack = vi.fn();
  const view = renderWithProviders(
    en(
      <PrintPreview
        documentKind="STUDENT_ID_CARD"
        subjectType="STUDENT"
        subjectIds={subjectIds}
        onCreateTemplate={onCreateTemplate}
        onAddPrinter={onAddPrinter}
        onDone={onDone}
        onClose={onClose}
        {...(withBack ? { onBack } : {})}
      />,
    ),
    { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
  );
  return { ...view, onCreateTemplate, onAddPrinter, onDone, onClose, onBack };
}

const printResult = (n: number) => ({
  jobId: 'job-1',
  items: ids(n).map((id) => ({ itemId: `i-${id}`, subjectId: id, label: `Student ${id}` })),
});

/** Digits follow the region, and the default region is Bangla: pin Latin for English assertions. */
const en = (ui: React.ReactElement) => (
  <RegionConfigProvider value={REGION_BD_EN}>{ui}</RegionConfigProvider>
);

describe('PrintPreview', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(async () => {
    vi.mocked(runPrint).mockReset();
    await cleanupTestState();
  });

  it('splits 120 people into 3 batches of 50, and batch 2 stays locked until batch 1 is confirmed', async () => {
    serveLists([template()], [printer()]);
    servePreview();
    server.use(
      http.patch('/api/v1/print-jobs/:id/confirm', () =>
        HttpResponse.json({ job_id: 'job-1', status: 'CONFIRMED', failed_item_ids: [] }),
      ),
    );
    vi.mocked(runPrint).mockResolvedValue(printResult(50));
    const { user } = setup(ids(120));

    expect(await screen.findByText(/Round 1 of 3 · 50 cards/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );

    await user.click(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }));
    // The job is created and printed; now the answer is needed before anything else can happen.
    expect(await screen.findByText('Did all 50 cards print correctly?')).toBeTruthy();
    expect(screen.getByText(/Round 1 of 3/)).toBeTruthy(); // batch 2 is not reachable yet

    await user.click(screen.getByRole('button', { name: 'Yes, all printed' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/Round 2 of 3 · 50 cards/)).toBeTruthy();
    expect(vi.mocked(runPrint).mock.calls[0]?.[0].request).toMatchObject({
      kind: 'create',
      body: { subject_ids: ids(120).slice(0, 50), batch_label: '1/3' },
    });
  });

  it("clamps the batch size to the template's maximum", async () => {
    serveLists([template({ batch_size: 50 })], [printer()]);
    servePreview();
    const { user } = setup(ids(120));

    const input = await screen.findByLabelText<HTMLInputElement>(/Cards per round/);
    await user.clear(input);
    await user.type(input, '80');

    await waitFor(() => expect(input.value).toBe('50'));
    expect(screen.getByText(/Round 1 of 3/)).toBeTruthy();
  });

  it('clearing the batch size falls back to the maximum instead of breaking the batches', async () => {
    serveLists([template({ batch_size: 50 })], [printer()]);
    servePreview();
    const { user } = setup(ids(120));

    const input = await screen.findByLabelText<HTMLInputElement>(/Cards per round/);
    await user.clear(input); // a cleared number input reads as NaN

    await waitFor(() => expect(input.value).toBe('50'));
    expect(screen.getByText(/Round 1 of 3/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );
  });

  it('offers to create a template when there is none, as the frame primary, with Close', async () => {
    serveLists([], [printer()]);
    const { user, onCreateTemplate, onClose } = setup();

    expect(await screen.findByText('No design for this document yet')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create one from a suggestion' }));
    expect(onCreateTemplate).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('is a full-page frame: "Print preview" heading, Close, and Back only when onBack is passed', async () => {
    serveLists([template()], [printer()]);
    servePreview();
    const { user, onClose } = setup(ids(3), false);

    expect(await screen.findByRole('heading', { level: 1, name: 'Print preview' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows Back and calls onBack when the preview came from the picker', async () => {
    serveLists([template()], [printer()]);
    servePreview();
    const { user, onBack } = setup(ids(3), true);

    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('ignores an unpublished template (no current version)', async () => {
    serveLists([template({ current_version_id: null })], [printer()]);
    setup();
    expect(await screen.findByText('No design for this document yet')).toBeTruthy();
  });

  it('keeps Print disabled until a printer exists, and offers to add one', async () => {
    serveLists([template()], []);
    servePreview();
    const { user, onAddPrinter } = setup();

    expect(await screen.findByText('Add your first printer to be able to print.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Add your first printer' }));
    expect(onAddPrinter).toHaveBeenCalledOnce();
  });

  it('requires "Print anyway" when a card has a problem (here: no photo)', async () => {
    // jsdom can't measure text, so overflow itself can't be triggered here; a missing photo goes
    // through the very same pre-flight gate (D14).
    serveLists([template()], [printer()]);
    servePreview(
      definition([
        element({ field: 'student.name' }),
        element({ id: 'ph', type: 'IMAGE', field: 'student.photo' }),
      ]),
      null,
    );
    const { user } = setup(ids(2));

    expect(await screen.findByText('2 of 2 cards need attention')).toBeTruthy();
    const print = screen.getByRole<HTMLButtonElement>('button', { name: 'Print' });
    expect(print.disabled).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: 'Print this round anyway' }));
    expect(print.disabled).toBe(false);
  });

  it('restores the remembered printer and prints with it', async () => {
    window.localStorage.setItem('print.printer.school-1', 'p-2');
    serveLists([template()], [printer(), printer({ id: 'p-2', name: 'Staff room' })]);
    servePreview();
    vi.mocked(runPrint).mockResolvedValue(printResult(3));
    const { user } = setup();

    // The trigger shows the selected printer, so the remembered one was restored.
    expect(await screen.findByText('Staff room · Card printer')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );
    await user.click(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }));

    await waitFor(() => expect(runPrint).toHaveBeenCalledOnce());
    expect(vi.mocked(runPrint).mock.calls[0]?.[0].printer.id).toBe('p-2');
  });

  it('finishes (onDone) after the last batch is confirmed', async () => {
    serveLists([template()], [printer()]);
    servePreview();
    server.use(
      http.patch('/api/v1/print-jobs/:id/confirm', () =>
        HttpResponse.json({ job_id: 'job-1', status: 'CONFIRMED', failed_item_ids: [] }),
      ),
    );
    vi.mocked(runPrint).mockResolvedValue(printResult(3));
    const { user, onDone } = setup(ids(3));

    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );
    await user.click(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, all printed' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  });

  it('the round heading is the exact header.batch text, with a stepper marking done / current / locked', async () => {
    serveLists([template()], [printer()]);
    servePreview();
    server.use(
      http.patch('/api/v1/print-jobs/:id/confirm', () =>
        HttpResponse.json({ job_id: 'job-1', status: 'CONFIRMED', failed_item_ids: [] }),
      ),
    );
    vi.mocked(runPrint).mockResolvedValue(printResult(50));
    const { user } = setup(ids(120));

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Round 1 of 3 · 50 cards' }),
    ).toBeTruthy();
    const states = () =>
      within(screen.getByRole('list', { name: 'Rounds' }))
        .getAllByRole('listitem')
        .map((li) => li.getAttribute('data-state'));
    expect(states()).toEqual(['current', 'locked', 'locked']);

    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Print' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, all printed' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(states()).toEqual(['done', 'current', 'locked']));
  });

  it('flags a card with no photo with a badge on that card', async () => {
    serveLists([template()], [printer()]);
    servePreview(
      definition([
        element({ field: 'student.name' }),
        element({ id: 'ph', type: 'IMAGE', field: 'student.photo' }),
      ]),
      null,
    );
    setup(ids(1));

    const section = await screen.findByRole('region', { name: 'Card preview' });
    expect(within(section).getByText('No photo')).toBeTruthy();
  });

  it('names the missing field by its label, never by its raw key', async () => {
    serveLists([template()], [printer()]);
    servePreview();
    server.use(
      http.post('/api/v1/print-jobs/preview', () =>
        HttpResponse.json({
          template: {
            id: 't-1',
            batch_size: 50,
            version: {
              id: 'v-1',
              version: 1,
              definition: definition([element({ field: 'student.name' })]),
            },
          },
          items: [
            {
              subject_id: 's-1',
              label: 'Student s-1',
              values: { 'student.name': '' },
              photo_url: null,
            },
          ],
        }),
      ),
    );
    setup(ids(1));

    expect(await screen.findAllByText(/Missing: Name/)).toBeTruthy();
    expect(screen.queryByText(/student\.name/)).toBeNull();
  });

  it('locks the design select once the first round is printed', async () => {
    serveLists(
      [template(), template({ id: 't-2', name: 'Modern', is_default: false })],
      [printer()],
    );
    servePreview();
    vi.mocked(runPrint).mockResolvedValue(printResult(3));
    const { user } = setup(ids(3));

    const select = await screen.findByRole('combobox', { name: 'Design' });
    expect(select.hasAttribute('disabled')).toBe(false);
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Design', hidden: true }).hasAttribute('disabled'),
      ).toBe(true),
    );
    expect(screen.getByText("The design can't change once printing starts.")).toBeTruthy();
  });

  async function printAndConfirmFirstRound(user: ReturnType<typeof setup>['user']) {
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Print' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, all printed' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
  }

  function serveRun() {
    serveLists([template()], [printer()]);
    servePreview();
    server.use(
      http.patch('/api/v1/print-jobs/:id/confirm', () =>
        HttpResponse.json({ job_id: 'job-1', status: 'CONFIRMED', failed_item_ids: [] }),
      ),
    );
    vi.mocked(runPrint).mockResolvedValue(printResult(50));
  }

  it('Enter with focus on the shell prints once; Enter on a button does not print by itself', async () => {
    serveLists([template()], [printer()]);
    servePreview();
    vi.mocked(runPrint).mockResolvedValue(printResult(3));
    const { user } = setup(ids(3));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );

    screen.getByRole('button', { name: 'Close' }).focus();
    await user.keyboard('{Enter}'); // Close has no onClose effect on print
    expect(runPrint).not.toHaveBeenCalled();

    screen.getByRole('dialog').focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(runPrint).toHaveBeenCalledOnce());
  });

  it('a double click on Print starts one request', async () => {
    serveLists([template()], [printer()]);
    servePreview();
    vi.mocked(runPrint).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(printResult(3)), 50)),
    );
    const { user } = setup(ids(3));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );
    await user.dblClick(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(runPrint).toHaveBeenCalledOnce());
  });

  it('Back between rounds asks before dropping the run', async () => {
    serveRun();
    const { user, onBack } = setup(ids(120), true);
    await printAndConfirmFirstRound(user);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(onBack).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /discard/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('Close between rounds asks before leaving', async () => {
    serveRun();
    const { user, onClose } = setup(ids(120));
    await printAndConfirmFirstRound(user);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('names the missing staff name by its label too', async () => {
    serveLists([template()], [printer()]);
    server.use(
      http.post('/api/v1/print-jobs/preview', () =>
        HttpResponse.json({
          template: {
            id: 't-1',
            batch_size: 50,
            version: {
              id: 'v-1',
              version: 1,
              definition: definition([element({ field: 'staff.name' })]),
            },
          },
          items: [
            { subject_id: 's-1', label: 'Staff 1', values: { 'staff.name': '' }, photo_url: null },
          ],
        }),
      ),
    );
    renderWithProviders(
      en(
        <PrintPreview
          documentKind="STAFF_ID_CARD"
          subjectType="STAFF"
          subjectIds={['s-1']}
          onCreateTemplate={vi.fn()}
          onAddPrinter={vi.fn()}
          onDone={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
      { locale: 'en', role: 'ADMIN', tenantId: 'school-1' },
    );
    expect((await screen.findAllByText(/Missing: Name/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/staff\.name/)).toBeNull();
  });
});
