import '@biddaloy/ui/test';

import type { PrinterRow } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintersSection } from './PrintersSection';

// Only the print window is mocked: opening a real tab isn't possible in jsdom. `toast.error` is
// a spy because no Toaster is mounted in tests.
const openPrintWindow = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock('@biddaloy/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/components')>();
  return {
    ...actual,
    openPrintWindow,
    toast: Object.assign(
      (...args: Parameters<typeof actual.toast>) => actual.toast(...args),
      actual.toast,
      {
        error: toastError,
      },
    ),
  };
});

const printer = (over: Partial<PrinterRow> = {}): PrinterRow => ({
  id: 'p-1',
  name: 'Front office',
  printer_type: 'CARD',
  margin_top_mm: 0,
  margin_right_mm: 0,
  margin_bottom_mm: 0,
  margin_left_mm: 0,
  offset_x_mm: 1.5,
  offset_y_mm: -0.5,
  scale: 1,
  duplex_order: 'INTERLEAVED',
  sheet_gap_mm: 2,
  archived_at: null,
  ...over,
});

const listPrinters = (rows: PrinterRow[]) =>
  server.use(http.get('/api/v1/printers', () => HttpResponse.json(rows)));

const render = (role = 'ADMIN') =>
  renderWithProviders(<PrintersSection />, { locale: 'en', role, tenantId: 'school-1' });

describe('PrintersSection', () => {
  afterEach(async () => {
    openPrintWindow.mockReset();
    toastError.mockReset();
    await cleanupTestState();
  });

  it('shows the empty state with a way to add the first printer', async () => {
    listPrinters([]);
    render();

    await waitFor(() => expect(screen.getByText('Add your first printer')).toBeTruthy());
    expect(screen.getByText("You'll choose it each time you print.")).toBeTruthy();
    // The plain-language explainer is always there (D21).
    expect(screen.getByText(/can't tell which printer you pick/)).toBeTruthy();
  });

  it('lists a printer with its offset and duplex choice', async () => {
    listPrinters([printer()]);
    render();

    await waitFor(() => expect(screen.getByText('Front office')).toBeTruthy());
    expect(screen.getByText(/Offset X 1.5 mm, Y -0.5 mm/)).toBeTruthy();
    expect(screen.getByText(/Automatic both sides/)).toBeTruthy();
  });

  it('pre-fills 0 mm margins for a Card printer and 5 mm for an Office printer', async () => {
    listPrinters([]);
    const { user } = render();
    await waitFor(() => expect(screen.getByText('Add your first printer')).toBeTruthy());

    await user.click(screen.getAllByRole('button', { name: 'Add printer' })[0]!);
    const top = () => screen.getByLabelText<HTMLInputElement>('Top');
    expect(top().value).toBe('0'); // a card printer prints edge to edge
    expect(screen.queryByLabelText('Cutting gap (mm)')).toBeNull();

    await user.click(screen.getByRole('radio', { name: /Office printer/ }));
    expect(top().value).toBe('5'); // an office printer has a no-print band
    expect(screen.getByLabelText<HTMLInputElement>('Left').value).toBe('5');
    expect(screen.getByLabelText('Cutting gap (mm)')).toBeTruthy(); // A4 sheets only
  });

  it('blocks an offset outside -10..10 mm and sends nothing', async () => {
    listPrinters([]);
    let posted = 0;
    server.use(
      http.post('/api/v1/printers', () => {
        posted += 1;
        return HttpResponse.json(printer(), { status: 201 });
      }),
    );
    const { user } = render();
    await waitFor(() => expect(screen.getByText('Add your first printer')).toBeTruthy());

    await user.click(screen.getAllByRole('button', { name: 'Add printer' })[0]!);
    await user.type(screen.getByLabelText('Name'), 'Back office');
    const x = screen.getByLabelText('Offset X (mm)');
    await user.clear(x);
    await user.type(x, '11');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByText('Offset must be between −10 and 10 mm.')).toBeTruthy(),
    );
    expect(posted).toBe(0);
  });

  it('saves a valid printer', async () => {
    listPrinters([]);
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/printers', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(printer({ name: 'Back office' }), { status: 201 });
      }),
    );
    const { user } = render();
    await waitFor(() => expect(screen.getByText('Add your first printer')).toBeTruthy());

    await user.click(screen.getAllByRole('button', { name: 'Add printer' })[0]!);
    await user.type(screen.getByLabelText('Name'), 'Back office');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({
      name: 'Back office',
      printer_type: 'CARD',
      offset_x_mm: 0,
      scale: 1,
    });
    expect(body).not.toHaveProperty('sheet_gap_mm'); // a card printer has no cutting gap
  });

  it("calibration opens the print window with the printer's own offset in the page", async () => {
    listPrinters([printer()]);
    const { user } = render();
    await waitFor(() => expect(screen.getByText('Front office')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Print calibration page' }));

    expect(openPrintWindow).toHaveBeenCalledOnce();
    const prepare = openPrintWindow.mock.calls[0]![0] as () => Promise<string>;
    const html = await prepare();
    expect(html).toContain('translate(1.5mm,-0.5mm)'); // the current correction, so a reprint shows if it worked
    // The 3-step guide appears after the tab opens.
    expect(screen.getByText(/Measure how far the first cross/)).toBeTruthy();
  });

  it('archives a printer only after a confirmation dialog', async () => {
    listPrinters([printer()]);
    let archived = 0;
    server.use(
      http.post('/api/v1/printers/p-1/archive', () => {
        archived += 1;
        return HttpResponse.json(printer({ archived_at: '2027-01-01T00:00:00.000Z' }));
      }),
    );
    const { user } = render();
    await waitFor(() => expect(screen.getByText('Front office')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(archived).toBe(0); // asking first, nothing sent yet
    // The dialog has its own Archive button; scope to it so we don't hit the list row's.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(archived).toBe(1));
  });

  it('tells the person when archiving fails, instead of closing the dialog silently', async () => {
    listPrinters([printer()]);
    server.use(
      http.post('/api/v1/printers/p-1/archive', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    const { user } = render();
    await waitFor(() => expect(screen.getByText('Front office')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not archive the printer. Try again.'),
    );
  });

  it('is hidden without PRINT_TEMPLATE_MANAGE', () => {
    listPrinters([printer()]);
    const { container } = render('ACCOUNTANT');
    expect(container.textContent).toBe('');
  });
});
