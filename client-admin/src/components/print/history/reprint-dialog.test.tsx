import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runPrint } from '../preview/run-print';

import { ReprintDialog } from './reprint-dialog';

vi.mock('../preview/run-print', () => ({ runPrint: vi.fn() }));

const printer = (id: string, name: string, archived = false) => ({
  id,
  name,
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
  archived_at: archived ? '2027-01-01T00:00:00.000Z' : null,
});

const row = {
  item_id: 'i-1',
  job_id: 'j-1',
  subject_label: 'Rahim',
  subject_type: 'STUDENT' as const,
};
const done = { jobId: 'j-2', items: [{ itemId: 'i-2', subjectId: 's-1', label: 'Rahim' }] };

let confirms: unknown[];
function serve(printers: unknown[]) {
  confirms = [];
  server.use(
    http.get('/api/v1/printers', () => HttpResponse.json(printers)),
    http.get('/api/v1/print-assets', () => HttpResponse.json([])),
    http.patch('/api/v1/print-jobs/:id/confirm', async ({ request }) => {
      confirms.push(await request.json());
      return HttpResponse.json({ ok: true });
    }),
  );
}

function open(onOpenChange = vi.fn()) {
  return {
    onOpenChange,
    ...renderWithProviders(<ReprintDialog open onOpenChange={onOpenChange} row={row} />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    }),
  };
}

describe('ReprintDialog', () => {
  beforeEach(() => {
    vi.mocked(runPrint).mockReset();
    localStorage.clear();
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it('with no printer it says to add one, and Print stays disabled', async () => {
    serve([]);
    open();
    expect(await screen.findByText('Add a printer in Settings first.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(true);
  });

  it('archived printers are not offered; a single live printer is chosen for you', async () => {
    serve([printer('p-1', 'Front office'), printer('p-2', 'Old one', true)]);
    open();
    const trigger = await screen.findByRole('combobox', { name: 'Printer' });
    await screen.findByText('Front office');
    expect(trigger).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false);
  });

  it('reprints just this card on the chosen printer, then asks "did it print?" and records yes', async () => {
    serve([printer('p-1', 'Front office')]);
    vi.mocked(runPrint).mockResolvedValue(done);
    const { user, onOpenChange } = open();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Print' }));

    expect(runPrint).toHaveBeenCalledOnce();
    const args = vi.mocked(runPrint).mock.calls[0]![0];
    expect(args.request).toEqual({ kind: 'reprint', jobId: 'j-1', itemIds: ['i-1'] });
    expect(args.printer.id).toBe('p-1');
    expect(args.subjectType).toBe('STUDENT');

    await user.click(await screen.findByRole('button', { name: /Yes, all printed/ }));
    await waitFor(() => expect(confirms).toEqual([{ failed_item_ids: [] }]));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stays on the form when nothing was printed (the job failed)', async () => {
    serve([printer('p-1', 'Front office')]);
    vi.mocked(runPrint).mockResolvedValue(undefined);
    const { user } = open();
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(runPrint).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Yes, all printed/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
  });

  it('a blocked pop-up and any other failure are reported differently', async () => {
    serve([printer('p-1', 'Front office')]);
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    vi.mocked(runPrint).mockImplementation((a) => {
      a.onError(new Error('POPUP_BLOCKED'));
      a.onError(new Error('boom'));
      return Promise.resolve(undefined);
    });
    const { user } = open();
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    expect(error.mock.calls[0]![0]).not.toBe(error.mock.calls[1]![0]);
  });

  it('Cancel closes without printing', async () => {
    serve([printer('p-1', 'Front office')]);
    const { user, onOpenChange } = open();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(runPrint).not.toHaveBeenCalled();
  });
});
