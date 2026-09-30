import type { PrinterRow } from '@biddaloy/ui/hooks';
import { describe, expect, it, vi } from 'vitest';

import { runPrint, type RunPrintArgs, type RunPrintDeps } from './run-print';

const printer: PrinterRow = {
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
};

const definition = {
  page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
  front: {
    background: { assetId: 'art-1', print: true },
    elements: [{ id: 't', type: 'TEXT', field: 'student.name', fontFamily: 'Noto Sans Bengali' }],
  },
};

const job = (over: object = {}) => ({
  job_id: 'job-1',
  version: { id: 'v-1', definition },
  items: [
    {
      item_id: 'i-1',
      subject_id: 's-1',
      label: 'Rahim',
      values: { 'student.name': 'Rahim', 'school.logo': 'tenants/t/logo.png' },
      copy_number: 2,
      verify_url: '/v/abc',
      photo_url: '/print-jobs/photo?key=k',
    },
  ],
  ...over,
});

/** `openPrintWindow`'s contract: open a tab, run `prepare`, close the tab and report if it throws. */
function fakeDeps(order: string[], over: Partial<RunPrintDeps> = {}) {
  const closed = vi.fn();
  const deps = {
    createPrintJob: vi.fn(() => {
      order.push('createPrintJob');
      return Promise.resolve(job());
    }),
    reprintPrintJob: vi.fn(() => {
      order.push('reprintPrintJob');
      return Promise.resolve(job());
    }),
    buildPrintDocument: vi.fn(() => {
      order.push('buildPrintDocument');
      return Promise.resolve('<html></html>');
    }),
    openPrintWindow: vi.fn(async (prepare: () => Promise<string>, onError: (e: Error) => void) => {
      try {
        await prepare();
      } catch (e) {
        closed();
        onError(e instanceof Error ? e : new Error(String(e)));
      }
    }),
    fetchBlob: vi.fn(() => Promise.resolve(new Blob(['x'], { type: 'image/png' }))),
    fetchStatic: vi.fn(() => Promise.resolve(new Blob(['f'], { type: 'font/woff2' }))),
    origin: 'https://school.example',
    ...over,
  } as unknown as RunPrintDeps;
  return { deps, closed };
}

const args = (over: Partial<RunPrintArgs> = {}): RunPrintArgs => ({
  request: {
    kind: 'create',
    body: { template_id: 't-1', subject_type: 'STUDENT', subject_ids: ['s-1'] },
  },
  printer,
  assets: [],
  subjectType: 'STUDENT',
  tenantId: 'school-1',
  lang: 'en',
  title: 'ID cards',
  onError: vi.fn(),
  ...over,
});

describe('runPrint', () => {
  it('creates the job BEFORE building the document (D9)', async () => {
    const order: string[] = [];
    const { deps } = fakeDeps(order);

    const result = await runPrint(args(), deps);

    expect(order).toEqual(['createPrintJob', 'buildPrintDocument']);
    expect(result).toEqual({
      jobId: 'job-1',
      items: [{ itemId: 'i-1', subjectId: 's-1', label: 'Rahim' }],
    });
  });

  it('a failed job creation builds nothing, closes the tab and reports the error', async () => {
    const order: string[] = [];
    const onError = vi.fn();
    const { deps, closed } = fakeDeps(order, {
      createPrintJob: vi.fn(() => Promise.reject(new Error('boom'))),
    });

    const result = await runPrint(args({ onError }), deps);

    expect(deps.buildPrintDocument).not.toHaveBeenCalled();
    expect(deps.fetchBlob).not.toHaveBeenCalled(); // not even a photo fetch
    expect(closed).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(result).toBeUndefined();
  });

  it('a build failure after the job exists reports failure, so nobody is asked "did it print?"', async () => {
    const onError = vi.fn();
    const { deps } = fakeDeps([], {
      buildPrintDocument: vi.fn(() => Promise.reject(new Error('font is not a data URL'))),
    });

    expect(await runPrint(args({ onError }), deps)).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('makes the verify URL absolute and hands the copy number and photo to the builder', async () => {
    const { deps } = fakeDeps([]);

    await runPrint(args(), deps);

    const input = vi.mocked(deps.buildPrintDocument).mock.calls[0]![0];
    const card = input.cards[0]!;
    expect(card['print.verify_qr']).toBe('https://school.example/v/abc'); // a blob: tab has no origin
    expect(card['print.copyNumber']).toBe('2'); // so a reprint shows "Copy 2" (D23)
    expect(card['student.photo']).toMatch(/^data:/); // the tab makes no requests
    expect(card['school.logo']).toMatch(/^data:/);
    expect(input.assetUrl('art-1')).toMatch(/^data:/);
  });

  it('embeds only the bundled fonts the template uses, as data URLs', async () => {
    const { deps } = fakeDeps([]);

    await runPrint(args(), deps);

    const fonts = vi.mocked(deps.buildPrintDocument).mock.calls[0]![0].fonts;
    expect(fonts.map((f) => f.family)).toEqual(['Noto Sans Bengali']);
    expect(fonts[0]!.url).toMatch(/^data:/);
  });

  it('a reprint goes through reprintPrintJob with the chosen items', async () => {
    const order: string[] = [];
    const { deps } = fakeDeps(order);

    await runPrint(args({ request: { kind: 'reprint', jobId: 'job-0', itemIds: ['i-9'] } }), deps);

    expect(deps.reprintPrintJob).toHaveBeenCalledWith('job-0', ['i-9']);
    expect(deps.createPrintJob).not.toHaveBeenCalled();
    expect(order[0]).toBe('reprintPrintJob');
  });
});
