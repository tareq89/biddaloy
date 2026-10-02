import { apiClient } from '@biddaloy/ui/api';
import type { PrinterRow } from '@biddaloy/ui/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultRunPrintDeps, runPrint, type RunPrintArgs, type RunPrintDeps } from './run-print';

/** The paths `run-print.test.ts` leaves out: reprint, staff cards, uploaded fonts, empty photo/logo, real fetchers. */

const printer = {
  id: 'p',
  name: 'P',
  printer_type: 'OFFICE',
  margin_top_mm: 5,
  margin_right_mm: 5,
  margin_bottom_mm: 5,
  margin_left_mm: 5,
  offset_x_mm: 0,
  offset_y_mm: 0,
  scale: 1,
  duplex_order: 'GROUPED',
  sheet_gap_mm: 2,
  archived_at: null,
} as PrinterRow;

const definition = {
  page: { widthMm: 85.6, heightMm: 54, sides: ['front', 'back'] },
  front: {
    elements: [
      {
        id: 't',
        type: 'TEXT',
        field: 'staff.name',
        fontFamily: 'Custom Face',
        fontAssetId: 'font-1',
      },
    ],
  },
  back: { elements: [] },
};

const job = (item: object) => ({
  job_id: 'job-9',
  version: { id: 'v', definition },
  items: [
    {
      item_id: 'i',
      subject_id: 's',
      label: 'Fatema',
      values: { 'staff.name': 'Fatema' }, // no school.logo wanted
      copy_number: 1,
      verify_url: '/v/x',
      photo_url: null, // no photo
      ...item,
    },
  ],
});

const deps = (over: Partial<RunPrintDeps> = {}) =>
  ({
    createPrintJob: vi.fn(() => Promise.resolve(job({}))),
    reprintPrintJob: vi.fn(() => Promise.resolve(job({}))),
    buildPrintDocument: vi.fn(() => Promise.resolve('<html></html>')),
    openPrintWindow: vi.fn(async (prepare: () => Promise<string>) => {
      await prepare();
    }),
    fetchBlob: vi.fn(() => Promise.resolve(new Blob(['x'], { type: 'font/woff2' }))),
    fetchStatic: vi.fn(() => Promise.resolve(new Blob(['f']))),
    origin: 'https://school.example',
    ...over,
  }) as unknown as RunPrintDeps;

const args = (over: Partial<RunPrintArgs> = {}): RunPrintArgs => ({
  request: { kind: 'reprint', jobId: 'job-1', itemIds: ['i'] },
  printer,
  assets: [
    { id: 'font-1', asset_kind: 'FONT', font_family: 'Custom Face' },
    { id: 'font-2', asset_kind: 'FONT', font_family: null }, // not referenced by the design
  ] as never,
  subjectType: 'STAFF',
  tenantId: 'school-1',
  lang: 'bn',
  title: 'Staff cards',
  onError: vi.fn(),
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('runPrint — other paths', () => {
  it('a reprint asks the reprint endpoint, not create', async () => {
    const d = deps();
    const result = await runPrint(args(), d);
    expect(d.reprintPrintJob).toHaveBeenCalledWith('job-1', ['i']);
    expect(d.createPrintJob).not.toHaveBeenCalled();
    expect(result?.jobId).toBe('job-9');
  });

  it('staff cards use the staff.photo key, and leave photo and logo empty when there are none', async () => {
    const d = deps();
    await runPrint(args(), d);
    const card = vi.mocked(d.buildPrintDocument).mock.calls[0]![0].cards[0]!;
    expect(card['staff.photo']).toBe('');
    expect(card['school.logo']).toBe('');
    expect(card).not.toHaveProperty('student.photo');
    expect(card['print.verify_qr']).toBe('https://school.example/v/x');
  });

  it('inlines an uploaded font the design references, and not one it does not', async () => {
    const d = deps();
    await runPrint(args(), d);
    const input = vi.mocked(d.buildPrintDocument).mock.calls[0]![0];
    expect(input.fonts.map((f) => f.family)).toEqual(['Custom Face']);
    expect(input.fonts[0]!.url.startsWith('data:')).toBe(true);
    expect(input.assetUrl('font-1').startsWith('data:')).toBe(true);
    expect(input.assetUrl('unknown')).toBe('');
  });

  it('uses the asset id as the family name of an unnamed uploaded font', async () => {
    const d = deps();
    await runPrint(
      args({ assets: [{ id: 'font-1', asset_kind: 'FONT', font_family: null }] as never }),
      d,
    );
    expect(vi.mocked(d.buildPrintDocument).mock.calls[0]![0].fonts[0]!.family).toBe('font-1');
  });
});

describe('defaultRunPrintDeps', () => {
  it('fetches API blobs through the authenticated client', async () => {
    const blob = new Blob(['api']);
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: blob });
    expect(await defaultRunPrintDeps.fetchBlob('/print-assets/a/file')).toBe(blob);
    expect(get).toHaveBeenCalledWith('/print-assets/a/file', { responseType: 'blob' });
  });

  it('fetches bundled static files with plain fetch', async () => {
    const blob = new Blob(['static']);
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ blob: () => Promise.resolve(blob) } as never);
    expect(await defaultRunPrintDeps.fetchStatic('/fonts/x.woff2')).toBe(blob);
    expect(spy).toHaveBeenCalledWith('/fonts/x.woff2');
  });

  it('knows the page origin', () => {
    expect(defaultRunPrintDeps.origin).toBe(window.location.origin);
  });
});
